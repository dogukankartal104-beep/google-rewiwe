#!/usr/bin/env node
// docs/v1k-teyit-protokol.md → docs/v1k-teyit-rapor.md.   node --max-old-space-size=6144 bt/v1/teyit.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSymbols, loadKlines, csvText, parseMetrics, parseKlines, metricsDaily, klinesDaily, dayKey, stats as dl } from '../archive.js';
import { minuteBars, fundingOf } from '../analiz/data.js';
import { summary, follower, monthly, f, mean } from '../analiz/analyses.js';
import { benjaminiHochberg, pValueMeanPositive } from '../stats.js';
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

/* ---- stage 2: rolling trigger, then a pullback from the high confirms the entry ---- */
const CELLS = { P1: { p: 0.015, F: false }, P2: { p: 0.03, F: false }, P1F: { p: 0.015, F: true }, P2F: { p: 0.03, F: true } };
async function scanCoin(sym, days) {
  const out = [];
  const clusters = []; for (const d of days) { const c = clusters[clusters.length - 1]; if (c && d - c.to <= 3 * DAY) c.to = d; else clusters.push({ from: d, to: d }); }
  let last = 0;
  for (const c of clusters) {
    const { k } = await minuteBars(sym, c.from - DAY, c.to + 3 * DAY);
    if (k.length < 1500) continue;
    const P = new Float64Array(k.length + 1); for (let i = 0; i < k.length; i++) P[i + 1] = P[i] + k[i].q;
    const base = k[0].t, idxOf = (t) => Math.round((t - base) / MIN);
    const funding = await fundingOf(sym, c.from - DAY, c.to + 3 * DAY);
    for (let i = 1440; i < k.length - 40; i++) {
      const t = k[i].t, tSig = t + MIN;
      if (tSig < c.from || tSig >= c.to + DAY || tSig < FROM || tSig >= TO) continue;
      if (idxOf(t) !== i || k[i - 15].t !== t - 15 * MIN || k[i - 1440].t !== t - 1440 * MIN) continue;
      if (tSig - last < 4 * 36e5) continue;
      if (!(k[i].v > 0) || k[i].h === k[i].l) continue;
      if (k[i].c / k[i - 15].c - 1 < 0.04 || k[i].c / k[i - 1440].c - 1 < 0.5) continue;
      const vol24 = P[i + 1] - P[i + 1 - 1440]; if (vol24 < 1e6) continue;
      const b1 = await btcClose(t), b0 = await btcClose(t - 1440 * MIN);
      if (!Number.isFinite(b1) || !Number.isFinite(b0) || b1 / b0 - 1 > -0.01) continue;
      last = tSig;
      const recs = await recsM(sym, tSig - DAY, tSig + DAY);
      const i1 = latest(recs, tSig), i0m = latest(recs, tSig - 15 * MIN);
      const oi15 = i1 >= 0 && i0m >= 0 && recs[i0m].u > 0 ? (recs[i1].u / recs[i0m].u - 1) * 100 : null;
      const rec = { key: `${sym}|${tSig}`, s: sym, tSig, oi15, cells: {} };
      for (const [name, c2] of Object.entries(CELLS)) {
        if (c2.F && !(oi15 !== null && oi15 <= FILTER_OI15)) { rec.cells[name] = { nets: ['skip', 'skip'] }; continue; }
        // first 1m close within 30 minutes that is at least p below the highest high since the trigger
        let H = k[i].h, m = -1;
        for (let j = i + 1; j <= i + 30; j++) { H = Math.max(H, k[j].h); if (k[j].v > 0 && k[j].c <= H * (1 - c2.p)) { m = j; break; } }
        if (m < 0) { rec.cells[name] = { nets: ['none', 'none'] }; continue; }
        const nets = []; let meta = {};
        for (const d of [0, 15]) { const r = engineEntry({ k, i0: i + 1, tSig, funding, recs, vol: vol24, entryIdx: m + 1 + d }); nets.push(r.ok ? r.net : null); if (d === 0 && r.ok) meta = { te: r.te, tf: r.tEntry }; }
        rec.cells[name] = { nets, ...meta };
      }
      out.push(rec);
    }
  }
  return out;
}

