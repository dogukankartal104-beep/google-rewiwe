// Multi-timeframe features at a signal moment (pure; used by the backtest research and by the live shadow recorder).
// Everything is computed from candles that closed BEFORE tCut.
const MIN = 6e4, M15 = 9e5, HOUR = 36e5;
export const TFS = [['1m', MIN], ['3m', 3 * MIN], ['5m', 5 * MIN], ['10m', 10 * MIN], ['15m', M15], ['30m', 2 * M15], ['45m', 3 * M15], ['1h', HOUR], ['2h', 2 * HOUR], ['4h', 4 * HOUR]];
export const FEAT = ['r', 'wick', 'cvd', 'rsi', 'dist'];

export const rsi14 = (c) => { if (c.length < 15) return NaN; let g = 0, l = 0; for (let i = 1; i <= 14; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; } g /= 14; l /= 14; for (let i = 15; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * 13 + Math.max(d, 0)) / 14; l = (l * 13 + Math.max(-d, 0)) / 14; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); };
export const ema20 = (c) => { const k = 2 / 21; let e = c[0]; for (let i = 1; i < c.length; i++) e = c[i] * k + e * (1 - k); return e; };

/* bars: candles with .dur (ms); returns clock-aligned candles of tfMs that are fully closed before tCut. */
export function aggregate(bars, tfMs, tCut) {
  const g = new Map();
  for (const b of bars) {
    if (b.t + b.dur > tCut) continue;
    const key = Math.floor(b.t / tfMs);
    let a = g.get(key);
    if (!a) { a = { t: key * tfMs, o: b.o, h: b.h, l: b.l, c: b.c, q: 0, tq: 0, dur: 0 }; g.set(key, a); }
    a.h = Math.max(a.h, b.h); a.l = Math.min(a.l, b.l); a.c = b.c; a.q += b.q; a.tq += b.tq; a.dur += b.dur;
  }
  return [...g.values()].filter((a) => a.dur === tfMs && a.t + tfMs <= tCut).sort((a, b) => a.t - b.t);
}

export function tfFeatures(cs) {
  if (cs.length < 16) return null;
  const last = cs[cs.length - 1], closes = cs.slice(-60).map((x) => x.c), rng = last.h - last.l;
  return { r: (last.c / last.o - 1) * 100, wick: rng > 0 ? (last.h - Math.max(last.o, last.c)) / rng : 0, cvd: last.q > 0 ? (2 * last.tq - last.q) / last.q : 0, rsi: rsi14(closes), dist: (last.c / ema20(closes) - 1) * 100 };
}

/* m1: 1m candles before tCut (at least ~300), k15: 15m candles before tCut (at least ~270). Returns {"1m.r": ..., ...}. */
export function mtfFeatures(m1, k15, tCut) {
  const a1 = m1.map((x) => ({ ...x, dur: MIN })), a15 = k15.map((x) => ({ ...x, dur: M15 }));
  const out = {};
  for (const [nm, ms] of TFS) {
    const ft = tfFeatures(ms <= M15 ? aggregate(a1.slice(-400), ms, tCut) : aggregate(a15, ms, tCut));
    if (ft) for (const x of FEAT) out[`${nm}.${x}`] = +ft[x].toFixed(4);
  }
  return out;
}
