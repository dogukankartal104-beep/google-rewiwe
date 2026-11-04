#!/usr/bin/env node
// Protocol 3, step 2: exits, costs, stability and extra entry features, from the enriched trades.
// Usage: node bt/measure.js [--run bt/out/p1-full] [--split 2025-10-01]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize, benjaminiHochberg, pValueMeanPositive } from './stats.js';
import { labReport, dedupePerCoin, FEATURES } from './lab.js';
import { gridKeys } from './enrich.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const runDir = path.resolve(arg('run', path.join(HERE, 'out', 'p1-full')));
const split = Date.parse(arg('split', '2025-10-01') + 'T00:00:00Z');

const trades = [];
for (const f of fs.readdirSync(path.join(runDir, 'enriched'))) trades.push(...JSON.parse(fs.readFileSync(path.join(runDir, 'enriched', f), 'utf8')));
const base = dedupePerCoin(trades);
const disc = base.filter((x) => x.tS < split), dec = base.filter((x) => x.tS >= split);
const f3 = (v, d = 3) => (v === undefined || v === null || Number.isNaN(v) ? '—' : (+v).toFixed(d));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const L = [`PROTOCOL 3 MEASUREMENTS · ${new Date().toISOString()} · trades ${trades.length} · one per coin at a time: discovery ${disc.length}, decision ${dec.length}`, ''];

/* ===== A. exits ===== */
L.push('A. EXIT GRID (stop x original risk / target in R / hold candles) · mean net % per trade, costs included, no funding');
const cell = (arr, c) => arr.filter((x) => x.g && x.g[c] !== null && x.g[c] !== undefined).map((x) => ({ tS: x.tS, net: x.g[c] }));
const rows = gridKeys.map((key, c) => {
  const d1 = cell(disc, c), d2 = cell(dec, c);
  return { key, c, md: mean(d1.map((x) => x.net)), nd: d1.length, mc: mean(d2.map((x) => x.net)), nc: d2.length, p: pValueMeanPositive(d2, (x) => x.net, 400) };
});
const sig = benjaminiHochberg(rows.map((r) => r.p), 0.10);
rows.forEach((r, i) => { r.sig = sig[i]; });
L.push('cell            discovery mean (n)       decision mean (n)    BH significant on decision');
rows.slice().sort((a, b) => b.md - a.md).forEach((r) => L.push(`${r.key.padEnd(14)}  ${f3(r.md).padStart(8)} (${String(r.nd).padStart(5)})      ${f3(r.mc).padStart(8)} (${String(r.nc).padStart(5)})      ${r.sig ? 'yes' : 'no'}`));
const best = rows.slice().sort((a, b) => b.md - a.md)[0];
const p1 = rows.find((r) => r.key === '1/1/32');
L.push('', `Chosen on DISCOVERY: ${best.key} (discovery ${f3(best.md)}%). Its DECISION result: ${f3(best.mc)}% over ${best.nc} trades. Protocol 1 cell (1/1/32) on decision: ${f3(p1.mc)}%.`);
const bs = summarize(cell(dec, best.c));
L.push(`chosen cell, decision: mean ${f3(bs.mean)}% median ${f3(bs.median)}% win ${f3(bs.win, 1)}% LB90 ${f3(bs.lb90)}% halves ${f3(bs.h1)} / ${f3(bs.h2)}`);
L.push(best.mc > 0 && best.mc > p1.mc && bs.lb90 > 0 ? 'VERDICT A: the chosen cell is positive on decision, beats protocol 1 and its lower bound is above zero.' : 'VERDICT A: the chosen cell does NOT clear the bar (positive, better than protocol 1, lower bound above zero).');
L.push('');
const reach = (arr, r) => (arr.filter((x) => x.mfeR >= r).length / Math.max(1, arr.length) * 100).toFixed(1) + '%';
L.push('MFE / MAE inside 32 candles from the fill (in R, stop ignored): median MFE ' + f3(med(base.map((x) => x.mfeR)), 2) + ', median MAE ' + f3(med(base.map((x) => x.maeR)), 2));
L.push('share of trades whose price reached +0.5R ' + reach(base, 0.5) + ' · +1R ' + reach(base, 1) + ' · +1.5R ' + reach(base, 1.5) + ' · +2R ' + reach(base, 2));
const wins = base.filter((x) => x.exit === 'tp'), loss = base.filter((x) => x.exit === 'stop');
L.push(`winners (n=${wins.length}) median MAE ${f3(med(wins.map((x) => x.maeR)), 2)}R before/around success; losers (n=${loss.length}) median MFE ${f3(med(loss.map((x) => x.mfeR)), 2)}R before the stop`);
const tieDec = dec.filter((x) => x.netTie !== null && x.netTie !== undefined);
L.push(`tie rule bounds, decision: stop wins ${f3(mean(dec.map((x) => x.net0)))}%  <->  target wins ${f3(mean(tieDec.map((x) => x.netTie)))}%  (the gap is how much the same-candle assumption could matter)`);
L.push('');

