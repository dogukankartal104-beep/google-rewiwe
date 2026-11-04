#!/usr/bin/env node
// Usage: node --max-old-space-size=6144 bt/run.js [--from 2025-01-01] [--to 2026-11-04] [--symbols A,B] [--limit N]
//        [--out bt/out/run1] [--fillBp 0] [--par 3]
// Resumable: finished coins are stored in <out>/coins/<SYM>.json and skipped on the next start.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSymbols, stats as dl } from './archive.js';
import { scanCoin, portfolio, DEFAULTS } from './engine.js';
import { summarize, equityTest, benjaminiHochberg, pValueMeanPositive } from './stats.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const from = Date.parse(arg('from', '2025-01-01') + 'T00:00:00Z');
const to = Date.parse(arg('to', new Date(Date.now() - 864e5).toISOString().slice(0, 10)) + 'T00:00:00Z');
const split = Date.parse(arg('split', '2025-10-01') + 'T00:00:00Z');
const out = path.resolve(arg('out', path.join(HERE, 'out', 'run1')));
const par = Number(arg('par', 3));
const p = { ...DEFAULTS, fillBp: Number(arg('fillBp', 0)) };
fs.mkdirSync(path.join(out, 'coins'), { recursive: true });

let syms = arg('symbols') ? arg('symbols').split(',') : await listSymbols();
if (arg('limit')) syms = syms.slice(0, Number(arg('limit')));
console.log(`universe ${syms.length} symbols · ${new Date(from).toISOString().slice(0, 10)} → ${new Date(to).toISOString().slice(0, 10)} · out ${out}`);

let done = 0; const t0 = Date.now();
const queue = [...syms];
await Promise.all(Array.from({ length: par }, async () => {
  while (queue.length) {
    const sym = queue.shift();
    const f = path.join(out, 'coins', sym + '.json');
    if (!fs.existsSync(f)) {
      try {
        const r = await scanCoin(sym, from, to, p);
        fs.writeFileSync(f, JSON.stringify(r));
      } catch (e) {
        fs.writeFileSync(f, JSON.stringify({ signals: [], placeboA: [], placeboB: [], cov: { sym, fatal: e.message } }));
      }
    }
    done++;
    if (done % 10 === 0 || done === syms.length) console.log(`${done}/${syms.length} coins · ${Math.round((Date.now() - t0) / 1000)}s · downloads ${dl.fetched} cached ${dl.cached} 404 ${dl.notFound} errors ${dl.errorCount || 0}`);
  }
}));

/* ---------------- aggregate ---------------- */
const all = { signals: [], placeboA: [], placeboB: [] }, covs = [];
for (const s of syms) {
  const j = JSON.parse(fs.readFileSync(path.join(out, 'coins', s + '.json'), 'utf8'));
  for (const k of Object.keys(all)) all[k].push(...(j[k] || []).map((x) => ({ s, ...x })));
  covs.push(j.cov || { sym: s, fatal: 'no data' });
}
const measured = covs.filter((c) => !c.fatal && c.bars >= 300);
const totals = covs.reduce((a, c) => { for (const k of ['evals', 'signals', 'noOi', 'errors', 'frozen']) a[k] = (a[k] || 0) + (c[k] || 0); return a; }, {});

const taken = portfolio(all.signals, 2);
const filled = taken.filter((x) => x.filled);
const inPeriod = (arr, a, b) => arr.filter((x) => x.tS >= a && x.tS < b);
const fmt = (v, d = 3) => (v === undefined || Number.isNaN(v) ? '—' : (+v).toFixed(d));
const line = (name, s) => s.n ? `${name.padEnd(34)} n=${String(s.n).padStart(5)}  mean ${fmt(s.mean)}%  median ${fmt(s.median)}%  win ${fmt(s.win, 1)}%  LB90 ${fmt(s.lb90)}%  half1 ${fmt(s.h1)}  half2 ${fmt(s.h2)}  exTop5 ${fmt(s.exTop5)}  mdd ${fmt(s.mdd, 1)}`
  : `${name.padEnd(34)} n=0`;
