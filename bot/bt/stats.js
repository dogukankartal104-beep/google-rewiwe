// Statistics for the backtest: summary, week-clustered bootstrap, Benjamini-Hochberg, equity test.
export function rng(seed) {                         // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const weekOf = (t) => Math.floor((t + 3 * 864e5) / (7 * 864e5));       // weeks starting Monday (epoch was a Thursday)

/* 90% lower bound of the mean: resample whole weeks (trades of one week stay together). */
export function bootstrapLB(trades, valFn = (x) => x.net, { B = 2000, seed = 7, q = 0.10 } = {}) {
  if (trades.length < 5) return NaN;
  const wk = new Map();
  for (const x of trades) { const w = weekOf(x.tS); (wk.get(w) || wk.set(w, []).get(w)).push(valFn(x)); }
  const weeks = [...wk.values()];
  const sums = weeks.map((w) => w.reduce((a, b) => a + b, 0)), cnts = weeks.map((w) => w.length);
  const r = rng(seed), means = [];
  for (let b = 0; b < B; b++) {
    let s = 0, c = 0;
    for (let i = 0; i < weeks.length; i++) { const j = (r() * weeks.length) | 0; s += sums[j]; c += cnts[j]; }
    means.push(c ? s / c : 0);
  }
  means.sort((a, b) => a - b);
  return means[Math.floor(q * B)];
}

export function maxDrawdown(vals) {
  let cum = 0, peak = 0, dd = 0;
  for (const v of vals) { cum += v; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak); }
  return dd;
}

/* Everything the protocol asks for, for one list of trades (each: {tS, net, ...}). */
export function summarize(trades, valFn = (x) => x.net) {
  const t = [...trades].sort((a, b) => a.tS - b.tS);
  const v = t.map(valFn);
  const n = v.length;
  if (!n) return { n: 0 };
  const half = Math.floor(n / 2);
  const top5 = [...v].sort((a, b) => b - a).slice(5);
  return {
    n, mean: mean(v), median: median(v),
    win: (v.filter((x) => x > 0).length / n) * 100,
    lb90: bootstrapLB(t, valFn),
    h1: mean(v.slice(0, half)), h2: mean(v.slice(half)), n1: half, n2: n - half,
    exTop5: top5.length ? mean(top5) : NaN,
    mdd: maxDrawdown(v),
    total: v.reduce((a, b) => a + b, 0),
  };
}

/* Benjamini-Hochberg: p-values in, boolean "significant at q" out. */
export function benjaminiHochberg(ps, q = 0.10) {
  const idx = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
  let cut = -1;
  idx.forEach(([p], k) => { if (p <= ((k + 1) / ps.length) * q) cut = k; });
  const sig = new Array(ps.length).fill(false);
  for (let k = 0; k <= cut; k++) sig[idx[k][1]] = true;
  return sig;
}
/* One-sided bootstrap p-value that the mean is > 0 (week-clustered). */
export function pValueMeanPositive(trades, valFn = (x) => x.net, B = 2000, seed = 11) {
  if (trades.length < 5) return 1;
  const wk = new Map();
  for (const x of trades) { const w = weekOf(x.tS); (wk.get(w) || wk.set(w, []).get(w)).push(valFn(x)); }
  const weeks = [...wk.values()];
  const sums = weeks.map((w) => w.reduce((a, b) => a + b, 0)), cnts = weeks.map((w) => w.length);
  const r = rng(seed); let le0 = 0;
  for (let b = 0; b < B; b++) {
    let s = 0, c = 0;
    for (let i = 0; i < weeks.length; i++) { const j = (r() * weeks.length) | 0; s += sums[j]; c += cnts[j]; }
    if ((c ? s / c : 0) <= 0) le0++;
  }
  return (le0 + 1) / (B + 1);
}

/* One account, `frac` of equity as margin per trade at `lev`x, at most `maxOpen` open, compounded.
   Trades carry tFill/tEnd and `net` (% of notional). Returns the equity path summary. */
export function equityTest(trades, { frac = 0.10, lev = 2, maxOpen = 2 } = {}) {
  const t = [...trades].filter((x) => x.filled).sort((a, b) => a.tFill - b.tFill);
  let cash = 1;
  const open = [];                                    // {tEnd, pnl}
  const curve = [];
  const settle = (upTo) => {
    open.sort((a, b) => a.tEnd - b.tEnd);
    while (open.length && open[0].tEnd <= upTo) { const o = open.shift(); cash += o.pnl; curve.push({ t: o.tEnd, eq: cash }); }
  };
  let skipped = 0;
  for (const x of t) {
    settle(x.tFill);
    if (open.length >= maxOpen) { skipped++; continue; }
    const size = Math.max(0, cash) * frac * lev;      // notional
    open.push({ tEnd: x.tEnd, pnl: size * (x.net / 100) });
  }
  settle(Infinity);
  let peak = 1, dd = 0;
  for (const c of curve) { peak = Math.max(peak, c.eq); dd = Math.min(dd, c.eq / peak - 1); }
  const mid = curve.length >> 1;
  const half = (a, b) => (a && b ? b.eq / a.eq - 1 : NaN);
  const ddOf = (arr, start) => { let p = start, d = 0; for (const c of arr) { p = Math.max(p, c.eq); d = Math.min(d, c.eq / p - 1); } return d; };
  return {
    final: cash, ret: (cash - 1) * 100, mdd: dd * 100, n: curve.length, skipped,
    ret1: half({ eq: 1 }, curve[mid - 1]) * 100,
    ret2: half(curve[mid - 1], curve[curve.length - 1]) * 100,
    mdd1: ddOf(curve.slice(0, mid), 1) * 100,
    mdd2: ddOf(curve.slice(mid), curve[mid - 1]?.eq ?? 1) * 100,
  };
}
