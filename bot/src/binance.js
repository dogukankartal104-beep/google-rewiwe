// Binance Futures (fapi) + Spot veri katmanı.
// Tüm istekler retry'li; 429/418 görürsek geri çekiliyoruz (ban yememek için).
import { sleep, warn } from './util.js';

export const FAPI = 'https://fapi.binance.com';
export const SAPI = 'https://api.binance.com';
export const CG = 'https://api.coingecko.com/api/v3';
export const DERIBIT = 'https://www.deribit.com/api/v2';

export const PREC = {};
export const TICKSZ = {};
export const ONBOARD = {};

let backoffUntil = 0;

export async function api(path, params = {}, base = FAPI, tries = 3) {
  const u = new URL(base + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) u.searchParams.set(k, v);
  }
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const wait = backoffUntil - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      const ctl = AbortSignal.timeout(20000);
      const r = await fetch(u, { signal: ctl, headers: { 'User-Agent': 'fade-bot/1.0' } });
      if (r.status === 429 || r.status === 418) {
        const ra = Number(r.headers.get('retry-after') || 0);
        const pause = Math.max(5000, ra * 1000, 2000 * 2 ** i);
        backoffUntil = Date.now() + pause;
        warn(`binance ${r.status} rate limit, ${Math.round(pause / 1000)}s bekleniyor`);
        lastErr = new Error('rate limit ' + r.status);
        continue;
      }
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        throw new Error(`${path.split('/').pop()} ${r.status} ${body.slice(0, 160)}`);
      }
      return await r.json();
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await sleep(700 * 2 ** i);
    }
  }
  throw lastErr;
}

export const oiP = (tf) => (['1m', '3m'].includes(tf) ? '5m' : tf);
export const TFM = { '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '2h': 120, '4h': 240 };

export const toK = (rows) =>
  rows.map((r) => ({
    t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4],
    v: +r[5], q: +r[7], tb: +r[9], tq: +r[10],
  }));

export async function loadExchangeInfo() {
  const i = await api('/fapi/v1/exchangeInfo');
  for (const s of i.symbols) {
    ONBOARD[s.symbol] = s.onboardDate;
    const f = (s.filters || []).find((x) => x.filterType === 'PRICE_FILTER');
    if (f) {
      const t = parseFloat(f.tickSize);
      TICKSZ[s.symbol] = t;
      PREC[s.symbol] = t >= 1 ? 0 : Math.max(0, Math.round(-Math.log10(t)));
    } else if (s.pricePrecision !== undefined) {
      PREC[s.symbol] = s.pricePrecision;
    }
  }
  return i.symbols.length;
}

// Sadece aktif, USDT perpetual ve ticareti açık olanlar
export async function loadTickers() {
  const t = await api('/fapi/v1/ticker/24hr');
  return t
    .filter((x) => x.symbol.endsWith('USDT'))
    .map((x) => ({
      s: x.symbol,
      p: +x.lastPrice,
      c: +x.priceChangePercent,
      v: +x.quoteVolume,
    }))
    .filter((x) => x.v > 0 && Number.isFinite(x.p) && x.p > 0);
}

export async function klines(symbol, interval, limit = 140, extra = {}) {
  return toK(await api('/fapi/v1/klines', { symbol, interval, limit, ...extra }));
}

export async function btcChg15() {
  try {
    const k = await api('/fapi/v1/klines', { symbol: 'BTCUSDT', interval: '15m', limit: 2 });
    const c = k[k.length - 1];
    return ((+c[4] - +c[1]) / +c[1]) * 100;
  } catch { return null; }
}

// BTC şoku: son 15m mumun aralığı / 30 mumluk ortalama TR
export async function btcShock() {
  try {
    const b = await api('/fapi/v1/klines', { symbol: 'BTCUSDT', interval: '15m', limit: 31 });
    const k = b.map((r) => ({ h: +r[2], l: +r[3], c: +r[4] }));
    const trs = k.slice(-30).map((x, i, a) =>
      i ? Math.max(x.h - x.l, Math.abs(x.h - a[i - 1].c), Math.abs(x.l - a[i - 1].c)) : x.h - x.l);
    const atrB = trs.reduce((x, y) => x + y, 0) / trs.length;
    const last = k[k.length - 1];
    return atrB ? (last.h - last.l) / atrB : null;
  } catch { return null; }
}

// BTC/ETH rejimi — günlük analiz için
export async function regime() {
  try {
    const [b, e] = await Promise.all([
      api('/fapi/v1/klines', { symbol: 'BTCUSDT', interval: '15m', limit: 97 }),
      api('/fapi/v1/klines', { symbol: 'ETHUSDT', interval: '15m', limit: 97 }),
    ]);
    const calc = (kk) => {
      const c = kk.map((r) => +r[4]);
      const p = c[c.length - 1];
      const ch = (n) => { const i = c.length - 1 - n; return i >= 0 ? ((p - c[i]) / c[i]) * 100 : null; };
      return { p, m15: ch(1), h1: ch(4), h4: ch(16), d1: ch(96) };
    };
    const R = { btc: calc(b), eth: calc(e) };
    const sc = (R.btc.h1 > 0 ? 1 : -1) + (R.btc.h4 > 0 ? 1 : -1) + (R.eth.h1 > 0 ? 1 : -1);
    R.label = sc >= 2 ? 'yukarı rejim' : sc <= -2 ? 'aşağı rejim' : 'yatay';
    R.score = sc;
    return R;
  } catch { return null; }
}

