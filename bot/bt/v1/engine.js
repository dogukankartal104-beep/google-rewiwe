// The v1k engine's trade logic, shared by the backtest (bt/v1/combo.js) and the live shadow tracker (src/shadow.js).
// Pure: candles in, outcome out. Protocol: docs/v1k-motor-protokol.md.
import { simulateParts, earlyClose, checkEvents, firstTrigger, CELLS_EARLY } from './sim.js';

export const FILTER_OI15 = 6.01;          // % OI growth in the last 15 minutes; derived on the discovery period (v1k-arge EK-1)
export const STOP_FROM_SIGNAL = 1.5;      // stop = signal price x 1.5 for every variant
const MIN = 6e4, M15 = 9e5, DAY = 864e5;
// The six variants recorded side by side (docs/v1k-motor-protokol.md section 2): F = oi15 filter, E1 = first red 15m candle entry, O1 = OI exit.
export const VARIANTS = {
  K0: { F: false, E1: false, O1: false }, K1: { F: true, E1: false, O1: false }, K2: { F: true, E1: false, O1: true },
  K3: { F: true, E1: true, O1: false }, K4: { F: true, E1: true, O1: true }, K5: { F: false, E1: true, O1: true },
};

/* k: contiguous 1m candles, i0: the candle that opens at the signal time (the first 15m close after the alarm).
   Returns {ok:true, net, te, tEntry, exit, entry} | {skip:true, why} | {pending:true, why} | {ok:false, why} (still open or data problem). */
export function engineEntry({ k, i0, tSig, funding = [], recs = [], vol = 0, useE1 = false, useO1 = false, delayMin = 0, entryIdx = null }) {
  const ref = k[i0].o;
  let ei = i0;
  if (entryIdx !== null) ei = entryIdx;          // entry chosen by the caller (e.g. a pullback confirmation); the stop still comes from the signal price
  else if (useE1) {
    ei = -1;
    for (let b = 0; b < 8; b++) {
      const s = i0 + b * 15;
      if (s + 15 >= k.length) return { pending: true, why: 'waiting for candles' };
      if (k[s + 14].c < k[s].o) { ei = s + 15; break; }
    }
    if (ei < 0) return { skip: true, why: 'no red 15m candle in 2h' };
  }
  ei += delayMin;
  if (ei >= k.length) return { pending: true, why: 'entry candle not yet available' };
  const entry = k[ei].o, stopPx = ref * STOP_FROM_SIGNAL;
  if (!(entry < stopPx)) return { skip: true, why: 'price already above the stop' };
  const holdMs = tSig + DAY - k[ei].t;
  if (holdMs <= 0) return { skip: true, why: 'no time left' };
  const base = simulateParts({ k, i0: ei, parts: [{ frac: 1, tp: null }], stopPct: (stopPx / entry - 1) * 100, funding, holdMs });
  if (!base.ok) {
    // not finished: an early exit could still have fired on the data we have
    if (!useO1) return { ok: false, why: base.why };
  }
  let net = base.ok ? base.net : null, te = base.ok ? base.tExit : null, exit = base.ok ? base.exit : null;
  if (useO1) {
    const ce = checkEvents({ k, i0: ei, recs, baseExitT: base.ok ? base.tExit : k[k.length - 1].t + MIN, volume24: vol });
    if (ce.ok) {
      const x = firstTrigger(ce, CELLS_EARLY.O1, k, ei);
      if (x && x.jx < k.length) { const ec = earlyClose({ k, i0: ei, jx: x.jx, funding }); net = ec.net; te = ec.t; exit = 'o1'; }
    }
  }
  if (net === null) return { ok: false, why: 'open' };
  return { ok: true, net, te, tEntry: k[ei].t, exit, entry };
}
