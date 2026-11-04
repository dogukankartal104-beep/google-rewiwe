#!/usr/bin/env node
// docs/v1k-1dk-protokol.md → docs/v1k-1dk-rapor.md.   node --max-old-space-size=6144 bt/v1/rolling.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSymbols, loadKlines, csvText, parseMetrics, parseKlines, metricsDaily, klinesDaily, dayKey, stats as dl } from '../archive.js';
import { minuteBars, fundingOf } from '../analiz/data.js';
import { summary, follower, monthly, f, mean } from '../analiz/analyses.js';
import { engineEntry, FILTER_OI15 } from './engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'out', 'v1');
const MIN = 6e4, M15 = 9e5, DAY = 864e5;
const FROM = Date.UTC(2022, 0, 1), TO = Date.now() - 2 * DAY;
const SPLIT = Date.UTC(2026, 2, 2);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
fs.mkdirSync(path.join(OUT, 'rolling-days'), { recursive: true });

/* ---- BTC 1m closes, one small Float64Array per UTC day ---- */
const btcDays = new Map();
async function btcClose(t) {
  const d = Math.floor(t / DAY) * DAY;
  let a = btcDays.get(d);
  if (a === undefined) {
    a = null;
    try { const txt = await csvText(klinesDaily('BTCUSDT', '1m', dayKey(d))); if (txt) { a = new Float64Array(1440).fill(NaN); for (const r of parseKlines(txt)) { const i = Math.round((r.t - d) / MIN); if (i >= 0 && i < 1440) a[i] = r.c; } } } catch { a = null; }
    btcDays.set(d, a);
  }
  return a ? a[Math.round((t - d) / MIN)] : NaN;
}

const metricsCache = new Map();
async function recsM(sym, from, to) { const out = []; for (let d = Math.floor(from / DAY) * DAY; d <= to; d += DAY) { const key = sym + '|' + dayKey(d); let r = metricsCache.get(key); if (r === undefined) { const t = await csvText(metricsDaily(sym, dayKey(d))).catch(() => null); r = t ? parseMetrics(t) : null; metricsCache.set(key, r); if (metricsCache.size > 1500) metricsCache.delete(metricsCache.keys().next().value); } if (r) out.push(...r); } return out.sort((a, b) => a.t - b.t); }
const latest = (arr, ts) => { let lo = 0, hi = arr.length - 1, b = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].t <= ts) { b = m; lo = m + 1; } else hi = m - 1; } return b; };

/* ---- stage 1: coin-days where the 24h change reached +45% at a 15m close ---- */
async function candidateDays(sym) {
  const cf = path.join(OUT, 'rolling-days', sym + '.json');
  if (fs.existsSync(cf)) return JSON.parse(fs.readFileSync(cf, 'utf8'));
  const { k } = await loadKlines(sym, '15m', FROM - DAY, TO);
  const days = new Set();
  for (let i = 96; i < k.length; i++) {
    if (k[i].t - k[i - 96].t !== 96 * M15) continue;
    if (k[i].c / k[i - 96].c - 1 >= 0.45) { const t = k[i].t + M15; if (t >= FROM && t < TO) days.add(Math.floor(t / DAY) * DAY); }
  }
  const out = [...days].sort((a, b) => a - b);
  fs.writeFileSync(cf, JSON.stringify(out));
  return out;
}

/* ---- stage 2: minute scan of a coin ---- */
async function scanCoin(sym, days) {
  const out = [];
  // clusters of days that are at most 3 days apart, each loaded once
  const clusters = []; for (const d of days) { const c = clusters[clusters.length - 1]; if (c && d - c.to <= 3 * DAY) c.to = d; else clusters.push({ from: d, to: d }); }
  let last = 0;
  for (const c of clusters) {
    const { k } = await minuteBars(sym, c.from - DAY, c.to + 3 * DAY);
    if (k.length < 1500) continue;
    const P = new Float64Array(k.length + 1); for (let i = 0; i < k.length; i++) P[i + 1] = P[i] + k[i].q;
    const base = k[0].t, idxOf = (t) => Math.round((t - base) / MIN);
    const funding = await fundingOf(sym, c.from - DAY, c.to + 3 * DAY);
    for (let i = 1440; i < k.length - 1; i++) {
      const t = k[i].t, tSig = t + MIN;
      if (tSig < c.from || tSig >= c.to + DAY || tSig < FROM || tSig >= TO) continue;
      if (idxOf(t) !== i || k[i - 15].t !== t - 15 * MIN || k[i - 1440].t !== t - 1440 * MIN) continue;     // gaps: skip
      if (tSig - last < 4 * 36e5) continue;                                                              // 4h cooldown
      if (!(k[i].v > 0) || k[i].h === k[i].l) continue;
      if (k[i].c / k[i - 15].c - 1 < 0.04 || k[i].c / k[i - 1440].c - 1 < 0.5) continue;
      const vol24 = P[i + 1] - P[i + 1 - 1440]; if (vol24 < 1e6) continue;
      const b1 = await btcClose(t), b0 = await btcClose(t - 1440 * MIN);
      if (!Number.isFinite(b1) || !Number.isFinite(b0) || b1 / b0 - 1 > -0.01) continue;
      last = tSig;
      const recs = await recsM(sym, tSig - DAY, tSig + DAY);
      const i1 = latest(recs, tSig), i0m = latest(recs, tSig - 15 * MIN);
      const oi15 = i1 >= 0 && i0m >= 0 && recs[i0m].u > 0 ? (recs[i1].u / recs[i0m].u - 1) * 100 : null;
      const rec = { key: `${sym}|${tSig}`, s: sym, tSig, r15: (k[i].c / k[i - 15].c - 1) * 100, chg24: (k[i].c / k[i - 1440].c - 1) * 100, btc24: (b1 / b0 - 1) * 100, vol24, oi15, cells: {} };
      for (const [name, c2] of [['R0', { F: false, O1: false }], ['R1', { F: true, O1: false }], ['R2', { F: true, O1: true }]]) {
        if (c2.F && !(oi15 !== null && oi15 <= FILTER_OI15)) { rec.cells[name] = { nets: ['skip', 'skip'] }; continue; }
        const nets = []; let meta = {};
        for (const d of [0, 15]) { const r = engineEntry({ k, i0: i + 1, tSig, funding, recs, vol: vol24, useE1: false, useO1: c2.O1, delayMin: d }); nets.push(r.ok ? r.net : null); if (d === 0 && r.ok) meta = { te: r.te, tf: r.tEntry }; }
        rec.cells[name] = { nets, ...meta };
      }
      out.push(rec);
    }
  }
  return out;
}

