// NOWPayments entegrasyonu (kripto ödeme).
//
// GÜVENLİK NOTU — önemli:
// IPN imzası doğrulanır (fail-closed), AMA VIP erişimi SADECE imzaya dayanarak
// verilmez. Her IPN'den sonra ödeme NOWPayments API'sinden sunucu-sunucu
// yeniden sorgulanır (authoritative check) ve erişim yalnızca o yanıt onaylarsa
// açılır. Böylece uydurma bir IPN isteği VIP kazandırmaz; imza algoritmasında
// bir sapma olsa bile gerçek ödemeler yine de işlenir.
import crypto from 'node:crypto';
import { ENV } from './config.js';
import { warn } from './util.js';

const NP = 'https://api.nowpayments.io/v1';

async function npFetch(path, { method = 'GET', body } = {}) {
  if (!ENV.npApiKey) throw new Error('NOWPAYMENTS_API_KEY yok');
  const r = await fetch(NP + path, {
    method,
    headers: {
      'x-api-key': ENV.npApiKey,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25000),
  });
  const txt = await r.text();
  let j = null;
  try { j = JSON.parse(txt); } catch { /* düz metin */ }
  if (!r.ok) throw new Error(`nowpayments ${method} ${path} -> ${r.status} ${txt.slice(0, 300)}`);
  return j ?? txt;
}

export const npStatus = () => npFetch('/status');

export const npCurrencies = () => npFetch('/currencies');

// Fatura oluştur -> kullanıcıya göstereceğimiz ödeme sayfası linki döner
export async function createInvoice({ amount, orderId, description, plan }) {
  if (!ENV.publicUrl) warn('PUBLIC_URL yok — IPN callback çalışmaz, ödeme otomatik işlenmez!');
  const body = {
    price_amount: amount,
    price_currency: ENV.npCurrency,
    order_id: orderId,
    order_description: description || `VIP ${plan}`,
    ipn_callback_url: ENV.publicUrl ? `${ENV.publicUrl}/ipn/nowpayments` : undefined,
    success_url: ENV.publicUrl ? `${ENV.publicUrl}/odeme-tamam` : undefined,
    cancel_url: ENV.publicUrl ? `${ENV.publicUrl}/odeme-iptal` : undefined,
    is_fixed_rate: true,
    is_fee_paid_by_user: true,
  };
  const inv = await npFetch('/invoice', { method: 'POST', body });
  const url = inv?.invoice_url || inv?.url;
  if (!url) throw new Error('nowpayments: invoice_url dönmedi: ' + JSON.stringify(inv).slice(0, 200));
  return { id: String(inv.id ?? inv.invoice_id ?? ''), url, raw: inv };
}

// Tek bir ödemenin durumunu NOWPayments'tan sor (authoritative)
export const getPayment = (paymentId) => npFetch('/payment/' + encodeURIComponent(paymentId));

/* ---------------- IPN imza doğrulaması ----------------
   NOWPayments gövdeyi anahtarları alfabetik sıralanmış JSON'a çevirip
   IPN secret ile HMAC-SHA512 imzalar; imza `x-nowpayments-sig` başlığında gelir. */
export const SIG_HEADER = 'x-nowpayments-sig';

function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortDeep(v[k]);
    return out;
  }
  return v;
}

export function expectedSig(rawBodyOrObj, secret = ENV.npIpnSecret) {
  if (!secret) return null;
  let obj = rawBodyOrObj;
  if (typeof rawBodyOrObj === 'string') {
    try { obj = JSON.parse(rawBodyOrObj); } catch { return null; }
  }
  const json = JSON.stringify(sortDeep(obj));
  return crypto.createHmac('sha512', secret).update(json).digest('hex');
}

export function verifySig(rawBody, headerSig) {
  if (!ENV.npIpnSecret) return { ok: false, reason: 'IPN secret ayarlı değil' };
  if (!headerSig) return { ok: false, reason: 'imza başlığı yok' };
  const exp = expectedSig(rawBody);
  if (!exp) return { ok: false, reason: 'imza hesaplanamadı' };
  const a = Buffer.from(String(headerSig).trim(), 'utf8');
  const b = Buffer.from(exp, 'utf8');
  if (a.length !== b.length) return { ok: false, reason: 'imza uzunluğu farklı', expected: exp };
  const ok = crypto.timingSafeEqual(a, b);
  return ok ? { ok: true } : { ok: false, reason: 'imza uyuşmadı', expected: exp };
}

// Ödeme tamamlandı sayılan durumlar
export const DONE = new Set(['finished', 'confirmed']);
export const PENDING = new Set(['waiting', 'confirming', 'sending']);
export const BAD = new Set(['failed', 'refunded', 'expired']);

export const statusTr = (s) => ({
  waiting: 'ödeme bekleniyor',
  confirming: 'ağda onaylanıyor',
  confirmed: 'onaylandı',
  sending: 'gönderiliyor',
  partially_paid: 'eksik ödendi',
  finished: 'tamamlandı',
  failed: 'başarısız',
  refunded: 'iade edildi',
  expired: 'süresi doldu',
}[s] || s);

export const makeOrderId = (tgId, plan) =>
  `tg${tgId}-${String(plan).replace(/[^a-zA-Z0-9]/g, '')}-${Date.now().toString(36)}`;

export const tgFromOrderId = (orderId) => {
  const m = /^tg(\d+)-/.exec(String(orderId || ''));
  return m ? Number(m[1]) : null;
};

export const configured = () => Boolean(ENV.npApiKey && ENV.npIpnSecret && ENV.publicUrl);
