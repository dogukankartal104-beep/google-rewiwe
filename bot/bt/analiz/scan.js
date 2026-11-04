// Candidate scanning for engines 1 (v1k) and 3 (G1). Loosest thresholds are scanned once; every grid cell and
// the centre rule are filtered from this list afterwards (a signal stricter than the loosest is always a subset).
import { loadKlines } from '../archive.js';
import { dailyBars } from './data.js';

const BAR = 9e5, HOUR = 36e5, DAY = 864e5;
export const LOOSE = { v1k: { chg24: 40, btc24: -0.5, r15: 4, vol: 1e6 }, g1: { drop: -8 } };

/* One pass over a symbol. Returns candidates and the compact series needed later (hourly opens, monthly volume). */
export async function scanSymbol(sym, fromMs, toMs, btc) {
  const out = { sym, v1k: [], g1: [], hourly: null, monthVol: new Map(), daily: [], cov: { bars15: 0, days: 0 } };
  const { k } = await loadKlines(sym, '15m', fromMs - 3 * DAY, toMs);
  out.cov.bars15 = k.length;
  if (k.length > 200) {
    // hourly opens (first 15m candle of each hour) for the basket calculation
    const h0 = Math.floor(k[0].t / HOUR), n = Math.floor(k[k.length - 1].t / HOUR) - h0 + 1;
    const arr = new Float64Array(n).fill(NaN);
    for (const x of k) if (x.t % HOUR === 0) arr[Math.floor(x.t / HOUR) - h0] = x.o;
    out.hourly = { h0, arr };
    for (const x of k) { const ym = new Date(x.t).toISOString().slice(0, 7); out.monthVol.set(ym, (out.monthVol.get(ym) || 0) + x.q); }
    const L = LOOSE.v1k;
    let q = 0; for (let j = 0; j < 96 && j < k.length; j++) q += k[j].q;
    for (let i = 96; i < k.length; i++) {
      q += k[i].q - k[i - 96].q;                                   // sum of the last 96 closed candles ending at i
      const tSig = k[i].t + BAR;
      if (tSig < fromMs || tSig >= toMs) continue;
      if (k[i].t - k[i - 96].t !== 96 * BAR || k[i].t - k[i - 1].t !== BAR) continue;
      const r15 = (k[i].c / k[i - 1].c - 1) * 100;
      if (r15 < L.r15) continue;
      const chg24 = (k[i].c / k[i - 96].c - 1) * 100;
      if (chg24 < L.chg24) continue;
      const bi = btc.idx.get(k[i].t);
      if (bi === undefined || bi < 96) continue;
      const btc24 = (btc.k[bi].c / btc.k[bi - 96].c - 1) * 100;
      if (btc24 > L.btc24) continue;
      if (q < L.vol) continue;
      if (!(k[i].v > 0) || k[i].h === k[i].l) continue;
      out.v1k.push({ s: sym, tSig, r15, chg24, btc24, vol: q, px: k[i].c });
    }
  }
  // daily bars for G1 (and monthly volume ranking at daily resolution)
  const d = await dailyBars(sym, fromMs - 40 * DAY, toMs);
  out.cov.days = d.length;
  out.daily = d.map((x) => ({ t: x.t, o: x.o, c: x.c, q: x.q }));
  for (let i = 1; i < d.length; i++) {
    if (d[i].t - d[i - 1].t !== DAY || d[i].t < fromMs) continue;
    const ret = (d[i].c / d[i - 1].c - 1) * 100;
    if (ret <= LOOSE.g1.drop && d[i].q > 0) out.g1.push({ s: sym, day: d[i].t, ret, q: d[i].q });
  }
  return out;
}

/* Monthly volume ranks over all symbols: Map ym -> Map sym -> rank (1 = largest). */
export function monthRanks(scans) {
  const byMonth = new Map();
  for (const s of scans) for (const [ym, v] of s.monthVol) (byMonth.get(ym) || byMonth.set(ym, []).get(ym)).push([s.sym, v]);
  const ranks = new Map();
  for (const [ym, arr] of byMonth) { arr.sort((a, b) => b[1] - a[1]); ranks.set(ym, new Map(arr.map(([s], i) => [s, i + 1]))); }
  return ranks;
}
const prevMonth = (ym) => { const d = new Date(ym + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
export { prevMonth };

/* Equal-weight basket of the 10 largest coins of the previous month, same direction, price move in % (no costs),
   on hourly opens. NaN when fewer than 5 coins have prices at both ends. */
export function basketMove(scans, ranks, tStart, tEnd, dir) {
  const ym = prevMonth(new Date(tStart).toISOString().slice(0, 7));
  const r = ranks.get(ym); if (!r) return NaN;
  const top = [...r.entries()].filter(([, rk]) => rk <= 25).sort((a, b) => a[1] - b[1]);
  const vals = [];
  const hs = Math.round(tStart / HOUR), he = Math.round(tEnd / HOUR);
  for (const [sym] of top) {
    const s = scans.byName.get(sym); if (!s?.hourly) continue;
    const { h0, arr } = s.hourly;
    const a = arr[hs - h0], b = arr[he - h0];
    if (!(a > 0) || !(b > 0)) continue;
    vals.push((dir === 'S' ? -1 : 1) * (b / a - 1) * 100);
    if (vals.length === 10) break;
  }
  return vals.length >= 5 ? vals.reduce((x, y) => x + y, 0) / vals.length : NaN;
}
