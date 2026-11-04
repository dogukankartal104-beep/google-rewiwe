// Data access for the three-engine analysis (docs/analiz-protokol.md). Everything comes from the Binance archive.
import { csvText, parseKlines, klinesDaily, klinesMonthly, loadFunding, dayKey } from '../archive.js';

const MIN = 60e3, DAY = 864e5;
const cache = new Map();                     // 'SYM|YYYY-MM-DD' -> candles (insertion-ordered LRU)
const LIMIT = 4000;

async function dayMinutes(sym, day) {
  const key = sym + '|' + day;
  if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
  let rows = null;
  const t = await csvText(klinesDaily(sym, '1m', day));
  if (t) rows = parseKlines(t);
  cache.set(key, rows || []);
  if (cache.size > LIMIT) cache.delete(cache.keys().next().value);
  return rows || [];
}

/* 1m candles with open time in [fromMs, toMs). Returns {k, missingDays}. A day with no file is counted, not hidden. */
export async function minuteBars(sym, fromMs, toMs) {
  const out = []; let missing = 0;
  for (let d = Math.floor(fromMs / DAY) * DAY; d < toMs; d += DAY) {
    const rows = await dayMinutes(sym, dayKey(d));
    if (!rows.length) missing++;
    for (const r of rows) if (r.t >= fromMs && r.t < toMs) out.push(r);
  }
  return { k: out, missingDays: missing };
}

const fcache = new Map();
export async function fundingOf(sym, fromMs, toMs) {
  const key = sym;
  let all = fcache.get(key);
  if (!all) { all = await loadFunding(sym, Date.UTC(2021, 10, 1), Date.now()).catch(() => []); fcache.set(key, all); }
  return all.filter((e) => e.t >= fromMs && e.t <= toMs);
}

/* Daily candles for a symbol (1d monthly files); delisted coins just have fewer months. */
export async function dailyBars(sym, fromMs, toMs) {
  const out = [];
  const first = new Date(fromMs); first.setUTCDate(1); first.setUTCHours(0, 0, 0, 0);
  for (let m = new Date(first); m.getTime() < toMs; m.setUTCMonth(m.getUTCMonth() + 1)) {
    const ym = m.toISOString().slice(0, 7);
    const t = await csvText(klinesMonthly(sym, '1d', ym));
    if (t) out.push(...parseKlines(t));
    else if (m.getTime() > Date.now() - 40 * DAY) {      // current month: daily files
      const mEnd = Math.min(toMs, Date.now() - DAY);
      for (let d = m.getTime(); d < mEnd; d += DAY) { const tt = await csvText(klinesDaily(sym, '1d', dayKey(d))); if (tt) out.push(...parseKlines(tt)); }
    }
  }
  return out.filter((r) => r.t >= fromMs && r.t < toMs);
}
