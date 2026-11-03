// HTTP sunucu: NOWPayments IPN callback + Railway health check.
// Bağımlılık yok, node:http ile.
import http from 'node:http';
import { ENV } from './config.js';
import * as db from './db.js';
import * as np from './payments.js';
import * as vip from './vip.js';
import * as tg from './telegram.js';
import * as dash from './dashboard.js';
import { log, warn, err } from './util.js';

const MAX_BODY = 256 * 1024;

const readBody = (req) => new Promise((resolve, reject) => {
  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) { reject(new Error('gövde çok büyük')); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};
const html = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ödeme</title><body style="font-family:system-ui;background:#0b0f14;color:#dbe5f0;display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:20px">
<div>${body}</div></body>`);
};

/* ======================= IPN İŞLEME =======================
   Güvenlik: imza doğrulanır, AMA erişim yalnızca NOWPayments API'sinden
   sunucu-sunucu teyit alındıktan sonra verilir. */
export async function processIpn(rawBody, headerSig) {
  const sig = np.verifySig(rawBody, headerSig);
  if (!sig.ok) {
    warn(`IPN imza doğrulanamadı: ${sig.reason}. ` +
      'Erişim yine de yalnızca NOWPayments API teyidiyle verilecek.');
    if (process.env.NOWPAYMENTS_REQUIRE_SIG === 'true') {
      throw new Error('imza reddedildi: ' + sig.reason);
    }
  }

  let body;
  try { body = JSON.parse(rawBody); }
  catch { throw new Error('IPN gövdesi JSON değil'); }

  const paymentId = body.payment_id ?? body.id;
  if (!paymentId) throw new Error('IPN içinde payment_id yok');

  // --- AUTHORITATIVE: ödemeyi NOWPayments'a sor ---
  let pay;
  try {
    pay = await np.getPayment(paymentId);
  } catch (e) {
    throw new Error(`ödeme NOWPayments'tan doğrulanamadı (${paymentId}): ${e.message}`);
  }

  const status = pay.payment_status;
  const orderId = pay.order_id;           // API'den gelen, gövdeden DEĞİL
  if (!orderId) throw new Error('ödemede order_id yok: ' + paymentId);

  const rec = await db.payByOrder(orderId);
  if (!rec) {
    warn(`bilinmeyen order_id: ${orderId} (payment ${paymentId}) — yoksayıldı`);
    await vip.notifyAdmins(`⚠️ Bilinmeyen sipariş: <code>${orderId}</code> · ${status}`);
    return { ok: true, note: 'bilinmeyen sipariş' };
  }

  await db.payPatch(orderId, {
    np_payment_id: String(paymentId),
    status,
    pay_currency: pay.pay_currency || null,
    actually_paid: pay.actually_paid ?? null,
    raw: pay,
  }).catch((e) => warn('payPatch:', e.message));

  log(`IPN ${orderId} -> ${status}`);

  if (rec.credited) return { ok: true, note: 'zaten işlenmiş' };

  const tgId = rec.telegram_id || np.tgFromOrderId(orderId);

  // --- tamamlandı: erişim ver ---
  if (np.DONE.has(status)) {
    if (!tgId) {
      await vip.notifyAdmins(`⚠️ Ödeme geldi ama telegram_id yok: <code>${orderId}</code>`);
      return { ok: true, note: 'telegram_id yok' };
    }
    await db.payPatch(orderId, { credited: true, credited_at: new Date().toISOString() });
    try {
      await vip.grant(tgId, rec.plan, { amount: rec.amount || 0, orderId });
    } catch (e) {
      err(`VIP verilemedi (${orderId}): ${e.message}`);
      await db.payPatch(orderId, { credited: false }).catch(() => {});
      await vip.notifyAdmins(`❌ VIP verilemedi <code>${orderId}</code> (tg ${tgId}): ${e.message}`);
      throw e;
    }
    return { ok: true, granted: true };
  }

  // --- eksik ödeme: elle karar ---
  if (status === 'partially_paid') {
    if (tgId) {
      await tg.send(tgId,
        '⚠️ Ödemen eksik geldi. Yönetici kontrol edip sana dönecek.\n\n' +
        `Beklenen: $${rec.amount} · Gelen: ${pay.actually_paid ?? '?'} ${pay.pay_currency ?? ''}`)
        .catch(() => {});
    }
    await vip.notifyAdmins(
      `⚠️ EKSİK ÖDEME <code>${orderId}</code>\nKullanıcı: <code>${tgId}</code>\n` +
      `Beklenen $${rec.amount} · gelen ${pay.actually_paid} ${pay.pay_currency}\n` +
      `Uygunsa: /ver ${tgId} ${rec.plan}`);
    return { ok: true, note: 'eksik ödeme' };
  }

  // --- başarısız / iade / süre doldu ---
  if (np.BAD.has(status)) {
    if (tgId) {
      await tg.send(tgId,
        `Ödeme tamamlanmadı (${np.statusTr(status)}). Tekrar denemek için /vip yaz.`)
        .catch(() => {});
    }
    return { ok: true, note: status };
  }

  return { ok: true, note: 'beklemede: ' + status };
}

