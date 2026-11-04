// Multi-part short simulation (take-profit ladder) and the in-trade checks for early exits.
// Protocols: docs/v1-tp-protokol.md and docs/stop-ayir-protokol.md.
export const FEE = 0.10, SLIP = 0.05, STOP_EXTRA = 0.20;       // % of the part's notional

/* parts: [{frac, tp}] with tp = take-profit distance in % below the entry (null = none). Short only.
   k: 1m candles, i0: entry index (entry = open of k[i0]). be: move the stop to the entry after the first part's TP
   (effective from the NEXT candle). Same-candle stop and TP: the stop wins. Zero-volume candles cannot trigger. */
export function simulateParts({ k, i0, parts, stopPct = 50, be = false, funding = [], holdMs = 864e5 }) {
  const entry = k[i0].o, t0 = k[i0].t;
  const stop0 = entry * (1 + stopPct / 100);
  const st = parts.map((p) => ({ ...p, px: p.tp == null ? null : entry * (1 - p.tp / 100), done: false }));
  let beNext = false, beActive = false, lastValid = entry, ended = false;
  for (let j = i0; j < k.length && !ended; j++) {
    const c = k[j];
    if (beNext) { beActive = true; beNext = false; }
    if (c.t >= t0 + holdMs) { const px = c.v > 0 ? c.o : lastValid; st.forEach((p) => { if (!p.done) { p.done = true; p.exit = 'time'; p.xpx = px; p.xt = c.t; } }); ended = true; break; }
    if (c.v <= 0) continue;
    lastValid = c.c;
    const stopEff = beActive ? entry : stop0;
    if (c.h >= stopEff) { st.forEach((p) => { if (!p.done) { p.done = true; p.exit = 'stop'; p.xpx = stopEff; p.xt = c.t; } }); ended = true; break; }
    let hit1 = false;
    st.forEach((p, idx) => { if (!p.done && p.px !== null && c.l <= p.px) { p.done = true; p.exit = 'tp'; p.xpx = p.px; p.xt = c.t; if (idx === 0) hit1 = true; } });
    if (be && hit1) beNext = true;
    if (st.every((p) => p.done)) { ended = true; break; }
  }
  if (!st.every((p) => p.done)) return { ok: false, why: 'path ends before the 24h exit' };
  let net = 0, tEnd = 0;
  const out = st.map((p) => {
    const gross = (entry - p.xpx) / entry * 100;
    const cost = FEE + SLIP + (p.exit === 'stop' ? STOP_EXTRA : 0);
    let fund = 0; for (const e of funding) if (e.t > t0 && e.t <= p.xt) fund += e.r * 100;      // short receives positive funding
    const n = gross - cost + fund;
    net += p.frac * n; tEnd = Math.max(tEnd, p.xt);
    return { frac: p.frac, exit: p.exit, gross, net: n, xt: p.xt };
  });
  return { ok: true, entry, tEntry: t0, tExit: tEnd, net, parts: out, stopped: out.some((p) => p.exit === 'stop'), exit: out.some((p) => p.exit === 'stop') ? 'stop' : out.every((p) => p.exit === 'tp') ? 'tp' : 'time' };
}

/* Net of closing a fraction at the open of candle index jx (market exit), for a short opened at k[i0]. */
export function earlyClose({ k, i0, jx, funding = [] }) {
  const entry = k[i0].o, t0 = k[i0].t;
  const px = k[jx].v > 0 ? k[jx].o : k[jx - 1].c;
  const gross = (entry - px) / entry * 100;
  let fund = 0; for (const e of funding) if (e.t > t0 && e.t <= k[jx].t) fund += e.r * 100;
  return { net: gross - FEE - SLIP + fund, gross, t: k[jx].t };
}

const latest = (recs, ts) => { let lo = 0, hi = recs.length - 1, b = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (recs[m].t <= ts) { b = m; lo = m + 1; } else hi = m - 1; } return b; };
export { latest };

/* Fuel: dollars of estimated short positions whose liquidation price lies between the current price and the stop. */
export function fuelRatio({ recs, iEntry, iNow, k, i0, tNow, stopPx, vol24 }) {
  const t0 = k[i0].t, LEVS = [5, 10, 25, 50, 100];
  const kIdx = (ts) => Math.floor((ts - k[0].t) / 6e4);
  const pNow = k[Math.min(k.length - 1, kIdx(tNow) - 1)].c;
  let fuel = 0;
  for (let m = iEntry + 1; m <= iNow; m++) {
    const dU = recs[m].u - recs[m - 1].u;
    if (!(dU > 0) || !(recs[m].gl > 0)) continue;
    const kj = Math.min(k.length - 1, Math.max(i0, kIdx(recs[m].t)));
    const p = k[kj].c, share = 1 / (1 + recs[m].gl);
    let maxHigh = 0; for (let j = kj; j < Math.min(k.length, kIdx(tNow)); j++) if (k[j].h > maxHigh) maxHigh = k[j].h;
    for (const L of LEVS) {
      const liq = p * (1 + 1 / L - 0.005);
      if (maxHigh >= liq) continue;                           // already liquidated on the way
      if (liq > pNow && liq <= stopPx) fuel += dU * share / LEVS.length;
    }
  }
  return vol24 > 0 ? fuel / vol24 : NaN;
}