/* ---------------- main ---------------- */
const cacheFile = path.join(OUT, 'rolling.jsonl');
const done = new Set(), recsAll = [];
if (fs.existsSync(cacheFile)) for (const l of fs.readFileSync(cacheFile, 'utf8').split('\n')) { if (!l) continue; try { const r = JSON.parse(l); if (r.coinDone) done.add(r.coinDone); else recsAll.push(r); } catch { /* torn */ } }
const syms = await listSymbols();
log('symbols', syms.length, 'coins already done', done.size);
const fd = fs.openSync(cacheFile, 'a');
const queue = syms.filter((s) => !done.has(s)); let n = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const s = queue.shift();
    try {
      const days = await candidateDays(s);
      const rows = days.length ? await scanCoin(s, days) : [];
      for (const r of rows) { fs.writeSync(fd, JSON.stringify(r) + '\n'); recsAll.push(r); }
      fs.writeSync(fd, JSON.stringify({ coinDone: s }) + '\n');
    } catch (e) { log(`coin ${s}: ${e.message}`); }
    if (++n % 50 === 0) log(`coins ${n}/${syms.length} · rolling signals so far ${recsAll.length}`);
  }
}));
fs.closeSync(fd);

/* ---------------- report ---------------- */
const R = recsAll.sort((a, b) => a.tSig - b.tSig);
const C = fs.readFileSync(path.join(OUT, 'combo.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && !r.fail).sort((a, b) => a.tSig - b.tSig);
const cOk = (t, cell) => (cell === 'K0' || (Number.isFinite(t.oi15) && t.oi15 <= FILTER_OI15));
const itemsC = (cell, di = 0, set = C) => set.filter((t) => cOk(t, cell)).map((t) => ({ t, v: t.cells[cell].nets[di] })).filter((x) => Number.isFinite(x.v)).map((x) => ({ tSig: x.t.tSig, net: x.v, tEntry: x.t.cells[cell].tf ?? x.t.tSig, tExit: x.t.cells[cell].te ?? x.t.tSig + DAY, liq: { 1: false }, s: x.t.s }));
const itemsR = (cell, di = 0, set = R) => set.map((t) => ({ t, v: t.cells[cell].nets[di] })).filter((x) => Number.isFinite(x.v)).map((x) => ({ tSig: x.t.tSig, net: x.v, tEntry: x.t.cells[cell].tf ?? x.t.tSig, tExit: x.t.cells[cell].te ?? x.t.tSig + DAY, liq: { 1: false }, s: x.t.s, cls: x.t.cls }));
// overlap classes: same minute as a clock signal, before a clock signal (it fired within the next 30 min), or never fired by the clock rule
const cBy = new Map(); C.forEach((t) => (cBy.get(t.s) || cBy.set(t.s, []).get(t.s)).push(t.tSig));
R.forEach((t) => { const cs = cBy.get(t.s) || []; const near = cs.filter((x) => Math.abs(x - t.tSig) <= 30 * MIN); t.cls = near.some((x) => x === t.tSig) ? 'same moment' : near.some((x) => x > t.tSig) ? 'earlier than the 15m rule' : 'missed by the 15m rule'; });

const W10 = (a) => { const s = [...a].sort((x, y) => x - y); return mean(s.slice(0, Math.max(1, Math.ceil(s.length * 0.1)))); };
const L = ['# v1k: kayan 1 dakikalık pencere ile saate hizalı 15m kapanış karşılaştırması', '', `Oluşturuldu: ${new Date().toISOString()} · protokol: \`docs/v1k-1dk-protokol.md\` (sonuçlardan önce commit'lendi). Dönem 2022-01 → ${new Date(TO).toISOString().slice(0, 10)}, bölme ${new Date(SPLIT).toISOString().slice(0, 10)}.`, '',
  `Kapsam: kayan kural R ${R.length} sinyal; 15m kuralı C ${C.length} sinyal. İndirme hatası ${dl.errorCount || 0}.`, '',
  '| hücre | n | KEŞİF n / ort | DOĞRULAMA n | ort | ortanca | kazanma | %90 aralık | 15 dk gecikme ort | günde 2: getiri % / düşüş % | ayda $ / en kötü ay $ |', '|---|---|---|---|---|---|---|---|---|---|---|'];
const cells = [['C: K0', itemsC('K0'), itemsC('K0', 1)], ['C: K1', itemsC('K1'), itemsC('K1', 1)], ['C: K2', itemsC('K2'), itemsC('K2', 1)], ['R0', itemsR('R0'), itemsR('R0', 1)], ['R1', itemsR('R1'), itemsR('R1', 1)], ['R2', itemsR('R2'), itemsR('R2', 1)]];
const res = {};
for (const [name, it, it15] of cells) {
  const k = it.filter((x) => x.tSig < SPLIT), d = it.filter((x) => x.tSig >= SPLIT), sd = summary(d), sk = summary(k);
  const half = Math.floor(d.length / 2), h1 = mean(d.slice(0, half).map((x) => x.net)), h2 = mean(d.slice(half).map((x) => x.net));
  const fo = d.length ? follower(d, { L: 1, perDay: 2 }) : null, mo = fo ? monthly(fo.byMonth, Math.min(...d.map((x) => x.tEntry)), Math.max(...d.map((x) => x.tExit))) : { expected: NaN, worst: NaN };
  const d15 = mean(it15.filter((x) => x.tSig >= SPLIT).map((x) => x.net));
  res[name] = { sd, sk, h1, h2, fo, d15, n: d.length };
  L.push(`| ${name} | ${it.length} | ${sk.n} / ${f(sk.mean)} | ${sd.n} | ${f(sd.mean)} | ${f(sd.median)} | ${f(sd.win, 0)}% | ${f(sd.lo)} … ${f(sd.hi)} | ${f(d15)} | ${fo ? f(fo.ret, 0) + ' / ' + f(fo.dd, 1) : '—'} | ${f(mo.expected, 1)} / ${f(mo.worst, 1)} |`);
}
L.push('', '## Örtüşme: kayan kuralın sinyalleri 15m kuralıyla nasıl ilişkili (R1, filtreli)', '', '| sınıf | n (tüm dönem) | ort | DOĞRULAMA n | DOĞRULAMA ort |', '|---|---|---|---|---|');
const cls = ['same moment', 'earlier than the 15m rule', 'missed by the 15m rule'];
const clsRes = {};
for (const cl of cls) { const a = itemsR('R1').filter((x) => x.cls === cl), d = a.filter((x) => x.tSig >= SPLIT); clsRes[cl] = { n: a.length, dn: d.length, dm: mean(d.map((x) => x.net)) }; L.push(`| ${cl} | ${a.length} | ${f(mean(a.map((x) => x.net)))} | ${d.length} | ${f(mean(d.map((x) => x.net)))} |`); }
L.push('', '## Karar (protokol)', '', '| karşılaştırma | n ≥ 100 | ort ≥ C+0.3 | %90 alt > 0 | iki yarı > 0 | 15 dk gecikme > 0 | günde 2: getiri > 0 ve düşüş ≤ %30 | kaçan sinyaller > 0 | sonuç |', '|---|---|---|---|---|---|---|---|---|');
let adopt = [];
for (const [rc, cc] of [['R1', 'C: K1'], ['R2', 'C: K2']]) {
  const r = res[rc], c = res[cc];
  const cs = [r.n >= 100, r.sd.mean >= c.sd.mean + 0.3, r.sd.lo > 0, r.h1 > 0 && r.h2 > 0, r.d15 > 0, !!r.fo && r.fo.ret > 0 && r.fo.dd >= -30, clsRes['missed by the 15m rule'].dn > 0 && clsRes['missed by the 15m rule'].dm > 0];
  const ok = cs.every(Boolean); if (ok) adopt.push(rc);
  L.push(`| ${rc} vs ${cc} | ${cs.map((v, i) => (v ? 'evet' : 'hayır') + (i === 1 ? ` (${f(r.sd.mean)} vs ${f(c.sd.mean)})` : '')).join(' | ')} | ${ok ? '**YERİNE GEÇER**' : 'saate hizalı kural kalır'} |`);
}
L.push('', adopt.length ? `**Sonuç: ${adopt.join(', ')} saate hizalı kuralın yerine geçebilir.** Canlıya almadan önce gölgede doğrulanmalı.` : '**Sonuç: kayan pencere saate hizalı kuralı geçmedi; canlı kural (15m kapanış) kalır.**', '');
fs.writeFileSync(path.join(HERE, '..', '..', 'docs', 'v1k-1dk-rapor.md'), L.join('\n') + '\n');
log('report written');