export function startServer() {
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (path === '/health' || path === '/') {
        return json(res, 200, { ok: true, bot: 'fade', ts: new Date().toISOString() });
      }

      if (path === '/ipn/nowpayments') {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST gerekli' });
        const raw = await readBody(req);
        // NOWPayments 200 dışındaki yanıtlarda tekrar dener; biz hatayı
        // loglayıp 200 dönerek sonsuz tekrarı önlüyoruz (kalıcı hatalar için).
        try {
          const r = await processIpn(raw, req.headers[np.SIG_HEADER]);
          return json(res, 200, r);
        } catch (e) {
          err('IPN hatası:', e.message);
          await vip.notifyAdmins(`❌ IPN hatası: ${e.message}`).catch(() => {});
          // geçici hatalarda tekrar denemesi iyi olur -> 500
          const temporary = /doğrulanamadı|timeout|fetch|network|ECONN|5\d\d/i.test(e.message);
          return json(res, temporary ? 500 : 200, { ok: false, error: e.message });
        }
      }

      /* ---- takipli VIP linki ----
         Free kanaldaki butonlar buraya gelir, tıklama kaydedilir ve
         kullanıcı davet linkine yönlendirilir. Telegram gönderi
         görüntülenmesi vermediği için dönüşümü böyle ölçüyoruz. */
      if (path === '/go/vip') {
        const source = (url.searchParams.get('s') || 'bilinmiyor').slice(0, 32);
        const sigKey = (url.searchParams.get('k') || '').slice(0, 64) || null;
        db.clickAdd({
          kind: 'vip', source, signal_key: sigKey,
          ua: String(req.headers['user-agent'] || '').slice(0, 200),
        });
        res.writeHead(302, { Location: ENV.vipInviteLink, 'Cache-Control': 'no-store' });
        return res.end();
      }

      // ---- dashboard ----
      if (path === '/dash') {
        if (!ENV.dashKey) return html(res, 404, '<h3>Dashboard kapalı</h3><p>DASHBOARD_KEY ayarlanmamış.</p>');
        if (!dash.keyOk(url.searchParams.get('key'))) {
          return html(res, 403, '<h3>Erişim yok</h3><p>Geçersiz anahtar.</p>');
        }
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Robots-Tag': 'noindex, nofollow',
        });
        return res.end(dash.dashHtml());
      }

      if (path === '/api/dash') {
        if (!dash.keyOk(url.searchParams.get('key'))) return json(res, 403, { error: 'yetki yok' });
        const data = await dash.aggregate();
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        return res.end(JSON.stringify(data));
      }

      if (path === '/odeme-tamam') {
        return html(res, 200,
          '<h2>✅ Ödeme alındı</h2><p>VIP davet linkin Telegram\'dan birkaç dakika içinde gelecek.</p>' +
          '<p>Bu sayfayı kapatabilirsin.</p>');
      }
      if (path === '/odeme-iptal') {
        return html(res, 200,
          '<h2>Ödeme iptal edildi</h2><p>Tekrar denemek için Telegram\'da <b>/vip</b> yaz.</p>');
      }

      return json(res, 404, { error: 'yok' });
    } catch (e) {
      err('http:', e.message);
      return json(res, 500, { error: 'sunucu hatası' });
    }
  });

  srv.listen(ENV.port, () => log(`HTTP sunucu ${ENV.port} portunda`));
  return srv;
}
