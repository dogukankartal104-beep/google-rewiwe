#!/usr/bin/env node
// Protocol 2 (docs/fade-hud-sinav-protokol-2.md): what separates winners from losers AT ENTRY, learned on the
// discovery period only, then judged on the decision period with at most 2 trades per day.
// Usage: node bt/lab.js [--run bt/out/p1-full] [--split 2025-10-01] [--k 3] [--perDay 2] [--pct 80]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize, equityTest, rng, benjaminiHochberg, pValueMeanPositive } from './stats.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const runDir = path.resolve(arg('run', path.join(HERE, 'out', 'p1-full')));
const split = Date.parse(arg('split', '2025-10-01') + 'T00:00:00Z');
const K = Number(arg('k', 3)), PER_DAY = Number(arg('perDay', 2)), PCT = Number(arg('pct', 80));

// Frozen feature list (numeric, known at entry). Changing it after seeing results is not allowed.
export const FEATURES = ['chg24', 'qv24', 'atrPct', 'hr', 'dow', 'fundNow', 'ret4', 'volX', 'limDist', 'ratio',
  'trN', 'sweep', 'rrPlan', 'btc24', 'btc1h', 'riskPct', 'leg', 'oiChg', 'exN', 'absChg'];
const val = (x, f) => (f === 'absChg' ? Math.abs(x.chg24) : x[f]);

/* ---- helpers (exported for tests) ---- */
export function ranks(a) {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = new Array(a.length);
  for (let i = 0; i < idx.length;) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1; for (let m = i; m <= j; m++) r[idx[m][1]] = avg; i = j + 1;
  }
  return r;
}
export function spearman(x, y) {
  const n = x.length; if (n < 10) return 0;
  const rx = ranks(x), ry = ranks(y);
  const mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (rx[i] - mx) * (ry[i] - my); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, a.length - 1)) || 1; };
const month = (t) => new Date(t).toISOString().slice(0, 7);
const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

/* One trade per coin at a time, in time order (no global cap): the sample the features are learned from. */
export function dedupePerCoin(signals) {
  const lock = new Map(), out = [];
  for (const x of [...signals].sort((a, b) => a.tS - b.tS)) {
    if ((lock.get(x.s) || 0) > x.tS) continue;
    out.push(x); lock.set(x.s, x.tEnd);
  }
  return out;
}

/* Learn: features whose sign is stable across months and whose |rank correlation| with the net result is largest. */
export function learn(disc, k = K, features = FEATURES) {
  const rows = [];
  for (const f of features) {
    const d = disc.filter((x) => Number.isFinite(val(x, f)));
    if (d.length < 100) continue;
    const rho = spearman(d.map((x) => val(x, f)), d.map((x) => x.net));
    const byM = new Map(); d.forEach((x) => (byM.get(month(x.tS)) || byM.set(month(x.tS), []).get(month(x.tS))).push(x));
    let agree = 0, months = 0;
    for (const arr of byM.values()) { if (arr.length < 15) continue; months++; if (Math.sign(spearman(arr.map((x) => val(x, f)), arr.map((x) => x.net))) === Math.sign(rho)) agree++; }
    const m = mean(d.map((x) => val(x, f))), s = sd(d.map((x) => val(x, f)));
    rows.push({ f, rho, agree, months, m, s, n: d.length });
  }
  const chosen = rows.filter((r) => r.months >= 4 && r.agree / r.months >= 0.66).sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho)).slice(0, k);
  return { rows, chosen };
}
export const scoreOf = (x, chosen) => chosen.reduce((s, c) => { const v = val(x, c.f); return s + (Number.isFinite(v) ? Math.sign(c.rho) * (v - c.m) / c.s : 0); }, 0);

/* Causal selection: walk through time; take a signal when its score clears the threshold, the coin is free,
   fewer than `perDay` trades were taken that UTC day and fewer than `maxOpen` are open. */
export function select(signals, chosen, thr, { perDay = PER_DAY, maxOpen = 2 } = {}) {
  const day = (t) => Math.floor(t / 864e5);
  const taken = [], lock = new Map(), perD = new Map();
  for (const x of [...signals].sort((a, b) => a.tS - b.tS)) {
    if (scoreOf(x, chosen) < thr) continue;
    if ((lock.get(x.s) || 0) > x.tS) continue;
    if ((perD.get(day(x.tS)) || 0) >= perDay) continue;
    if (taken.filter((y) => y.tEnd > x.tS).length >= maxOpen) continue;
    taken.push(x); lock.set(x.s, x.tEnd); perD.set(day(x.tS), (perD.get(day(x.tS)) || 0) + 1);
  }
  return taken;
}

/* Baseline: the same number of trades per day, but picked at random from that day's candidate signals. */
export function randomBaseline(signals, taken, draws = 300, seed = 5) {
  const day = (t) => Math.floor(t / 864e5), byDay = new Map();
  signals.forEach((x) => (byDay.get(day(x.tS)) || byDay.set(day(x.tS), []).get(day(x.tS))).push(x));
  const need = new Map(); taken.forEach((x) => need.set(day(x.tS), (need.get(day(x.tS)) || 0) + 1));
  const r = rng(seed), means = [];
  for (let d = 0; d < draws; d++) {
    let s = 0, c = 0;
    for (const [dd, n] of need) { const pool = byDay.get(dd) || []; for (let i = 0; i < Math.min(n, pool.length); i++) { s += pool[(r() * pool.length) | 0].net; c++; } }
    if (c) means.push(s / c);
  }
  means.sort((a, b) => a - b);
  return { mean: mean(means), p95: means[Math.floor(0.95 * means.length)] };
}

