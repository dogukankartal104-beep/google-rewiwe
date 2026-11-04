// The ten analyses of docs/analiz-protokol.md, as pure functions over trade records.
import { rng } from '../stats.js';

export const f = (v, d = 2) => (v === undefined || v === null || Number.isNaN(v) ? '—' : (+v).toFixed(d));
export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
export const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const weekOf = (t) => Math.floor((t + 3 * 864e5) / (7 * 864e5));

/* Week-clustered bootstrap, two-sided 90% interval of the mean (5th and 95th percentile). */
export function ci90(items, val = (x) => x.net, key = (x) => x.tSig, B = 2000, seed = 17) {
  if (items.length < 5) return [NaN, NaN];
  const wk = new Map();
  for (const x of items) { const v = val(x); if (!Number.isFinite(v)) continue; const w = weekOf(key(x)); (wk.get(w) || wk.set(w, []).get(w)).push(v); }
  const weeks = [...wk.values()], sums = weeks.map((w) => w.reduce((a, b) => a + b, 0)), cnt = weeks.map((w) => w.length);
  const r = rng(seed), ms = [];
  for (let b = 0; b < B; b++) { let s = 0, c = 0; for (let i = 0; i < weeks.length; i++) { const j = (r() * weeks.length) | 0; s += sums[j]; c += cnt[j]; } ms.push(c ? s / c : 0); }
  ms.sort((a, b) => a - b);
  return [ms[Math.floor(0.05 * B)], ms[Math.floor(0.95 * B)]];
}

export function summary(items, val = (x) => x.net) {
  const v = items.map(val).filter(Number.isFinite);
  if (!v.length) return { n: 0 };
  const [lo, hi] = ci90(items, val);
  const top5 = [...v].sort((a, b) => b - a).slice(5);
  const worst = Math.min(...v);
  // largest single-day share of the total net profit (only meaningful when the total is positive)
  const byDay = new Map(); items.forEach((x) => { const d = Math.floor(x.tSig / 864e5); byDay.set(d, (byDay.get(d) || 0) + val(x)); });
  const tot = v.reduce((a, b) => a + b, 0), best = Math.max(...byDay.values());
  return { n: v.length, mean: mean(v), median: median(v), win: v.filter((x) => x > 0).length / v.length * 100, lo, hi, exTop5: top5.length ? mean(top5) : NaN, worst, dayShare: tot > 0 ? best / tot * 100 : NaN, total: tot };
}
export const row = (name, s) => (s.n ? `| ${name} | ${s.n} | ${f(s.mean)} | ${f(s.median)} | ${f(s.win, 0)}% | ${f(s.lo)} … ${f(s.hi)} | ${f(s.exTop5)} | ${f(s.worst, 1)} |` : `| ${name} | 0 | — | — | — | — | — | — |`);
export const TABLE_HEAD = '| grup | n | ort % | ortanca % | kazanma | %90 aralık | en iyi 5 hariç | en kötü % |\n|---|---|---|---|---|---|---|---|';

/* Cooldown per coin on a filtered, time-sorted list. */
export function cooldown(items, hours) {
  const last = new Map(), out = [];
  for (const x of [...items].sort((a, b) => a.tSig - b.tSig)) { if (last.has(x.s) && x.tSig - last.get(x.s) < hours * 36e5) continue; out.push(x); last.set(x.s, x.tSig); }
  return out;
}

/* Follower account: 1000 $, `frac` of the balance as margin per signal, leverage L, optional caps. */
export function follower(trades, { L = 1, frac = 0.05, perDay = Infinity, maxOpen = Infinity, start = 1000 } = {}) {
  const t = [...trades].sort((a, b) => a.tEntry - b.tEntry);
  let bal = start; const open = [], curve = [], perD = new Map(), pnls = [];
  const settle = (upTo) => { open.sort((a, b) => a.tExit - b.tExit); while (open.length && open[0].tExit <= upTo) { const o = open.shift(); bal += o.pnl; pnls.push(o); curve.push({ t: o.tExit, bal }); } };
  let taken = 0;
  for (const x of t) {
    settle(x.tEntry);
    const d = Math.floor(x.tEntry / 864e5);
    if ((perD.get(d) || 0) >= perDay || open.length >= maxOpen) continue;
    perD.set(d, (perD.get(d) || 0) + 1);
    const margin = Math.max(0, bal) * frac, liq = x.liq?.[L];
    open.push({ tExit: x.tExit, pnl: liq ? -margin : margin * L * x.net / 100, liq: !!liq, net: x.net }); taken++;
  }
  settle(Infinity);
  let peak = start, dd = 0; for (const c of curve) { peak = Math.max(peak, c.bal); dd = Math.min(dd, (c.bal - peak) / peak * 100); }
  let streak = 0, longest = 0; for (const o of pnls) { streak = o.pnl < 0 ? streak + 1 : 0; longest = Math.max(longest, streak); }
  const byMonth = new Map(); let prev = start;
  for (const c of curve) { const m = new Date(c.t).toISOString().slice(0, 7); byMonth.set(m, (byMonth.get(m) || 0) + (c.bal - prev)); prev = c.bal; }
  return { taken, final: bal, ret: (bal / start - 1) * 100, dd, longest, liqs: pnls.filter((o) => o.liq).length, byMonth };
}

/* Monthly summary over a calendar span (months without trades count as 0). */
export function monthly(byMonth, fromMs, toMs) {
  const vals = [];
  for (let m = new Date(fromMs); m.getTime() < toMs; m.setUTCMonth(m.getUTCMonth() + 1)) vals.push(byMonth.get(m.toISOString().slice(0, 7)) || 0);
  return { expected: mean(vals), worst: vals.length ? Math.min(...vals) : NaN, months: vals.length };
}

export const pctRank = (arr, v) => (arr.length ? arr.filter((x) => x <= v).length / arr.length * 100 : NaN);
