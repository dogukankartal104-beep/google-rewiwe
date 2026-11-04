// Turn candidates into simulated trades (1m path), with delay variants, placebo trades and the basket benchmark.
import { minuteBars, fundingOf } from './data.js';
import { runTrade } from './trade.js';
import { basketMove, monthRanks, prevMonth } from './scan.js';

const DAY = 864e5, HOUR = 36e5, MIN = 6e4;
export const DELAYS = [0, 5, 15, 30, 60];
export const periodOf = (t) => (t < Date.UTC(2024, 0, 1) ? 'KESIF' : t < Date.UTC(2026, 0, 1) ? 'DOGRULAMA' : 'SON');

async function simulate({ sym, dir, tEntry, tExit, stopPct, delays = DELAYS }) {
  const { k, missingDays } = await minuteBars(sym, tEntry - 5 * MIN, tExit + 40 * MIN);
  if (!k.length) return { ok: false, why: 'no 1m data', missingDays };
  const funding = await fundingOf(sym, tEntry, tExit + HOUR);
  const base = runTrade({ k, dir, tEntryMs: tEntry, tExitMs: tExit, stopPct, funding });
  if (!base.ok) return { ...base, missingDays };
  const dl = {};
  for (const d of delays) {
    const r = d === 0 ? base : runTrade({ k, dir, tEntryMs: tEntry + d * MIN, tExitMs: tExit, stopPct, funding });
    dl[d] = r.ok ? r.net : null;
  }
  return { ...base, delays: dl, missingDays };
}

async function placebo({ sym, dir, tEntry, tExit, stopPct }) {
  const out = {};
  for (const shift of [3, 14]) {
    const r = await simulate({ sym, dir, tEntry: tEntry - shift * DAY, tExit: tExit - shift * DAY, stopPct, delays: [0] });
    out['p' + shift] = r.ok ? r.net : null;
  }
  return out;
}

async function limited(items, n, fn) {
  const q = [...items], out = [];
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) { const it = q.shift(); try { out.push(await fn(it)); } catch (e) { out.push({ err: e.message }); } } }));
  return out;
}

export async function buildV1k(cands, scans, ranks, onProgress) {
  let done = 0;
  const res = await limited(cands, 4, async (c) => {
    const tEntry = c.tSig, tExit = c.tSig + DAY;
    const r = await simulate({ sym: c.s, dir: 'S', tEntry, tExit, stopPct: 50 });
    onProgress?.(++done, cands.length);
    if (!r.ok) return { fail: r.why, s: c.s, tSig: c.tSig };
    const pl = await placebo({ sym: c.s, dir: 'S', tEntry, tExit, stopPct: 50 });
    const bk = basketMove(scans, ranks, tEntry, tExit, 'S');
    return { eng: 'v1k', ...c, period: periodOf(c.tSig), ...r, ...pl, basket: bk };
  });
  return res;
}

export async function buildG1(cands, scans, ranks, onProgress) {
  const jobs = [];
  for (const c of cands) {
    const ym = new Date(c.day).toISOString().slice(0, 7);
    const rankS = ranks.get(ym)?.get(c.s) ?? 999, rankD = ranks.get(prevMonth(ym))?.get(c.s) ?? 999;
    if (rankS <= 50 || rankD <= 50) jobs.push({ ...c, rankS, rankD });
  }
  let done = 0;
  const res = await limited(jobs, 4, async (c) => {
    const tEntry = c.day + DAY, tExit = tEntry + 3 * DAY;
    const out = { eng: 'g1', ...c, tSig: c.day + DAY, period: periodOf(c.day + DAY) };
    for (const [name, stopPct] of [['none', null], ['s33', 33]]) {
      const r = await simulate({ sym: c.s, dir: 'L', tEntry, tExit, stopPct });
      out[name] = r.ok ? r : { ok: false, why: r.why };
    }
    onProgress?.(++done, jobs.length);
    if (!out.none.ok) return { fail: out.none.why, s: c.s, tSig: out.tSig };
    const pl = await placebo({ sym: c.s, dir: 'L', tEntry, tExit, stopPct: null });
    return { ...out, ...pl, basket: basketMove(scans, ranks, tEntry, tExit, 'L') };
  });
  return res;
}