/* ---------------- report ---------------- */
export function labReport(base, features = FEATURES, title = 'PROTOCOL 2') {
  const disc = base.filter((x) => x.tS < split), dec = base.filter((x) => x.tS >= split);
  const fmt = (v, d = 3) => (v === undefined || v === null || Number.isNaN(v) ? '—' : (+v).toFixed(d));
  const L = [`${title} · ${new Date().toISOString()} · k=${K} perDay=${PER_DAY} threshold=p${PCT} · ${features.length} features`];
  L.push(`signals (filled, one per coin at a time): discovery ${disc.length}, decision ${dec.length}`, '');

  // 1) Winners vs losers on the discovery period (descriptive)
  const win = disc.filter((x) => x.exit === 'tp'), lose = disc.filter((x) => x.exit === 'stop');
  L.push(`WINNERS (target) ${win.length} vs LOSERS (stop) ${lose.length} · discovery · median of each feature`);
  L.push('feature      winners     losers    rank-corr with net   months agreeing');
  const { rows, chosen } = learn(disc, K, features);
  const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
  rows.sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho)).forEach((r) => {
    L.push(`${r.f.padEnd(10)} ${fmt(med(win.map((x) => val(x, r.f))), 3).padStart(10)} ${fmt(med(lose.map((x) => val(x, r.f))), 3).padStart(10)}   ${fmt(r.rho, 3).padStart(8)}   ${r.agree}/${r.months}`);
  });
  const ps = rows.map((r) => 2 * (1 - normCdf(Math.abs(r.rho) * Math.sqrt(r.n))));
  const sig = benjaminiHochberg(ps, 0.10);
  L.push('', 'Benjamini-Hochberg (q=0.10) on the feature correlations: ' + (rows.filter((r, i) => sig[i]).map((r) => r.f).join(', ') || 'none significant'));
  L.push('', 'CHOSEN FOR THE SCORE (stable sign across months, largest |rho|): ' + (chosen.map((c) => `${c.f}(${c.rho > 0 ? '+' : '-'})`).join(', ') || 'none'));

  if (chosen.length) {
    const discScores = disc.map((x) => scoreOf(x, chosen));
    const thr = quantile(discScores, PCT / 100);
    L.push(`threshold = discovery score percentile ${PCT} = ${fmt(thr, 3)}`, '');
    for (const [name, arr] of [['DISCOVERY (in-sample, optimistic)', disc], ['DECISION (the exam)', dec]]) {
      const t = select(arr, chosen, thr);
      const s = summarize(t), allS = summarize(arr), rb = randomBaseline(arr, t), eq = equityTest(t);
      L.push(`== ${name} ==`);
      L.push(`all signals     n=${allS.n} mean ${fmt(allS.mean)}%`);
      L.push(`selected        n=${s.n} (${fmt(s.n / Math.max(1, new Set(arr.map((x) => Math.floor(x.tS / 864e5))).size), 2)} per day with signals) mean ${fmt(s.mean)}% median ${fmt(s.median)}% win ${fmt(s.win, 1)}% LB90 ${fmt(s.lb90)}% halves ${fmt(s.h1)} / ${fmt(s.h2)} exTop5 ${fmt(s.exTop5)}`);
      L.push(`random picks   same number per day: mean ${fmt(rb.mean)}% (95th pct of random ${fmt(rb.p95)}%)`);
      L.push(`equity (10% at 2x): return ${fmt(eq.ret, 1)}% · max drawdown ${fmt(eq.mdd, 1)}% · halves ${fmt(eq.ret1, 1)}% / ${fmt(eq.ret2, 1)}%`);
      L.push('');
      if (name.startsWith('DECISION')) {
        const checks = [
          ['1. mean net % > 0', s.n > 0 && s.mean > 0],
          ['2. 90% lower bound > 0', s.lb90 > 0],
          ['3. both halves positive', s.h1 > 0 && s.h2 > 0],
          ['4. mean without best 5 > 0', s.exTop5 > 0],
          ['5. beats the 95th percentile of random picks', s.mean > rb.p95],
          ['6. equity: both halves positive, drawdown not worse in 2nd', eq.ret1 > 0 && eq.ret2 > 0 && eq.mdd2 >= eq.mdd1],
        ];
        L.push('PASS CONDITIONS');
        checks.forEach(([n2, ok]) => L.push(`${ok ? 'PASS' : 'FAIL'}  ${n2}`));
        L.push(checks.every(([, ok]) => ok) ? 'RESULT: PASSED every condition' : 'RESULT: DOES NOT PASS');
      }
    }
  }
  return L.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sigs = [];
  for (const f of fs.readdirSync(path.join(runDir, 'coins'))) {
    const j = JSON.parse(fs.readFileSync(path.join(runDir, 'coins', f), 'utf8'));
    for (const x of j.signals || []) if (x.filled) sigs.push({ s: f.replace('.json', ''), ...x });
  }
  const text = labReport(dedupePerCoin(sigs));
  console.log(text);
  fs.writeFileSync(path.join(HERE, '..', 'docs', `fade-hud-sinav-rapor-lab-${path.basename(runDir)}.txt`), text + '\n');
}
function normCdf(z) { // Abramowitz-Stegun
  const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