/* ===== B. costs ===== */
L.push('B. COST SENSITIVITY · decision period, mean net % (gross minus costs; funding left out)');
const gm = mean(dec.map((x) => x.gross)), shareStop = dec.filter((x) => x.exit === 'stop').length / Math.max(1, dec.length);
L.push('round-trip bp →      ' + [10, 20, 30, 40, 60].map((c) => String(c).padStart(8)).join(''));
for (const ex of [0, 20, 40]) L.push(`stop slippage ${String(ex).padStart(2)} bp   ` + [10, 20, 30, 40, 60].map((c) => f3(gm - c / 100 - (ex / 100) * shareStop).padStart(8)).join(''));
L.push(`gross mean ${f3(gm)}% · share of stop exits ${f3(shareStop * 100, 1)}% · break-even round-trip cost with 20 bp stop slippage: ${f3((gm - 0.2 * shareStop) * 100, 1)} bp`);
L.push('');

/* ===== C. stability ===== */
L.push('C. STABILITY (mean net % with costs and funding · n)');
const grp = (arr, key) => { const o = new Map(); arr.forEach((x) => { const k = key(x); (o.get(k) || o.set(k, []).get(k)).push(x.net); }); return o; };
const show = (title, m, order) => { L.push(title); [...m.keys()].sort(order).forEach((k) => L.push(`  ${String(k).padEnd(10)} ${f3(mean(m.get(k))).padStart(8)}  n=${m.get(k).length}`)); };
const mo = (t) => new Date(t).toISOString().slice(0, 7);
show('by month', grp(base, (x) => mo(x.tS)), (a, b) => (a < b ? -1 : 1));
show('by quarter', grp(base, (x) => { const d = new Date(x.tS); return d.getUTCFullYear() + 'Q' + (Math.floor(d.getUTCMonth() / 3) + 1); }), (a, b) => (a < b ? -1 : 1));
show('by hour UTC', grp(base, (x) => String(x.hr).padStart(2, '0')), (a, b) => (a < b ? -1 : 1));
show('by weekday (0=Sun)', grp(base, (x) => x.dow), (a, b) => a - b);
show('by session', grp(base, (x) => x.ses), (a, b) => (a < b ? -1 : 1));
show('by side', grp(base, (x) => x.dir), (a, b) => (a < b ? -1 : 1));
show('by grade', grp(base, (x) => x.grade), (a, b) => (a < b ? -1 : 1));
show('by setup type', grp(base, (x) => x.type), (a, b) => (a < b ? -1 : 1));
show('by BTC 24h regime', grp(base, (x) => (x.btc24 === null ? 'n/a' : x.btc24 < -3 ? '< -3%' : x.btc24 < 0 ? '-3..0%' : x.btc24 < 3 ? '0..3%' : '> 3%')), (a, b) => (a < b ? -1 : 1));
const byCoin = grp(base, (x) => x.s);
const coinSum = [...byCoin.entries()].map(([k, v]) => [k, v.reduce((a, b) => a + b, 0)]).sort((a, b) => b[1] - a[1]);
const total = coinSum.reduce((a, [, v]) => a + v, 0), top10 = coinSum.slice(0, 10);
const top10Names = new Set(top10.map(([k]) => k));
L.push(`coin concentration: ${byCoin.size} coins, total ${f3(total, 1)} (sum of % per trade). Top 10 coins contribute ${f3(top10.reduce((a, [, v]) => a + v, 0) / (total || 1) * 100, 0)}% of it (${top10.map(([k]) => k.replace('USDT', '')).join(', ')}).`);
L.push(`mean per trade without the 10 best coins: ${f3(mean(base.filter((x) => !top10Names.has(x.s)).map((x) => x.net)))}% (all coins: ${f3(mean(base.map((x) => x.net)))}%)`);
const perDay = new Map(); base.forEach((x) => { const d = Math.floor(x.tS / 864e5); (perDay.get(d) || perDay.set(d, []).get(d)).push(x); });
const busy = [...perDay.values()].filter((v) => v.length >= 3);
const sameWay = busy.filter((v) => { const s = v.filter((x) => x.dir === 'S').length; return s === 0 || s === v.length || s / v.length >= 0.8 || s / v.length <= 0.2; }).length;
L.push(`days with signals ${perDay.size}; days with 3+ signals ${busy.length}, of which ${sameWay} are mostly one direction (the same market move counted several times).`);
L.push('');

/* ===== D. more entry features ===== */
const EXT = ['topLS', 'globalLS', 'takerLS', 'oi1h', 'oi4h', 'oi24h', 'oiOverVol', 'prem', 'sigCount30d', 'hrsSinceSig'];
L.push(labReport(base, [...FEATURES, ...EXT], 'D. ENTRY FEATURES (protocol 2 list + protocol 3 additions)'));
const text = L.join('\n');
console.log(text);
fs.writeFileSync(path.join(HERE, '..', 'docs', `fade-hud-sinav-rapor-p3-${path.basename(runDir)}.txt`), text + '\n');
