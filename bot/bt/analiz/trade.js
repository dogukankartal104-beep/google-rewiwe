// One trade on 1m candles. Pure: takes candles and funding, returns the outcome. (Protocol section 1.)
export const COST = { fee: 0.10, slip: 0.05, stopExtra: 0.20 };       // % of notional

/* dir 'S' | 'L'; entry at the first candle with t >= tEntryMs (open price); time exit at the open of the first
   candle with t >= tExitMs; stop as a percentage move against the entry (null = none).
   Candles with zero volume cannot trigger a stop; liquidation (L-times leverage, 0.5% maintenance) is tracked. */
export function runTrade({ k, dir, tEntryMs, tExitMs, stopPct = null, funding = [], levs = [1, 2, 3] }) {
  const S = dir === 'S';
  let i0 = k.findIndex((x) => x.t >= tEntryMs && x.v > 0);
  if (i0 < 0 || k[i0].t - tEntryMs > 30 * 60e3) return { ok: false, why: 'no entry candle' };
  const entry = k[i0].o;
  const stop = stopPct === null ? null : (S ? entry * (1 + stopPct / 100) : entry * (1 - stopPct / 100));
  const liq = {}; levs.forEach((L) => { liq[L] = S ? entry * (1 + 1 / L - 0.005) : entry * (1 - 1 / L + 0.005); });
  const hitLiq = {}; levs.forEach((L) => { hitLiq[L] = false; });
  let exit = 'time', exitPx = null, tExit = null, maxAdv = 0, lastValid = entry;
  for (let i = i0; i < k.length; i++) {
    const c = k[i];
    if (c.t >= tExitMs) { exitPx = c.v > 0 ? c.o : lastValid; tExit = c.t; break; }
    if (c.v <= 0) continue;
    lastValid = c.c;
    const adv = S ? (c.h - entry) / entry * 100 : (entry - c.l) / entry * 100;
    maxAdv = Math.max(maxAdv, adv);
    const stopHit = stop !== null && (S ? c.h >= stop : c.l <= stop);
    for (const L of levs) if (!hitLiq[L] && (S ? c.h >= liq[L] : c.l <= liq[L])) hitLiq[L] = stopHit ? false : true;
    // a liquidation before the stop: the first candle that touches liq without touching the stop
    if (stopHit) { exit = 'stop'; exitPx = stop; tExit = c.t; for (const L of levs) if (S ? stop >= liq[L] : stop <= liq[L]) hitLiq[L] = true; break; }
  }
  if (exitPx === null) return { ok: false, why: 'path ends before exit' };
  const gross = (S ? (entry - exitPx) : (exitPx - entry)) / entry * 100;
  let fund = 0;
  for (const e of funding) if (e.t > k[i0].t && e.t <= tExit) fund += (S ? 1 : -1) * e.r * 100;
  const cost = COST.fee + COST.slip + (exit === 'stop' ? COST.stopExtra : 0);
  return { ok: true, entry, exitPx, exit, gross, cost, fund, net: gross - cost + fund, maxAdv, tEntry: k[i0].t, tExit, liq: hitLiq };
}
