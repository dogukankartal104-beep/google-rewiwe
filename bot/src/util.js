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
  return h < 3 ? 'dead hours' : h < 11 ? 'Asia' : h < 17 ? 'Europe' : 'US';
}

export function trDate(t = Date.now()) {
  return new Date(t + TZ_OFFSET * 3600e3);
}

// TR gününün UTC epoch başlangıcı
export function trDayStart(t = Date.now()) {
  const d = trDate(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - TZ_OFFSET * 3600e3;
}

// Channel content is English, so month labels are English too.
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function trShort(t) {
  const d = trDate(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
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

// Human-readable duration: 134 min -> "2h 14m"
export function dur(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 24) return r ? `${h}h ${r}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
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