const L = [];
L.push(`FADE HUD RULE · protocol 1 · generated ${new Date().toISOString()}`);
L.push(`period ${new Date(from).toISOString().slice(0, 10)} → ${new Date(to).toISOString().slice(0, 10)} · split ${new Date(split).toISOString().slice(0, 10)} · fillBp ${p.fillBp}`);
L.push('');
L.push('COVERAGE');
L.push(`measured ${measured.length} / universe ${syms.length} symbols · fatal ${covs.filter((c) => c.fatal).length} · symbols with missing months ${covs.filter((c) => c.missingMonths?.length).length}`);
L.push(`downloads ${dl.fetched}, from cache ${dl.cached}, not in archive ${dl.notFound}, errors ${dl.errorCount || 0}${dl.errors.length ? ' · first: ' + dl.errors[0] : ''}`);
L.push(`evaluated bars ${totals.evals} · setups with a trade plan ${totals.signals} · dropped: no open-interest data ${totals.noOi} lookups, frozen/zero-volume ${totals.frozen}, code errors ${totals.errors}${covs.find((c) => c.firstErr)?.firstErr ? ' (first: ' + covs.find((c) => c.firstErr).firstErr + ')' : ''}`);
const fatals = covs.filter((c) => c.fatal).slice(0, 5).map((c) => `${c.sym}: ${c.fatal}`);
if (fatals.length) L.push('fatal examples: ' + fatals.join(' | '));
L.push('');
L.push(`PORTFOLIO (1 per coin, max 2 open): ${taken.length} accepted, ${filled.length} filled, ${taken.length - filled.length} limit orders never filled (${fmt((taken.length - filled.length) / Math.max(1, taken.length) * 100, 1)}%)`);
const exits = { tp: 0, stop: 0, time: 0 }; filled.forEach((x) => exits[x.exit]++);
L.push(`exits: target ${exits.tp}, stop ${exits.stop}, time ${exits.time}`);
L.push('');
const periods = [['DISCOVERY', from, split], ['DECISION', split, to]];
const cells = [];
for (const [name, a, b] of periods) {
  const t = inPeriod(filled, a, b);
  L.push(`== ${name} ==`);
  const g = summarize(t, (x) => x.gross), n0 = summarize(t, (x) => x.net0), nf = summarize(t);
  L.push(line('gross (no costs)', g)); L.push(line('net of costs', n0)); L.push(line('net of costs + funding  <- judged', nf));
  for (const d of ['S', 'L']) L.push(line('  side ' + (d === 'S' ? 'SHORT' : 'LONG'), summarize(t.filter((x) => x.dir === d))));
  for (const g2 of ['A', 'B', 'C', 'D']) { const s = summarize(t.filter((x) => x.grade === g2)); if (s.n) L.push(line('  grade ' + g2, s)); }
  const pa = summarize(inPeriod(all.placeboA, a, b).filter((x) => x.filled)), pb = summarize(inPeriod(all.placeboB, a, b).filter((x) => x.filled));
  L.push(line('placebo A (random time)', pa)); L.push(line('placebo B (random big-move time)', pb));
  const eq = equityTest(t);
  L.push(`equity (10% at 2x, max 2 open): return ${fmt(eq.ret, 1)}% · max drawdown ${fmt(eq.mdd, 1)}% · halves ${fmt(eq.ret1, 1)}% / ${fmt(eq.ret2, 1)}% · dd halves ${fmt(eq.mdd1, 1)}% / ${fmt(eq.mdd2, 1)}% · skipped ${eq.skipped}`);
  L.push('');
  cells.push({ name, t, nf, pb, eq });
  for (const d of ['S', 'L']) cells.push({ name: name + ' ' + d, t: t.filter((x) => x.dir === d) });
}
// multiple-cell correction
const ps = cells.map((c) => pValueMeanPositive(c.t));
const sig = benjaminiHochberg(ps, 0.10);
L.push('MULTIPLE CELLS (Benjamini-Hochberg q=0.10, mean > 0)');
cells.forEach((c, i) => L.push(`${c.name.padEnd(22)} p=${fmt(ps[i], 4)} ${sig[i] ? 'significant' : 'not significant'}`));
L.push('');
const D = cells.find((c) => c.name === 'DECISION');
const checks = [
  ['1. mean net % > 0', D.nf.n && D.nf.mean > 0],
  ['2. 90% lower bound > 0', D.nf.lb90 > 0],
  ['3. both halves positive', D.nf.h1 > 0 && D.nf.h2 > 0],
  ['4. mean without best 5 > 0', D.nf.exTop5 > 0],
  ['5. beats placebo B', D.pb.n ? D.nf.mean > D.pb.mean : false],
  ['6. equity: both halves positive and drawdown not worse in 2nd', D.eq.ret1 > 0 && D.eq.ret2 > 0 && D.eq.mdd2 >= D.eq.mdd1],
];
L.push('PASS CONDITIONS (decision period)');
checks.forEach(([n, ok]) => L.push(`${ok ? 'PASS' : 'FAIL'}  ${n}`));
const pass = checks.every(([, ok]) => ok);
L.push(pass ? 'RESULT: PASSED every condition' : 'RESULT: DOES NOT PASS - no paid signals from this rule');
const mean = D.nf.n ? D.nf.mean : NaN;
L.push(`MONEY EFFECT: decision period ${D.nf.n || 0} trades, mean ${fmt(mean)}% per trade; equity test ${fmt(D.eq.ret, 1)}% with max drawdown ${fmt(D.eq.mdd, 1)}%.`);

const report = L.join('\n');
console.log('\n' + report);
const tag = path.basename(out);
fs.writeFileSync(path.join(HERE, '..', 'docs', `fade-hud-sinav-rapor-${tag}.txt`), report + '\n');
fs.writeFileSync(path.join(out, 'trades.json'), JSON.stringify(filled));
