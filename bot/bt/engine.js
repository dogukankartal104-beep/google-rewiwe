// Backtest engine for protocol 1 (docs/fade-hud-sinav-protokol.md). Per coin: find signals, simulate each one
// on its own (fill, exit, costs, funding), keep only numbers. The portfolio rules (one per coin, at most 2 open)
// are applied afterwards, chronologically, in run.js.
import { loadKlines, loadFunding, makeOiAt } from './archive.js';
import { btEval, atr } from './hudcore.js';
import { rng, hash } from './stats.js';

const BAR = 15 * 60e3;
export const DEFAULTS = {
  minChg: 8,            // |24h move| to evaluate
  minStopPct: 4,        // skip setups whose stop is closer than this (% of entry)
  limitWait: 8,         // candles a limit order stays alive
  holdBars: 32,         // candles monitored from the fill candle (8 hours)
  costRt: 0.20,         // round-trip cost, % of notional (20 bp)
  costStopExtra: 0.20,  // extra slippage on stop exits (20 bp)
  fillBp: 0,            // strict variant: price must trade this many bp beyond the limit
  placebo: 3,           // placebo draws per signal and kind
};

/* Simulate one trade. Conservative rules: stop wins ties; on the fill candle a target only counts if the
   candle CLOSED beyond it (so price provably passed it after the fill). Pure function, unit-tested. */
export function simulate(k, i, dir, en, st, t1, p = DEFAULTS, funding = null) {
  const S = dir === 'S';
  const fillPx = en * (1 + ((S ? 1 : -1) * p.fillBp) / 1e4);
  const last = Math.min(k.length - 1, i + p.limitWait);
  let f = -1;
  for (let j = i + 1; j <= last; j++) { if (S ? k[j].h >= fillPx : k[j].l <= fillPx) { f = j; break; } }
  if (f < 0) return { filled: false, tEnd: k[last].t + BAR };
  const end = Math.min(k.length - 1, f + p.holdBars - 1);
  let exit = 'time', ex = k[end].c, xi = end;
  for (let j = f; j <= end; j++) {
    const stopHit = S ? k[j].h >= st : k[j].l <= st;
    if (stopHit && p.tie === 'target') {            // optimistic bound: if the target is inside the same candle, it wins
      const tp0 = S ? k[j].l <= t1 : k[j].h >= t1;
      if (tp0) { exit = 'tp'; ex = t1; xi = j; break; }
    }
    if (stopHit) { exit = 'stop'; ex = st; xi = j; break; }
    const tpHit = S ? k[j].l <= t1 : k[j].h >= t1;
    if (tpHit && (j > f || (S ? k[j].c <= t1 : k[j].c >= t1))) { exit = 'tp'; ex = t1; xi = j; break; }
  }
  const gross = (S ? (en - ex) : (ex - en)) / en * 100;
  const cost = p.costRt + (exit === 'stop' ? p.costStopExtra : 0);
  let fund = 0;
  if (funding) for (const e of funding) { if (e.t > k[f].t && e.t <= k[xi].t + BAR) fund += (S ? 1 : -1) * e.r * 100; }
  return {
    filled: true, exit, tFill: k[f].t, tEnd: k[xi].t + BAR, gross, cost, fund,
    net0: gross - cost,            // costs, no funding
    net: gross - cost + fund,      // costs and funding (the number the protocol judges)
  };
}

const frozen = (k, i) => {
  let q = 0, same = true;
  for (let j = i - 95; j <= i; j++) { q += k[j].q; if (k[j].h !== k[j].l) same = false; }
  return q <= 0 || same;
};

