#!/usr/bin/env node
// Protocol 4 (docs/fade-hud-sinav-protokol-4.md). Descriptive measurements on a run, plus the single H1 exam.
// Usage: node bt/measure4.js --run bt/out/p1-full [--exam]        (--exam is meant for the unseen run, once)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKlines } from './archive.js';
import { summarize, equityTest } from './stats.js';
import { gridKeys } from './enrich.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const runDir = path.resolve(arg('run', path.join(HERE, 'out', 'p1-full')));
const EXAM = process.argv.includes('--exam');
const split = Date.parse(arg('split', '2025-10-01') + 'T00:00:00Z');
const BAR = 9e5, HOUR = 36e5;
const f3 = (v, d = 3) => (v === undefined || v === null || Number.isNaN(v) ? '—' : (+v).toFixed(d));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

/* ---------- load ---------- */
const all = [], filled = [];
const enrichedDir = path.join(runDir, 'enriched');
const hasEnriched = fs.existsSync(enrichedDir);
for (const f of fs.readdirSync(path.join(runDir, 'coins'))) {
  const sym = f.replace('.json', '');
  const j = JSON.parse(fs.readFileSync(path.join(runDir, 'coins', f), 'utf8'));
  for (const x of j.signals || []) all.push({ s: sym, tS: x.tS });
  if (!hasEnriched) for (const x of j.signals || []) if (x.filled) filled.push({ s: sym, ...x });
}
if (hasEnriched) for (const f of fs.readdirSync(enrichedDir)) filled.push(...JSON.parse(fs.readFileSync(path.join(enrichedDir, f), 'utf8')));
if (!filled.length) { console.log('no trades'); process.exit(0); }

/* concurrency: how many different coins signalled in the same hour */
const perHour = new Map();
for (const x of all) { const h = Math.floor(x.tS / HOUR); (perHour.get(h) || perHour.set(h, new Set()).get(h)).add(x.s); }
/* BTC context from the archive (cached) */
const tMin = Math.min(...filled.map((x) => x.tS)), tMax = Math.max(...filled.map((x) => x.tS));
const { k: btc } = await loadKlines('BTCUSDT', '15m', tMin - 6 * 864e5, tMax + 864e5);
const bIdx = new Map(btc.map((x, i) => [x.t, i]));
for (const x of filled) {
  x.conc = perHour.get(Math.floor(x.tS / HOUR))?.size ?? 1;
  const i = bIdx.get(x.tS - BAR);
  if (i !== undefined && i >= 288) {
    x.btc4h = (btc[i].c / btc[i - 16].c - 1) * 100;
    let lowI = i; for (let j = i - 288; j <= i; j++) if (btc[j].l < btc[lowI].l) lowI = j;
    x.hrsLow = (i - lowI) / 4;
  } else { x.btc4h = null; x.hrsLow = null; }
}

/* ---------- realistic account ---------- */
export function capped(trades, { maxOpen = 2, holdBars = null, dailyStopR = null, valKey = 'net' } = {}) {
  const end = (x) => (holdBars ? x.tFill + holdBars * BAR : x.tEnd);
  const taken = [], lock = new Map();
  for (const x of [...trades].sort((a, b) => a.tS - b.tS)) {
    if ((lock.get(x.s) || 0) > x.tS) continue;
    if (taken.filter((y) => y._end > x.tS).length >= maxOpen) continue;
    if (dailyStopR !== null) {
      const d = Math.floor(x.tS / 864e5);
      const r = taken.filter((y) => Math.floor(y.tS / 864e5) === d && y._end <= x.tS).reduce((a, y) => a + y[valKey] / y.riskPct, 0);
      if (r <= dailyStopR) continue;
    }
    const t = { ...x, _end: end(x) }; taken.push(t); lock.set(x.s, t._end);
  }
  return taken;
}
const stat = (arr, key = 'net') => summarize(arr, (x) => x[key]);
const line = (name, s) => (s.n ? `${name.padEnd(30)} n=${String(s.n).padStart(5)}  mean ${f3(s.mean)}%  median ${f3(s.median)}%  win ${f3(s.win, 1)}%  LB90 ${f3(s.lb90)}%  halves ${f3(s.h1)} / ${f3(s.h2)}  exTop5 ${f3(s.exTop5)}` : `${name.padEnd(30)} n=0`);
const L = [`PROTOCOL 4 · ${new Date().toISOString()} · run ${path.basename(runDir)} · filled trades ${filled.length} · ${new Date(tMin).toISOString().slice(0, 10)} → ${new Date(tMax).toISOString().slice(0, 10)}`, ''];

