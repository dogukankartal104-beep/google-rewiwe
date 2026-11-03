// Ortak yardımcılar. HUD'daki formatlayıcıların aynısı.
export const TZ_OFFSET = Number(process.env.TZ_OFFSET ?? 3); // TR saati

export const fmt = (v, d = 2) =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(d);

export const pct = (v) =>
  v === null || v === undefined || Number.isNaN(Number(v))
    ? '—'
    : (Number(v) > 0 ? '+' : '') + Number(v).toFixed(2) + '%';

export const shortn = (n) => {
  n = Number(n) || 0;
  return n >= 1e9 ? (n / 1e9).toFixed(2) + 'B'
    : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M'
    : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K'
    : n >= 1000 ? (n / 1e3).toFixed(2) + 'K'
    : n >= 1 ? n.toFixed(0) : n.toFixed(2);
};

// Fiyat ondalık basamağı: exchangeInfo'dan gelen tickSize varsa onu kullan.
export const decFor = (price, sym, PREC) =>
  sym && PREC && PREC[sym] !== undefined
    ? PREC[sym]
    : price < 0.00001 ? 8 : price < 0.001 ? 7 : price < 1 ? 6 : price < 100 ? 4 : 2;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// n paralel worker ile kuyruk tüket. Bir iş patlarsa diğerleri devam eder.
export async function pool(items, n, fn) {
  const q = items.slice();
  const errs = [];
  await Promise.all(
    Array.from({ length: Math.max(1, n) }, async () => {
      while (q.length) {
        const it = q.shift();
        try { await fn(it); } catch (e) { errs.push(e); }
      }
    })
  );
  return errs;
}

// TR saatine göre seans. HUD ile birebir aynı eşikler.
export function seans(t = Date.now()) {
  const h = new Date(t + TZ_OFFSET * 3600e3).getUTCHours();
  return h < 3 ? 'ölü saat' : h < 11 ? 'asya' : h < 17 ? 'avrupa' : 'abd';
}

export function trDate(t = Date.now()) {
  return new Date(t + TZ_OFFSET * 3600e3);
}

// TR gününün UTC epoch başlangıcı
export function trDayStart(t = Date.now()) {
  const d = trDate(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - TZ_OFFSET * 3600e3;
}

const AYLAR = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];
export function trShort(t) {
  const d = trDate(t);
  return `${d.getUTCDate()} ${AYLAR[d.getUTCMonth()]}`;
}
export function trDateTime(t) {
  const d = trDate(t);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
export function trClock(t) {
  const d = trDate(t);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// Süreyi insan diline çevir: 134 -> "2 sa 14 dk"
export function dur(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return m + ' dk';
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 24) return r ? `${h} sa ${r} dk` : `${h} sa`;
  const g = Math.floor(h / 24);
  return `${g} gün ${h % 24} sa`;
}

export function log(...a) {
  console.log(new Date().toISOString(), ...a);
}
export function warn(...a) {
  console.warn(new Date().toISOString(), 'UYARI', ...a);
}
export function err(...a) {
  console.error(new Date().toISOString(), 'HATA', ...a);
}
