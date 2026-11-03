// NOWPayments IPN (payment notification) processing.
//
// Security model — read before changing anything:
//  1. The IPN body is NEVER trusted for money decisions. It is only used to learn a
//     payment_id. The payment is then fetched from the NOWPayments API with our own
//     key, and everything (status, order_id, amount) is read from that response.
//  2. Access is granted at most once per order, through an atomic database claim, so
//     concurrent or repeated notifications cannot double-grant.
//  3. The amount and currency reported by NOWPayments must cover what we invoiced.
//  4. Anyone on the internet can POST here, so garbage is dropped silently and the
//     admins are alerted only for things that involve a REAL payment, and throttled.
import { ENV } from './config.js';
import * as npReal from './payments.js';
import * as dbReal from './db.js';
import * as vipReal from './vip.js';
import * as tgReal from './telegram.js';
import { L } from './messages.js';
import { makeThrottle } from './ratelimit.js';
import { log, warn, err } from './util.js';

const defaultDeps = { np: npReal, db: dbReal, vip: vipReal, tg: tgReal };

/* Not worth an alert and nothing NOWPayments needs to retry (probes, junk, unknown ids). */
export class IpnIgnored extends Error {}
/* A transient failure on our side or theirs: answer 5xx so NOWPayments retries later. */
export class IpnTemporary extends Error {}

const shouldAlert = makeThrottle(10 * 60e3);       // same alert at most every 10 minutes
const shouldAlertSig = makeThrottle(60 * 60e3);    // signature mismatch: once an hour

// for callers outside processIpn (the HTTP layer): an admin alert that is throttled per key
export const alertAdmins = (key, text) =>
  (shouldAlert(key) ? vipReal.notifyAdmins(text).catch(() => {}) : Promise.resolve());

const httpStatusOf = (e) => Number(/->\s*(\d{3})\b/.exec(e?.message || '')?.[1]) || 0;

/* Does what NOWPayments says was paid cover what we invoiced? */
export function amountOk(pay, rec) {
  const priced = Number(pay?.price_amount);
  const invoiced = Number(rec?.amount);
  if (Number.isFinite(priced) && Number.isFinite(invoiced) && priced + 0.01 < invoiced) {
    return { ok: false, reason: `price_amount ${priced} is below the invoiced ${invoiced}` };
  }
  const cur = String(pay?.price_currency || '').toLowerCase();
  const ours = String(rec?.currency || '').toLowerCase();
  if (cur && ours && cur !== ours) {
    return { ok: false, reason: `currency ${cur} differs from the invoiced ${ours}` };
  }
  return { ok: true };
}