// Deribit BTC DVOL — panik rejimi filtresi
export async function dvol() {
  try {
    const end = Date.now(), start = end - 7 * 864e5;
    const j = await api('/public/get_volatility_index_data',
      { currency: 'BTC', start_timestamp: start, end_timestamp: end, resolution: 3600 }, DERIBIT, 2);
    const d = j?.result?.data;
    if (!d || !d.length) return null;
    const closes = d.map((x) => x[4]);
    const now = closes[closes.length - 1];
    const d1 = closes.length > 24 ? closes[closes.length - 25] : closes[0];
    const srt = closes.slice().sort((a, b) => a - b);
    const pctl = (srt.findIndex((x) => x >= now) / srt.length) * 100;
    return { now, chg: ((now - d1) / d1) * 100, pctl };
  } catch { return null; }
}

// Emir defteri: duvarlar, boşluklar, derinlik. REST snapshot.
export async function loadDepth(sym, atrv, price) {
  try {
    const d = await api('/fapi/v1/depth', { symbol: sym, limit: 500 });
    const step = Math.max(atrv / 6, price * 0.0005);
    const B = {};
    const push = (arr, ask) => arr.forEach(([p, q]) => {
      p = +p; q = +q;
      const key = (ask ? 'a' : 'b') + Math.round(p / step);
      if (!B[key]) B[key] = { p: Math.round(p / step) * step, n: 0, ask };
      B[key].n += q * p;
    });
    push(d.bids, false); push(d.asks, true);
    const vals = Object.values(B);
    const arr = vals.slice().sort((a, b) => b.n - a.n);
    const max = arr.length ? arr[0].n : 1;
    const sortedN = vals.map((x) => x.n).sort((a, b) => a - b);
    const med = sortedN.length ? sortedN[Math.floor(sortedN.length / 2)] : 1;
    const near = (x) => Math.abs(x.p - price) / price <= 0.01;
    const bidN = vals.filter((x) => !x.ask && near(x)).reduce((a, x) => a + x.n, 0);
    const askN = vals.filter((x) => x.ask && near(x)).reduce((a, x) => a + x.n, 0);
    const byP = vals.slice().sort((x, y) => x.p - y.p);
    const gaps = []; let g = null;
    byP.forEach((x) => {
      if (x.n < med * 0.2) { if (!g) g = { a: x.p, b: x.p, ask: x.ask }; else g.b = x.p; }
      else { if (g && g.b - g.a > step * 1.5) gaps.push(g); g = null; }
    });
    if (g && g.b - g.a > step * 1.5) gaps.push(g);
    return {
      all: vals, max, med, gaps,
      walls: arr.filter((x) => x.n > med * 4).slice(0, 6),
      imb: askN ? bidN / askN : null, bidN, askN,
      bids: d.bids.map((x) => [+x[0], +x[1]]),
      asks: d.asks.map((x) => [+x[0], +x[1]]),
    };
  } catch { return null; }
}

// Kayma tahmini: verilen $ büyüklüğü defteri ne kadar süpürür
export function slip(depth, usd, side) {
  if (!depth?.bids?.length || !depth?.asks?.length) return null;
  const book = side === 'sell' ? depth.bids : depth.asks;
  const mid = (depth.bids[0][0] + depth.asks[0][0]) / 2;
  let left = usd, cost = 0, qty = 0;
  for (const [pr, q] of book) {
    const n = pr * q, take = Math.min(left, n);
    qty += take / pr; cost += take; left -= take;
    if (left <= 0) break;
  }
  if (left > 0 || !qty) return { full: false, pct: null };
  const vwap = cost / qty;
  return { full: true, vwap, pct: (Math.abs(vwap - mid) / mid) * 100 };
}

// RVOL: son 24s hacim / 20 günlük ortalama (katalizör/haber tespiti)
export async function rvol(sym) {
  try {
    const d = await api('/fapi/v1/klines', { symbol: sym, interval: '1d', limit: 21 });
    if (d.length < 5) return null;
    const q = d.map((r) => +r[7]);
    const today = q[q.length - 1];
    const prev = q.slice(0, -1);
    const avg = prev.reduce((a, b) => a + b, 0) / prev.length;
    return avg ? today / avg : null;
  } catch { return null; }
}

// BTC betası + korelasyon
export async function beta(closes, tf) {
  try {
    const bk = await api('/fapi/v1/klines', { symbol: 'BTCUSDT', interval: tf, limit: 101 });
    const b = bk.map((r) => +r[4]);
    const c = closes.slice(-101);
    const n = Math.min(b.length, c.length);
    if (n < 30) return null;
    const br = [], cr = [];
    for (let i = 1; i < n; i++) {
      const b1 = b[b.length - n + i], b0 = b[b.length - n + i - 1];
      const c1 = c[c.length - n + i], c0 = c[c.length - n + i - 1];
      br.push((b1 - b0) / b0); cr.push((c1 - c0) / c0);
    }
    const mb = br.reduce((a, x) => a + x, 0) / br.length;
    const mc = cr.reduce((a, x) => a + x, 0) / cr.length;
    let cov = 0, vb = 0, vc = 0;
    for (let i = 0; i < br.length; i++) {
      cov += (br[i] - mb) * (cr[i] - mc);
      vb += (br[i] - mb) ** 2; vc += (cr[i] - mc) ** 2;
    }
    return { beta: vb ? cov / vb : null, corr: vb && vc ? cov / Math.sqrt(vb * vc) : null };
  } catch { return null; }
}

// Funding geçmişi — "funding tepe yapmış" kontrolü için
export async function fundingHist(sym, limit = 8) {
  try { return await api('/fapi/v1/fundingRate', { symbol: sym, limit }); }
  catch { return []; }
}