const bucket = (title, arr, keyFn, order) => {
  const m = new Map(); arr.forEach((x) => { const k = keyFn(x); if (k !== null) (m.get(k) || m.set(k, []).get(k)).push(x); });
  L.push(title);
  [...m.keys()].sort(order).forEach((k) => { const v = m.get(k); L.push(`  ${String(k).padEnd(12)} n=${String(v.length).padStart(6)}  mean ${f3(mean(v.map((x) => x.net))).padStart(8)}%  win ${f3(v.filter((x) => x.net > 0).length / v.length * 100, 1).padStart(5)}%${v.length < 100 ? '  (n<100: noise)' : ''}`); });
};
const asc = (a, b) => (a < b ? -1 : 1);

if (!EXAM) {
  /* ===== A ===== */
  L.push('A. MARKET-WIDE CONTEXT (all filled trades, protocol 1 trade, costs and funding included)');
  for (const side of ['L', 'S']) {
    const arr = filled.filter((x) => x.dir === side);
    L.push(`--- ${side === 'L' ? 'LONG' : 'SHORT'} signals ---`);
    bucket('coins signalling in the same hour', arr, (x) => (x.conc <= 1 ? '1' : x.conc <= 3 ? '2-3' : x.conc <= 9 ? '4-9' : x.conc <= 29 ? '10-29' : '30+'), (a, b) => parseInt(a) - parseInt(b));
    bucket('BTC 24h change', arr, (x) => (x.btc24 === null ? null : x.btc24 < -6 ? '< -6%' : x.btc24 < -3 ? '-6..-3%' : x.btc24 < 0 ? '-3..0%' : x.btc24 < 3 ? '0..3%' : x.btc24 < 6 ? '3..6%' : '> 6%'), (a, b) => (a < b ? -1 : 1));
    bucket('BTC 4h change', arr, (x) => (x.btc4h === null ? null : x.btc4h < -2 ? '< -2%' : x.btc4h < -0.5 ? '-2..-0.5%' : x.btc4h < 0.5 ? '-0.5..0.5%' : x.btc4h < 2 ? '0.5..2%' : '> 2%'), asc);
    bucket('hours since BTC 72h low', arr, (x) => (x.hrsLow === null ? null : x.hrsLow < 4 ? '< 4h' : x.hrsLow < 12 ? '4-12h' : x.hrsLow < 36 ? '12-36h' : '> 36h'), (a, b) => parseFloat(a.replace('<', '0').replace('>', '99')) - parseFloat(b.replace('<', '0').replace('>', '99')));
  }
  L.push('');

  /* ===== B ===== */
  L.push('B. REALISTIC ACCOUNT (max 2 open, one per coin, first come; occupancy = full hold, pending orders not counted)');
  const hasGrid = filled.some((x) => x.g);
  const proto1 = capped(filled);
  L.push(line('protocol 1 trade, capped', stat(proto1)));
  L.push(line('LONG, BTC24 < -3%, capped', stat(capped(filled.filter((x) => x.dir === 'L' && x.btc24 !== null && x.btc24 < -3)))));
  L.push(line('LONG, BTC24 >= -3%, capped', stat(capped(filled.filter((x) => x.dir === 'L' && !(x.btc24 !== null && x.btc24 < -3))))));
  L.push(line('SHORT, capped', stat(capped(filled.filter((x) => x.dir === 'S')))));
  if (hasGrid) {
    L.push('', 'exit grid with the cap · cell: discovery mean (n) / decision mean (n)');
    const rows = gridKeys.map((key, c) => {
      const hold = Number(key.split('/')[2]);
      const arr = filled.filter((x) => x.g && x.g[c] !== null && x.g[c] !== undefined).map((x) => ({ ...x, net: x.g[c] }));
      const t = capped(arr, { holdBars: hold });
      const d1 = t.filter((x) => x.tS < split), d2 = t.filter((x) => x.tS >= split);
      return { key, md: mean(d1.map((x) => x.net)), nd: d1.length, mc: mean(d2.map((x) => x.net)), nc: d2.length };
    }).sort((a, b) => b.md - a.md);
    rows.slice(0, 12).forEach((r) => L.push(`  ${r.key.padEnd(10)} ${f3(r.md).padStart(8)} (${r.nd})   /   ${f3(r.mc).padStart(8)} (${r.nc})`));
    const base = rows.find((r) => r.key === '1/1/32');
    L.push(`  protocol 1 cell 1/1/32: ${f3(base.md)} (${base.nd}) / ${f3(base.mc)} (${base.nc}) · best on discovery ${rows[0].key} → decision ${f3(rows[0].mc)}`);
  }
  L.push('');

  /* ===== C ===== */
  L.push('C. SIGNAL QUALITY');
  bucket('first signal on the coin in 30 days?', filled, (x) => (x.sigCount30d === undefined ? null : x.sigCount30d === 0 ? 'first' : 'repeat'), asc);
  const q = [...filled.map((x) => x.qv24)].sort((a, b) => a - b), q1 = q[Math.floor(q.length / 3)], q2 = q[Math.floor(2 * q.length / 3)];
  bucket('coin size (24h volume tertile)', filled, (x) => (x.qv24 < q1 ? '1 small' : x.qv24 < q2 ? '2 mid' : '3 large'), asc);
  bucket('leg size %', filled, (x) => (x.leg < 20 ? '15-20' : x.leg < 30 ? '20-30' : x.leg < 50 ? '30-50' : '50+'), (a, b) => parseInt(a) - parseInt(b));
  bucket('stop size %', filled, (x) => (x.riskPct < 5 ? '4-5' : x.riskPct < 6 ? '5-6' : '6+'), asc);
  L.push('');
}