export async function processIpn(rawBody, headerSig, deps = defaultDeps, { requireSig = process.env.NOWPAYMENTS_REQUIRE_SIG === 'true' } = {}) {
  const { np, db, vip, tg } = deps;
  const alert = async (key, text) => { if (shouldAlert(key)) await vip.notifyAdmins(text).catch(() => {}); };

  let body;
  try { body = JSON.parse(rawBody); }
  catch { throw new IpnIgnored('body is not JSON'); }

  const paymentId = body?.payment_id ?? body?.id;
  if (!paymentId) throw new IpnIgnored('no payment_id');

  const sig = np.verifySig(rawBody, headerSig);
  if (!sig.ok && requireSig) throw new IpnIgnored('signature rejected: ' + sig.reason);

  // --- the authoritative copy, from NOWPayments itself ---
  let pay;
  try {
    pay = await np.getPayment(paymentId);
  } catch (e) {
    const code = httpStatusOf(e);
    if (code === 404 || code === 400) throw new IpnIgnored(`NOWPayments has no payment ${paymentId}`);
    if (code === 401 || code === 403) {
      await alert('np-auth', `❌ NOWPayments rejected our API key (HTTP ${code}). Payments cannot be verified until the key is fixed.`);
      throw new Error('NOWPayments auth failed');
    }
    throw new IpnTemporary(`could not verify payment ${paymentId}: ${e.message}`);
  }

  const status = pay.payment_status;
  const orderId = pay.order_id;                // from the API response, never from the request body
  if (!orderId) throw new IpnIgnored(`payment ${paymentId} carries no order_id`);

  const rec = await db.payByOrder(orderId);
  if (!rec) {
    await alert(`unknown-order-${orderId}`, `⚠️ A real NOWPayments payment arrived for an order we do not know: <code>${orderId}</code> (${status}).`);
    return { ok: true, note: 'unknown order' };
  }

  // The signature did not match but NOWPayments confirms the payment is real. That means our
  // signature check is probably wrong — flag it, but the API check above is what protects us.
  if (!sig.ok) {
    if (shouldAlertSig('sig')) {
      warn(`IPN signature did not verify (${sig.reason}) on a genuine payment — verification may be misconfigured`);
      await vip.notifyAdmins(`ℹ️ A genuine payment arrived but its IPN signature did not verify (${sig.reason}). Access is still granted safely because the payment was re-checked with NOWPayments. Check that NOWPAYMENTS_IPN_SECRET is the current IPN secret.`).catch(() => {});
    }
  }

  await db.payPatch(orderId, {
    np_payment_id: String(paymentId),
    status,
    pay_currency: pay.pay_currency || null,
    actually_paid: pay.actually_paid ?? null,
    raw: pay,
  }).catch((e) => warn('payPatch:', e.message));

  log(`IPN ${orderId} -> ${status}`);
  const tgId = rec.telegram_id || np.tgFromOrderId(orderId);
  const lang = tgId ? await db.getUserLang(tgId).catch(() => 'en') : 'en';

  // ------------------------------------------------------------------ paid
  if (np.DONE.has(status)) {
    if (rec.credited) return { ok: true, note: 'already credited' };
    if (!tgId) {
      await alert(`no-tg-${orderId}`, `⚠️ Payment received but no telegram_id: <code>${orderId}</code>`);
      return { ok: true, note: 'no telegram_id' };
    }

    const chk = amountOk(pay, rec);
    if (!chk.ok) {
      await alert(`amount-${orderId}`,
        `🚨 Payment <code>${orderId}</code> is marked ${status} but does not cover the invoice: ${chk.reason}. Access NOT granted. Review it, then use /ver ${tgId} ${rec.plan} if it is fine.`);
      return { ok: true, note: 'amount mismatch' };
    }

    // Atomic claim: only the single request that flips credited false→true gets to grant.
    const claimed = await db.payClaim(orderId);
    if (!claimed) return { ok: true, note: 'already credited (concurrent notification)' };

    try {
      await vip.grant(tgId, rec.plan, { amount: rec.amount || 0, orderId });
    } catch (e) {
      err(`VIP could not be granted (${orderId}): ${e.message}`);
      await db.payUnclaim(orderId).catch(() => {});   // let the next notification retry
      await alert(`grant-${orderId}`, `❌ VIP could not be granted for <code>${orderId}</code> (tg ${tgId}): ${e.message}`);
      throw e;
    }
    return { ok: true, granted: true };
  }

  // --------------------------------------------------------- underpaid: a human decides
  if (status === 'partially_paid') {
    if (tgId) {
      await tg.send(tgId, L(lang,
        `⚠️ Your payment came in short. The admin will review it and get back to you.\n\nExpected: $${rec.amount} · Received: ${pay.actually_paid ?? '?'} ${pay.pay_currency ?? ''}`,
        `⚠️ Ödemen eksik geldi. Yönetici kontrol edip sana dönecek.\n\nBeklenen: $${rec.amount} · Gelen: ${pay.actually_paid ?? '?'} ${pay.pay_currency ?? ''}`)).catch(() => {});
    }
    await alert(`partial-${orderId}`,
      `⚠️ UNDERPAID <code>${orderId}</code>\nUser: <code>${tgId}</code>\nExpected $${rec.amount} · got ${pay.actually_paid} ${pay.pay_currency}\nIf it is acceptable: /ver ${tgId} ${rec.plan}`);
    return { ok: true, note: 'partially paid' };
  }

  // ------------------------------------------------- failed / refunded / expired
  if (np.BAD.has(status)) {
    if (rec.credited) {
      // Access was already granted and the payment is now reversed: do not guess, tell the admins.
      await alert(`reversed-${orderId}`,
        `🚨 Payment <code>${orderId}</code> is now ${status} but VIP access was already granted to <code>${tgId}</code>. Decide whether to revoke it: /al ${tgId}`);
    } else if (tgId) {
      await tg.send(tgId, L(lang,
        `The payment did not complete (${np.statusTr(status)}). Send /vip to try again.`,
        `Ödeme tamamlanmadı (${np.statusTr(status)}). Tekrar denemek için /vip yaz.`)).catch(() => {});
    }
    return { ok: true, note: status };
  }

  return { ok: true, note: 'pending: ' + status };
}