/* Scan one coin over [fromMs, toMs). Returns compact signals + placebo trades + coverage numbers. */
export async function scanCoin(sym, fromMs, toMs, p = DEFAULTS, btc = null) {
  const cov = { sym, bars: 0, missingMonths: [], evals: 0, signals: 0, noOi: 0, errors: 0, firstErr: null, frozen: 0 };
  const warm = 8 * 864e5, tail = 3 * 864e5;
  const { k, missing } = await loadKlines(sym, '15m', fromMs - warm, toMs + tail);
  cov.missingMonths = missing; cov.bars = k.length;
  if (k.length < 300) return { signals: [], placeboA: [], placeboB: [], cov };
  const funding = await loadFunding(sym, fromMs - 864e5, toMs + tail).catch(() => []);
  const A = atr(k, 14);
  const cvd = []; { let cu = 0; for (const x of k) { cu += 2 * x.tb - x.v; cvd.push(cu); } }
  const oiAt = makeOiAt(sym);
  const oiMiss = async (ts) => { const r = await oiAt(ts); if (!r) cov.noOi++; return r; };

  const signals = [], candS = [], candL = [];
  for (let i = 119; i < k.length - 1; i++) {
    const tS = k[i].t + BAR;
    if (tS < fromMs || tS >= toMs) continue;
    if (k[i].t - k[i - 96].t !== 96 * BAR) continue;                // gap in the data
    const chg = (k[i].c / k[i - 96].c - 1) * 100;
    const dir = chg >= p.minChg ? 'S' : chg <= -p.minChg ? 'L' : null;
    if (!dir) continue;
    if (frozen(k, i)) { cov.frozen++; continue; }
    (dir === 'S' ? candS : candL).push(i);
    cov.evals++;
    const a = Math.max(0, i - 499);
    let sg = null;
    try { sg = await btEval(k.slice(a, i + 1), A.slice(a, i + 1), cvd.slice(a, i + 1), i - a, oiMiss, dir); }
    catch (e) { cov.errors++; cov.firstErr ||= e.message; continue; }
    if (!sg) continue;
    const riskPct = Math.abs(sg.st - sg.en) / sg.en * 100;
    if (riskPct < p.minStopPct) continue;
    const r = simulate(k, i, dir, sg.en, sg.st, sg.t1, p, funding);
    cov.signals++;
    // Entry-time features (everything known when the candle closed; nothing from the future)
    let qv = 0; for (let j = i - 95; j <= i; j++) qv += k[j].q;
    let v20 = 0; for (let j = i - 20; j < i; j++) v20 += k[j].v;
    let fundNow = null; for (const e of funding) { if (e.t <= tS) fundNow = e.r * 100; else break; }
    const sgn = dir === 'S' ? 1 : -1;
    const bi = btc?.idx.get(k[i].t);
    const feat = {
      chg24: chg, qv24: Math.log10(Math.max(qv, 1)), atrPct: A[i] / k[i].c * 100,
      hr: new Date(tS).getUTCHours(), dow: new Date(tS).getUTCDay(),
      fundNow, ret4: sgn * (k[i].c / k[i - 4].c - 1) * 100, volX: k[i].v / ((v20 / 20) || 1),
      limDist: Math.abs(sg.en - k[i].c) / k[i].c * 100, ratio: sg.ratio, trN: sg.trN, sweep: sg.sweep ? 1 : 0, rrPlan: sg.rr,
      btc24: bi >= 96 ? (btc.k[bi].c / btc.k[bi - 96].c - 1) * 100 : null,
      btc1h: bi >= 4 ? (btc.k[bi].c / btc.k[bi - 4].c - 1) * 100 : null,
    };
    signals.push({ s: sym, dir, tS, en: sg.en, riskPct, grade: sg.grade, type: sg.type, mode: sg.mode, exN: sg.exN, leg: sg.leg, oiChg: sg.oiChg, ses: sg.ses, ...feat, ...r });
  }

  // Placebo: the same trade (side, stop distance, limit mechanics) at other times on the same coin.
  //  A = any random time;  B = a random time that also had a >= minChg move in the same direction.
  const placeboA = [], placeboB = [];
  for (const sg of signals) {
    const R = rng(hash(sym + sg.tS));
    const draw = (kind) => {
      for (let tries = 0; tries < 30; tries++) {
        let j;
        if (kind === 'B') { const pool = sg.dir === 'S' ? candS : candL; if (!pool.length) return null; j = pool[(R() * pool.length) | 0]; }
        else j = 119 + ((R() * (k.length - 200)) | 0);
        const d = Math.abs(j - Math.round((sg.tS - BAR - k[0].t) / BAR));
        if (d < 2 * 96 || j < 119 || j >= k.length - p.limitWait - p.holdBars - 1) continue;   // not too close to the real one
        const en = k[j].c, rp = sg.riskPct / 100;
        const st = sg.dir === 'S' ? en * (1 + rp) : en * (1 - rp), t1 = sg.dir === 'S' ? en * (1 - rp) : en * (1 + rp);
        return { tS: k[j].t + BAR, dir: sg.dir, ...simulate(k, j, sg.dir, en, st, t1, p, funding) };
      }
      return null;
    };
    for (let n = 0; n < p.placebo; n++) { const a = draw('A'); if (a) placeboA.push(a); const b = draw('B'); if (b) placeboB.push(b); }
  }
  cov.oiFailed = oiAt.failed();
  return { signals, placeboA, placeboB, cov };
}

/* Chronological portfolio filter: one position or pending order per coin, at most maxOpen at once. */
export function portfolio(signals, maxOpen = 2) {
  const sorted = [...signals].sort((a, b) => a.tS - b.tS || a.s.localeCompare(b.s));
  const taken = [], lock = new Map();
  for (const x of sorted) {
    if ((lock.get(x.s) || 0) > x.tS) continue;
    const live = taken.filter((y) => y.tEnd > x.tS).length;
    if (live >= maxOpen) continue;
    taken.push(x); lock.set(x.s, x.tEnd);
  }
  return taken;
}