/* ===== H1 / D ===== */
const H1 = (arr) => capped(arr.filter((x) => x.dir === 'L' && x.btc24 !== null && x.btc24 < -3));
const CTRL = (arr) => capped(arr.filter((x) => x.dir === 'L' && x.btc24 !== null && x.btc24 >= -3));
if (EXAM) {
  L.push('H1 EXAM · LONG signals while BTC 24h < -3% · realistic account (max 2 open) · run once on the unseen period');
  const t = H1(filled), c = CTRL(filled);
  const s = stat(t), sc = stat(c);
  L.push(line('H1 trades', s)); L.push(line('control (BTC24 >= -3%)', sc));
  const checks = [
    ['1. mean net % > 0', s.n > 0 && s.mean > 0],
    ['2. 90% lower bound > 0', s.lb90 > 0],
    ['3. both halves positive', s.h1 > 0 && s.h2 > 0],
    ['4. mean without best 5 > 0', s.exTop5 > 0],
    ['5. beats the control', s.mean > sc.mean],
    ['6. at least 100 trades', s.n >= 100],
  ];
  L.push('PASS CONDITIONS'); checks.forEach(([n, ok]) => L.push(`${ok ? 'PASS' : 'FAIL'}  ${n}`));
  L.push(checks.every(([, ok]) => ok) ? 'RESULT: H1 PASSED on the unseen period' : s.n < 100 ? 'RESULT: NOT ENOUGH DATA to judge H1' : 'RESULT: H1 DOES NOT PASS');
  L.push('');
} else {
  L.push('D. RISK AND SIZING · H1 rule on this run (capped account)');
  const t = H1(filled);
  L.push(line('H1 trades', stat(t)));
  if (t.length > 20) {
    L.push('size of each trade as % of equity (margin) × leverage → total return / max drawdown');
    for (const frac of [0.05, 0.10, 0.15]) {
      const row = [1, 2, 3].map((lev) => { const e = equityTest(t, { frac, lev, maxOpen: 2 }); return `${lev}x: ${f3(e.ret, 0)}% / ${f3(e.mdd, 0)}%`; });
      L.push(`  ${String(frac * 100).padStart(3)}%   ${row.join('   ')}`);
    }
    const ordered = [...t].sort((a, b) => a.tEnd - b.tEnd);
    let streak = 0, worst = 0; ordered.forEach((x) => { streak = x.net < 0 ? streak + 1 : 0; worst = Math.max(worst, streak); });
    const wk = new Map(); t.forEach((x) => { const w = Math.floor((x.tEnd + 3 * 864e5) / (7 * 864e5)); wk.set(w, (wk.get(w) || 0) + x.net); });
    L.push(`longest losing streak ${worst} · worst week ${f3(Math.min(...wk.values()))}% (sum of % per trade) · best week ${f3(Math.max(...wk.values()))}%`);
    L.push(line('with daily stop at -2R', stat(capped(filled.filter((x) => x.dir === 'L' && x.btc24 !== null && x.btc24 < -3), { dailyStopR: -2 }))));
  }
  L.push('');
  if (hasEnriched) {
    L.push('E. OTHER SIGNALS (all filled trades, descriptive)');
    bucket('funding % at entry', filled, (x) => (x.fundNow === null ? null : x.fundNow < -0.02 ? '< -0.02' : x.fundNow < 0 ? '-0.02..0' : x.fundNow < 0.02 ? '0..0.02' : '> 0.02'), asc);
    bucket('open interest change last 4h %', filled, (x) => (x.oi4h === null ? null : x.oi4h < -5 ? '< -5' : x.oi4h < -1 ? '-5..-1' : x.oi4h < 1 ? '-1..1' : '> 1'), asc);
    bucket('open interest change last 24h %', filled, (x) => (x.oi24h === null ? null : x.oi24h < -10 ? '< -10' : x.oi24h < 0 ? '-10..0' : x.oi24h < 10 ? '0..10' : '> 10'), asc);
    bucket('top traders vs all accounts (topLS - globalLS)', filled, (x) => (x.topLS === null || x.globalLS === null ? null : x.topLS - x.globalLS < -0.3 ? 'tops less long' : x.topLS - x.globalLS > 0.3 ? 'tops more long' : 'similar'), asc);
  }
}
const text = L.join('\n');
console.log(text);
fs.writeFileSync(path.join(HERE, '..', 'docs', `fade-hud-sinav-rapor-p4-${path.basename(runDir)}${EXAM ? '-exam' : ''}.txt`), text + '\n');