/* Check events at every clock-aligned 15m close between entry and the baseline exit (strictly before it). */
export function checkEvents({ k, i0, recs, baseExitT, volume24 }) {
  const t0 = k[i0].t, entry = k[i0].o;
  const iE = latest(recs, t0);
  if (iE < 0) return { ok: false, why: 'no metrics at entry' };
  const e = recs[iE];
  if (!(e.u > 0) || !(e.gl > 0)) return { ok: false, why: 'bad metrics at entry' };
  const ev = [];
  let maxP = 0, jPrev = i0;
  const first = Math.floor(t0 / 9e5) * 9e5 + 9e5;
  for (let tc = first; tc < Math.min(baseExitT, t0 + 864e5); tc += 9e5) {
    const jx = Math.floor((tc - k[0].t) / 6e4);                    // index of the candle that opens at tc
    if (jx <= i0 || jx >= k.length || k[jx].t !== tc) continue;
    for (let j = jPrev; j < jx; j++) if (k[j].v > 0) maxP = Math.max(maxP, (k[j].h / entry - 1) * 100);
    jPrev = jx;
    const close = k[jx - 1].c, P = (close / entry - 1) * 100;
    const iN = latest(recs, tc);
    if (iN <= iE) { ev.push({ tc, jx, P, maxP, miss: true }); continue; }
    const r = recs[iN];
    let tk = 0, n = 0; for (let m = Math.max(0, iN - 11); m <= iN; m++) if (Number.isFinite(recs[m].tk)) { tk += recs[m].tk; n++; }
    ev.push({ tc, jx, P, maxP, dOI: (r.u / e.u - 1) * 100, dLS: (r.gl / e.gl - 1) * 100, taker: n ? tk / n : NaN, iN });
  }
  return { ok: true, ev, iE, recs, volume24, stopPx: entry * 1.5 };
}

/* First event that satisfies the cell's condition; fuel is computed lazily. */
export function firstTrigger(ce, cond, k, i0) {
  for (const x of ce.ev) {
    if (x.miss) continue;
    if (cond(x, () => fuelRatio({ recs: ce.recs, iEntry: ce.iE, iNow: x.iN, k, i0, tNow: x.tc, stopPx: ce.stopPx, vol24: ce.volume24 }))) return x;
  }
  return null;
}

export const CELLS_EARLY = {
  O1: (x) => x.dOI >= 60 && x.P >= 15,
  O2: (x) => x.dOI >= 100 && x.P >= 25,
  O3: (x, fuel) => x.dOI >= 100 && x.P >= 25 && fuel() >= 0.18,
  L1: (x) => x.dLS <= -15 && x.P >= 15,
  T1: (x) => x.taker >= 1.3 && x.P >= 15,
};
export const HALF = { Y1: 'O1', Y2: 'O2', Y3: 'L1' };

export const TP_CELLS = {
  TABAN: { parts: [{ frac: 1, tp: null }] },
  T15: { parts: [{ frac: 1, tp: 15 }] },
  T20: { parts: [{ frac: 1, tp: 20 }] },
  M1a: { parts: [{ frac: 1 / 3, tp: 5 }, { frac: 1 / 3, tp: 10 }, { frac: 1 / 3, tp: 20 }], be: false, tiers: 3 },
  M1b: { parts: [{ frac: 1 / 3, tp: 5 }, { frac: 1 / 3, tp: 10 }, { frac: 1 / 3, tp: 20 }], be: true, tiers: 3 },
  M2a: { parts: [{ frac: 1 / 3, tp: 8 }, { frac: 1 / 3, tp: 15 }, { frac: 1 / 3, tp: 25 }], be: false, tiers: 3 },
  M2b: { parts: [{ frac: 1 / 3, tp: 8 }, { frac: 1 / 3, tp: 15 }, { frac: 1 / 3, tp: 25 }], be: true, tiers: 3 },
  M3a: { parts: [{ frac: 1 / 2, tp: 10 }, { frac: 1 / 4, tp: 20 }, { frac: 1 / 4, tp: null }], be: false, tiers: 2 },
  M3b: { parts: [{ frac: 1 / 2, tp: 10 }, { frac: 1 / 4, tp: 20 }, { frac: 1 / 4, tp: null }], be: true, tiers: 2 },
};
TP_CELLS.T15.tiers = 1; TP_CELLS.T20.tiers = 1; TP_CELLS.TABAN.tiers = 0;
