#!/usr/bin/env node
// Protocol 3, step 1: add path statistics, the exit grid and extra entry features to every filled trade of a run.
// Usage: node --max-old-space-size=6144 bt/enrich.js [--run bt/out/p1-full] [--par 4]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKlines, makeOiAt, csvText, parseKlines, premiumMonthly, monthKey } from './archive.js';
import { simulate, DEFAULTS } from './engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const runDir = path.resolve(arg('run', path.join(HERE, 'out', 'p1-full')));
const par = Number(arg('par', 4));
const BAR = 9e5;

export const GRID = { stop: [0.75, 1, 1.25, 1.5], tp: [0.5, 0.75, 1, 1.5, 2], hold: [16, 32, 48] };
export const gridKeys = [];
for (const s of GRID.stop) for (const t of GRID.tp) for (const h of GRID.hold) gridKeys.push(`${s}/${t}/${h}`);

async function premiumMap(sym, ym, cache) {
  const key = sym + ym;
  if (cache.has(key)) return cache.get(key);
  let m = null;
  try { const t = await csvText(premiumMonthly(sym, '15m', ym)); if (t) m = new Map(parseKlines(t).map((r) => [r.t, r.c])); } catch { /* counted as missing */ }
  cache.set(key, m);
  return m;
}

async function enrichCoin(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const sym = path.basename(file, '.json');
  const filled = (j.signals || []).filter((x) => x.filled);
  if (!filled.length) return [];
  const t0 = Math.min(...filled.map((x) => x.tS)) - 10 * 864e5, t1 = Math.max(...filled.map((x) => x.tS)) + 4 * 864e5;
  const { k } = await loadKlines(sym, '15m', t0, t1);
  const idx = new Map(k.map((x, i) => [x.t, i]));
  const oiAt = makeOiAt(sym), prem = new Map();
  const all = [...j.signals].sort((a, b) => a.tS - b.tS);
  const out = [];
  for (const x of filled) {
    const i = idx.get(x.tS - BAR);
    if (i === undefined) continue;
    const S = x.dir === 'S';
    const risk = x.riskPct / 100;
    const f = idx.get(x.tFill);
    if (f === undefined) continue;
    const enLvl = x.en;
    if (!Number.isFinite(enLvl)) continue;
    const rec = {};
    // ---- exit grid ----
    const g = [];
    for (const sm of GRID.stop) for (const tr of GRID.tp) for (const h of GRID.hold) {
      const st = S ? enLvl * (1 + risk * sm) : enLvl * (1 - risk * sm);
      const tp = S ? enLvl * (1 - risk * tr) : enLvl * (1 + risk * tr);
      const r = simulate(k, i, x.dir, enLvl, st, tp, { ...DEFAULTS, holdBars: h }, null);
      g.push(r.filled ? +r.net0.toFixed(4) : null);
    }
    rec.g = g;
    const stO = S ? enLvl * (1 + risk) : enLvl * (1 - risk), tpO = S ? enLvl * (1 - risk) : enLvl * (1 + risk);
    const tie = simulate(k, i, x.dir, enLvl, stO, tpO, { ...DEFAULTS, tie: 'target' }, null);
    rec.netTie = tie.filled ? +tie.net0.toFixed(4) : null;
    // ---- path: how far price went either way in the 32 candles from the fill ----
    let hi = -Infinity, lo = Infinity;
    for (let jx = f; jx < Math.min(k.length, f + 32); jx++) { hi = Math.max(hi, k[jx].h); lo = Math.min(lo, k[jx].l); }
    rec.mfeR = ((S ? enLvl - lo : hi - enLvl) / enLvl) / risk;
    rec.maeR = ((S ? hi - enLvl : enLvl - lo) / enLvl) / risk;
    // ---- extra entry features ----
    const ts = x.tS;
    const o0 = await oiAt(ts), o1 = await oiAt(ts - 3600e3), o4 = await oiAt(ts - 4 * 3600e3), o24 = await oiAt(ts - 24 * 3600e3);
    const pc = (a, b) => (a && b && b.v ? (a.v / b.v - 1) * 100 : null);
    rec.topLS = o0?.tt ?? null; rec.globalLS = o0?.gl ?? null; rec.takerLS = o0?.tk ?? null;
    rec.oi1h = pc(o0, o1); rec.oi4h = pc(o0, o4); rec.oi24h = pc(o0, o24);
    rec.oiOverVol = o0 && x.qv24 ? o0.u / 10 ** x.qv24 : null;
    const pm = await premiumMap(sym, monthKey(k[i].t), prem);
    const pv = pm?.get(k[i].t);
    rec.prem = pv === undefined ? null : pv * 100;
    const before = all.filter((y) => y.tS < ts);
    rec.sigCount30d = before.filter((y) => y.tS > ts - 30 * 864e5).length;
    rec.hrsSinceSig = before.length ? (ts - before[before.length - 1].tS) / 3600e3 : 24 * 365;
    out.push({ s: sym, ...x, ...rec });
  }
  oiAt.drop('9999');
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = fs.readdirSync(path.join(runDir, 'coins')).filter((f) => f.endsWith('.json')).map((f) => path.join(runDir, 'coins', f));
  const outDir = path.join(runDir, 'enriched'); fs.mkdirSync(outDir, { recursive: true });
  const q = [...files]; let done = 0; const t0 = Date.now();
  await Promise.all(Array.from({ length: par }, async () => {
    while (q.length) {
      const f = q.shift(), o = path.join(outDir, path.basename(f));
      if (!fs.existsSync(o)) {
        try { fs.writeFileSync(o, JSON.stringify(await enrichCoin(f))); }
        catch (e) { fs.writeFileSync(o, JSON.stringify([])); console.error(path.basename(f), e.message); }
      }
      if (++done % 25 === 0 || done === files.length) console.log(`${done}/${files.length} · ${Math.round((Date.now() - t0) / 1000)}s`);
    }
  }));
  console.log('enrich done');
}