/* ---------------- main ---------------- */
const cacheFile = path.join(OUT, 'teyit.jsonl');
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
    if (++n % 50 === 0) log(`coins ${n}/${syms.length} · triggers so far ${recsAll.length}`);
  }
}));
fs.closeSync(fd);

/* ---------------- report ---------------- */
const R = recsAll.sort((a, b) => a.tSig - b.tSig);
const C = fs.readFileSync(path.join(OUT, 'combo.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && !r.fail).sort((a, b) => a.tSig - b.tSig);
const cOk = (t, cell) => (cell === 'K0' || (Number.isFinite(t.oi15) && t.oi15 <= FILTER_OI15));
const itemsC = (cell, di = 0) => C.filter((t) => cOk(t, cell)).map((t) => ({ t, v: t.cells[cell].nets[di] })).filter((x) => Number.isFinite(x.v)).map((x) => ({ tSig: x.t.tSig, net: x.v, tEntry: x.t.cells[cell].tf ?? x.t.tSig, tExit: x.t.cells[cell].te ?? x.t.tSig + DAY, liq: { 1: false }, s: x.t.s }));
const itemsR = (cell, di = 0) => R.map((t) => ({ t, v: t.cells[cell].nets[di] })).filter((x) => Number.isFinite(x.v)).map((x) => ({ tSig: x.t.tSig, tS: x.t.tSig, net: x.v, tEntry: x.t.cells[cell].tf ?? x.t.tSig, tExit: x.t.cells[cell].te ?? x.t.tSig + DAY, liq: { 1: false }, s: x.t.s }));
const L = ['# v1k ikinci motor adayı: kayan pencere tetik + geri çekilme teyidi', '', `Oluşturuldu: ${new Date().toISOString()} · protokol: \`docs/v1k-teyit-protokol.md\` (sonuçlardan önce commit'lendi). Dönem 2022-01 → ${new Date(TO).toISOString().slice(0, 10)}, bölme ${new Date(SPLIT).toISOString().slice(0, 10)}.`, '',
  `Kapsam: ${R.length} kayan tetik; 15m kuralı C ${C.length} sinyal. İndirme hatası ${dl.errorCount || 0}.`, '',
  '| hücre | n | KEŞİF n / ort | DOĞRULAMA n | ort | ortanca | kazanma | %90 aralık | 15 dk gecikme ort | günde 2: getiri % / düşüş % | ayda $ / en kötü ay $ |', '|---|---|---|---|---|---|---|---|---|---|---|'];
const cellsList = [['C: K0', itemsC('K0'), itemsC('K0', 1)], ['C: K1', itemsC('K1'), itemsC('K1', 1)], ...Object.keys(CELLS).map((c) => [c, itemsR(c), itemsR(c, 1)])];
const res = {};
for (const [name, it, it15] of cellsList) {
  const kk = it.filter((x) => x.tSig < SPLIT), d = it.filter((x) => x.tSig >= SPLIT), sd = summary(d), sk = summary(kk);
  const half = Math.floor(d.length / 2), h1 = mean(d.slice(0, half).map((x) => x.net)), h2 = mean(d.slice(half).map((x) => x.net));
  const fo2 = d.length ? follower(d, { L: 1, perDay: 2 }) : null, mo = fo2 ? monthly(fo2.byMonth, Math.min(...d.map((x) => x.tEntry)), Math.max(...d.map((x) => x.tExit))) : { expected: NaN, worst: NaN };
  res[name] = { sd, sk, h1, h2, fo2, d15: mean(it15.filter((x) => x.tSig >= SPLIT).map((x) => x.net)), d, it };
  L.push(`| ${name} | ${it.length} | ${sk.n} / ${f(sk.mean)} | ${sd.n} | ${f(sd.mean)} | ${f(sd.median)} | ${f(sd.win, 0)}% | ${f(sd.lo)} … ${f(sd.hi)} | ${f(res[name].d15)} | ${fo2 ? f(fo2.ret, 0) + ' / ' + f(fo2.dd, 1) : '—'} | ${f(mo.expected, 1)} / ${f(mo.worst, 1)} |`);
}
// relation to v1k (C: K1) and combined account
const k1 = res['C: K1'].d, k1By = new Map(); k1.forEach((x) => (k1By.get(x.s) || k1By.set(x.s, []).get(x.s)).push(x.tSig));
const dayNet = (arr) => { const m = new Map(); arr.forEach((x) => { const d0 = Math.floor(x.tEntry / DAY); m.set(d0, (m.get(d0) || 0) + x.net); }); return m; };
const k1Alone = follower(k1, { L: 1, maxOpen: 3 });
L.push('', `## v1k ile ilişki (DOĞRULAMA; v1k K1 tek başına, aynı anda en çok 3: bakiye ${f(k1Alone.final, 0)}, getiri ${f(k1Alone.ret, 0)}%, düşüş ${f(k1Alone.dd, 1)}%)`, '', '| aday | v1k ile aynı coin ±1 saat | günlük getiri korelasyonu | birleşik (K1 + aday, aynı anda en çok 3): getiri % / düşüş % |', '|---|---|---|---|');
const rel = {};
for (const c of Object.keys(CELLS)) {
  const d = res[c].d, same = d.filter((x) => (k1By.get(x.s) || []).some((t) => Math.abs(t - x.tSig) <= 36e5)).length;
  const a = dayNet(k1), b = dayNet(d), days = [...new Set([...a.keys(), ...b.keys()])], xa = days.map((x) => a.get(x) || 0), xb = days.map((x) => b.get(x) || 0), ma = mean(xa), mb = mean(xb);
  let sxy = 0, sxx = 0, syy = 0; days.forEach((_, i) => { sxy += (xa[i] - ma) * (xb[i] - mb); sxx += (xa[i] - ma) ** 2; syy += (xb[i] - mb) ** 2; });
  const comb = follower([...k1, ...d], { L: 1, maxOpen: 3 });
  rel[c] = { sameShare: d.length ? same / d.length : NaN, comb };
  L.push(`| ${c} | ${same}/${d.length} (${f(rel[c].sameShare * 100, 0)}%) | ${f(sxy / Math.sqrt(sxx * syy), 3)} | ${f(comb.ret, 0)} / ${f(comb.dd, 1)} |`);
}
// decision
const names = Object.keys(CELLS);
const pv = names.map((c) => { const base = res[CELLS[c].F ? 'C: K1' : 'C: K0'].sd.mean; const cen = res[c].d.map((x) => ({ ...x, net: x.net - base })); return cen.length >= 20 ? pValueMeanPositive(cen, (x) => x.net, 800) : 1; });
const bh = benjaminiHochberg(pv, 0.10);
L.push('', '## Geçme şartları (ikinci motor olarak)', '', '| hücre | n ≥ 100 | ort > 0 | %90 alt > 0 | iki yarı > 0 | 15 dk gecikme > 0 | günde 2: getiri > 0 ve düşüş ≤ %30 | v1k ile aynı ≤ %50 | birleşik getiri > K1 tek başına ve düşüş ≤ %30 | BH | sonuç |', '|---|---|---|---|---|---|---|---|---|---|---|');
const passed = [];
names.forEach((c, i) => {
  const r = res[c], rl = rel[c];
  const cs = [r.d.length >= 100, r.sd.mean > 0, r.sd.lo > 0, r.h1 > 0 && r.h2 > 0, r.d15 > 0, !!r.fo2 && r.fo2.ret > 0 && r.fo2.dd >= -30, rl.sameShare <= 0.5, rl.comb.ret > k1Alone.ret && rl.comb.dd >= -30];
  const ok = cs.every(Boolean); if (ok) passed.push(c);
  L.push(`| ${c} | ${cs.map((v) => (v ? 'evet' : 'hayır')).join(' | ')} | ${bh[i] ? 'evet' : 'hayır'} | ${ok ? '**GEÇTİ**' : 'geçmedi'} |`);
});
const order = ['P1', 'P2', 'P1F', 'P2F'], chosen = order.find((c) => passed.includes(c));
L.push('', chosen ? `**Sonuç: ${chosen} ikinci motor olabilir (geçenler: ${passed.join(', ')}; en sade seçildi).${bh[names.indexOf(chosen)] ? '' : ' Çoklu test düzeltmesinden geçmedi: şansa bağlı olabilir.'}**` : '**Sonuç: hiçbir hücre ikinci motor şartlarını sağlamadı; ikinci motor eklenmez.**', '');
fs.writeFileSync(path.join(HERE, '..', '..', 'docs', 'v1k-teyit-rapor.md'), L.join('\n') + '\n');
log('report written');
