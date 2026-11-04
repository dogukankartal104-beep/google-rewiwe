#!/usr/bin/env node
// docs/v1k-arge-protokol.md → docs/v1k-arge-rapor.md.   node --max-old-space-size=6144 bt/v1/arge.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKlines, csvText, parseMetrics, metricsDaily, dayKey } from '../archive.js';
import { minuteBars, fundingOf } from '../analiz/data.js';
import { summary, cooldown, follower, monthly, f, mean, median } from '../analiz/analyses.js';
import { benjaminiHochberg, pValueMeanPositive } from '../stats.js';
import { FEE, SLIP, STOP_EXTRA } from './sim.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'out', 'v1');
const MIN = 6e4, M15 = 9e5, HOUR = 36e5, DAY = 864e5;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ---------------- indicators on candle lists ---------------- */
const rsi14 = (c) => { if (c.length < 15) return NaN; let g = 0, l = 0; for (let i = 1; i <= 14; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; } g /= 14; l /= 14; for (let i = 15; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * 13 + Math.max(d, 0)) / 14; l = (l * 13 + Math.max(-d, 0)) / 14; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); };
const ema20 = (c) => { const k = 2 / 21; let e = c[0]; for (let i = 1; i < c.length; i++) e = c[i] * k + e * (1 - k); return e; };
function aggregate(bars, tfMs, tCut) {          // clock-aligned candles fully closed before tCut
  const g = new Map();
  for (const b of bars) { if (b.t + (b.dur || MIN) > tCut) continue; const key = Math.floor(b.t / tfMs); let a = g.get(key); if (!a) { a = { t: key * tfMs, o: b.o, h: b.h, l: b.l, c: b.c, q: 0, tq: 0, n: 0, dur: 0 }; g.set(key, a); } a.h = Math.max(a.h, b.h); a.l = Math.min(a.l, b.l); a.c = b.c; a.q += b.q; a.tq += b.tq; a.n++; a.dur += b.dur || MIN; }
  return [...g.values()].filter((a) => a.dur === tfMs && a.t + tfMs <= tCut).sort((a, b) => a.t - b.t);
}
function tfFeatures(cs) {
  if (cs.length < 16) return null;
  const last = cs[cs.length - 1], closes = cs.slice(-60).map((x) => x.c), rng = last.h - last.l;
  return { r: (last.c / last.o - 1) * 100, wick: rng > 0 ? (last.h - Math.max(last.o, last.c)) / rng : 0, cvd: last.q > 0 ? (2 * last.tq - last.q) / last.q : 0, rsi: rsi14(closes), dist: (last.c / ema20(closes) - 1) * 100 };
}
const TFS = [['1m', MIN], ['3m', 3 * MIN], ['5m', 5 * MIN], ['10m', 10 * MIN], ['15m', M15], ['30m', 2 * M15], ['45m', 3 * M15], ['1h', HOUR], ['2h', 2 * HOUR], ['4h', 4 * HOUR]];
const FEAT = ['r', 'wick', 'cvd', 'rsi', 'dist'];

/* ---------------- statistics helpers ---------------- */
const rank = (a) => { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let m = i; m <= j; m++) r[idx[m][1]] = (i + j) / 2 + 1; i = j + 1; } return r; };
const auc = (pos, neg) => { if (pos.length < 8 || neg.length < 8) return { a: NaN, p: 1 }; const all = [...pos, ...neg], r = rank(all); let rs = 0; for (let i = 0; i < pos.length; i++) rs += r[i]; const n1 = pos.length, n2 = neg.length, a = (rs - n1 * (n1 + 1) / 2) / (n1 * n2); const z = (a - 0.5) / Math.sqrt((n1 + n2 + 1) / (12 * n1 * n2)); const p = 2 * (1 - normCdf(Math.abs(z))); return { a, p }; };
function normCdf(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }
const spearman = (x, y) => { const ok = x.map((v, i) => [v, y[i]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)); if (ok.length < 20) return NaN; const rx = rank(ok.map((o) => o[0])), ry = rank(ok.map((o) => o[1])), n = ok.length, mx = mean(rx), my = mean(ry); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (rx[i] - mx) * (ry[i] - my); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - my) ** 2; } return sxy / Math.sqrt(sxx * syy); };
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, a.length - 1)) || 1; };

/* ---------------- entry-timing simulation (section B) ---------------- */
function simEntry(k, i0, tSig, cell, funding) {
  const ref = k[i0].o, stopPx = ref * 1.5, tEnd = tSig + DAY;
  const fills = [];                          // {frac, idx, px}
  const limitFill = (x) => { const L = ref * (1 + x / 100); for (let j = i0; j < k.length && k[j].t < tSig + 2 * HOUR; j++) if (k[j].v > 0 && k[j].h >= L) return { idx: j, px: L }; return null; };
  if (cell === 'E0') fills.push({ frac: 1, idx: i0, px: ref });
  else if (cell === 'E1') {
    for (let b = 0; b < 8; b++) {
      const t0 = tSig + b * M15; const seg = k.filter((x) => x.t >= t0 && x.t < t0 + M15);
      if (seg.length < 15) break;
      if (seg[seg.length - 1].c < seg[0].o) { const j = k.findIndex((x) => x.t === t0 + M15); if (j > 0) fills.push({ frac: 1, idx: j, px: k[j].o }); break; }
    }
  } else if (cell === 'E2' || cell === 'E3' || cell === 'E4') { const x = { E2: 3, E3: 5, E4: 8 }[cell]; const l = limitFill(x); if (l) fills.push({ frac: 1, ...l }); }
  else if (cell === 'E5') { fills.push({ frac: 0.5, idx: i0, px: ref }); const l = limitFill(5); if (l) fills.push({ frac: 0.5, ...l }); }
  else if (cell === 'E6') { fills.push({ frac: 1 / 3, idx: i0, px: ref }); for (const x of [5, 10]) { const l = limitFill(x); if (l) fills.push({ frac: 1 / 3, ...l }); } }
  if (!fills.length) return { filled: 0, net: 0 };
  let net = 0, filled = 0, tExit = 0;
  for (const fl of fills) {
    let exit = 'time', xpx = null, xt = null, last = fl.px;
    for (let j = fl.idx; j < k.length; j++) {
      const c = k[j];
      if (c.t >= tEnd) { xpx = c.v > 0 ? c.o : last; xt = c.t; break; }
      if (c.v <= 0) continue; last = c.c;
      if (c.h >= stopPx) { exit = 'stop'; xpx = stopPx; xt = c.t; break; }
    }
    if (xpx === null) return { filled: 0, net: NaN };
    const gross = (fl.px - xpx) / fl.px * 100, cost = FEE + SLIP + (exit === 'stop' ? STOP_EXTRA : 0);
    let fund = 0; for (const e of funding) if (e.t > k[fl.idx].t && e.t <= xt) fund += e.r * 100;
    net += fl.frac * (gross - cost + fund); filled += fl.frac; tExit = Math.max(tExit, xt);
  }
  return { filled, net, tExit };
}

/* ---------------- build per-signal records ---------------- */
const recs = fs.readFileSync(path.join(OUT, 'records.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const sigs = cooldown(recs.filter((r) => !r.fail && r.v1k && r.tp?.TABAN), 4).sort((a, b) => a.tSig - b.tSig);
log('v1k signals', sigs.length);
// pump density: distinct coins with a v1-candidate alarm
const alarms = [];
for (const fn of fs.readdirSync(path.join(OUT, 'scan'))) for (const c of JSON.parse(fs.readFileSync(path.join(OUT, 'scan', fn), 'utf8'))) alarms.push([c.tSig, c.s]);
alarms.sort((a, b) => a[0] - b[0]);
const density = (t) => { let lo = 0, hi = alarms.length; while (lo < hi) { const m = (lo + hi) >> 1; if (alarms[m][0] < t - DAY) lo = m + 1; else hi = m; } const s = new Set(); for (let i = lo; i < alarms.length && alarms[i][0] < t; i++) s.add(alarms[i][1]); return s.size; };
const tMin = sigs[0].tSig, tMax = sigs[sigs.length - 1].tSig;
const { k: btc } = await loadKlines('BTCUSDT', '15m', tMin - 9 * DAY, tMax + DAY);
const bIdx = new Map(btc.map((x, i) => [x.t, i]));

const cacheFile = path.join(OUT, 'arge.jsonl');
const done = new Map();
if (fs.existsSync(cacheFile)) for (const l of fs.readFileSync(cacheFile, 'utf8').split('\n')) { if (!l) continue; try { const r = JSON.parse(l); done.set(r.key, r); } catch { /* torn */ } }
const metricsCache = new Map();
async function recsM(sym, from, to) { const out = []; for (let d = Math.floor(from / DAY) * DAY; d <= to; d += DAY) { const key = sym + '|' + dayKey(d); let r = metricsCache.get(key); if (r === undefined) { const t = await csvText(metricsDaily(sym, dayKey(d))).catch(() => null); r = t ? parseMetrics(t) : null; metricsCache.set(key, r); if (metricsCache.size > 2000) metricsCache.delete(metricsCache.keys().next().value); } if (r) out.push(...r); } return out.sort((a, b) => a.t - b.t); }
const latest = (arr, ts) => { let lo = 0, hi = arr.length - 1, b = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].t <= ts) { b = m; lo = m + 1; } else hi = m - 1; } return b; };

async function build(r) {
  const out = { key: r.key, tSig: r.tSig, s: r.s };
  const { k } = await minuteBars(r.s, r.tSig - 5 * HOUR, r.tSig + DAY + 90 * MIN);
  const i0 = k.findIndex((x) => x.t === r.tSig);
  if (i0 < 200) return { ...out, fail: 'not enough 1m history' };
  const funding = await fundingOf(r.s, r.tSig - 2 * DAY, r.tSig + DAY + HOUR);
  // --- B: entry cells
  out.E = {};
  for (const c of ['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6']) out.E[c] = simEntry(k, i0, r.tSig, c, funding.filter((e) => e.t > r.tSig));
  // --- D: label
  const entry = k[i0].o; let label = null;
  for (let j = i0; j < k.length && k[j].t < r.tSig + DAY; j++) { if (k[j].v <= 0) continue; const up = k[j].h >= entry * 1.10, dn = k[j].l <= entry * 0.90; if (up) { label = 'DEVAM'; break; } if (dn) { label = 'TEPE'; break; } }
  out.label = label;
  // --- D: multi-timeframe features
  const m1 = k.slice(0, i0).map((x) => ({ ...x, dur: MIN })), pre1 = m1.slice(-400);
  const { k: k15 } = await loadKlines(r.s, '15m', r.tSig - 66 * HOUR, r.tSig);
  const b15 = k15.map((x) => ({ ...x, dur: M15 }));
  out.mtf = {};
  for (const [nm, ms] of TFS) { const cs = ms <= M15 ? aggregate(pre1, ms, r.tSig) : aggregate(b15, ms, r.tSig); const ft = tfFeatures(cs); if (ft) for (const x of FEAT) out.mtf[`${nm}.${x}`] = ft[x]; }
  const sumq = (a, b) => { let q = 0, tq = 0; for (let j = a; j < b; j++) { q += k[j].q; tq += k[j].tq; } return { q, cvd: q > 0 ? (2 * tq - q) / q : 0 }; };
  const c15 = sumq(i0 - 15, i0), cprev = sumq(i0 - 60, i0 - 15);
  out.chg = { cvdDelta: c15.cvd - cprev.cvd };
  let pq = 0; for (let b = 1; b <= 8; b++) pq += sumq(i0 - 15 * (b + 1), i0 - 15 * b).q; out.chg.volRatio = c15.q / ((pq / 8) || 1);
  const rM = await recsM(r.s, r.tSig - DAY, r.tSig);
  const i1 = latest(rM, r.tSig), i15 = latest(rM, r.tSig - 15 * MIN), i60 = latest(rM, r.tSig - HOUR);
  out.chg.oi15 = i1 >= 0 && i15 >= 0 && rM[i15].u > 0 ? (rM[i1].u / rM[i15].u - 1) * 100 : NaN;
  out.chg.oi1h = i1 >= 0 && i60 >= 0 && rM[i60].u > 0 ? (rM[i1].u / rM[i60].u - 1) * 100 : NaN;
  let tk = 0, tn = 0; for (let m = Math.max(0, i1 - 11); m <= i1 && i1 >= 0; m++) if (Number.isFinite(rM[m].tk)) { tk += rM[m].tk; tn++; } out.chg.taker = tn ? tk / tn : NaN;
  let fnow = NaN; for (const e of funding) { if (e.t <= r.tSig) fnow = e.r * 100; else break; } out.chg.fund = fnow;
  // --- A: regime
  const bi = bIdx.get(r.tSig - M15);
  out.reg = { btc24: r.btc24, density: density(r.tSig), fund: fnow };
  if (bi !== undefined && bi >= 672) { out.reg.btc7d = (btc[bi].c / btc[bi - 672].c - 1) * 100; let hi = 0, lo = Infinity; for (let j = bi - 95; j <= bi; j++) { hi = Math.max(hi, btc[j].h); lo = Math.min(lo, btc[j].l); } out.reg.btcRange = (hi - lo) / btc[bi].c * 100; }
  return out;
}

const todo = sigs.filter((r) => !done.has(r.key));
log('to build', todo.length, 'cached', done.size);
const fd = fs.openSync(cacheFile, 'a');
let nb = 0;
await Promise.all(Array.from({ length: 5 }, async () => { while (todo.length) { const r = todo.shift(); let o; try { o = await build(r); } catch (e) { o = { key: r.key, tSig: r.tSig, s: r.s, fail: 'error: ' + e.message }; } fs.writeSync(fd, JSON.stringify(o) + '\n'); done.set(o.key, o); if (++nb % 100 === 0) log(`built ${nb}`); } }));
fs.closeSync(fd);

/* ---------------- report ---------------- */
const all = sigs.map((r) => ({ ...r, ...done.get(r.key) })).filter((r) => !r.fail);
const cut = Math.floor(all.length * 0.6);
const kes = all.slice(0, cut), dog = all.slice(cut);
const netT = (t) => t.tp.TABAN.n, netO = (t) => (t.early?.O1 ? t.early.O1.net : t.tp.TABAN.n);
const itm = (set, g, te = (t) => t.tp.TABAN.te) => set.map((t) => ({ tSig: t.tSig, tS: t.tSig, net: g(t), tEntry: t.tSig, tExit: te(t), liq: { 1: false } })).filter((x) => Number.isFinite(x.net));
const fol = (it, o = {}) => follower(it, { L: 1, ...o });
const L = ['# v1k: rejim, giriş zamanlaması, çeşitlendirme ve pump tepesi raporu', '', `Oluşturuldu: ${new Date().toISOString()} · protokol: \`docs/v1k-arge-protokol.md\` (sonuçlardan önce commit'lendi).`, '',
  `Kapsam: v1k sinyali ${sigs.length}, özellikleri çıkarılamayan ${sigs.length - all.length}; KEŞİF ${kes.length}, DOĞRULAMA ${dog.length} (bölme ${dog[0] ? new Date(dog[0].tSig).toISOString().slice(0, 10) : '—'}). Finora kanalı yerine Binance ikizi.`, ''];
const tbD = summary(itm(dog, netT)), tbK = summary(itm(kes, netT));
L.push(`TABAN: KEŞİF ort ${f(tbK.mean)} (n=${tbK.n}), DOĞRULAMA ort ${f(tbD.mean)} (n=${tbD.n}). Tüm sayılar net %, masraf ve funding dahil.`, '');

/* ===== A ===== */
L.push('## A. Rejim', '');
const VARS = ['btc7d', 'btc24', 'density', 'fund', 'btcRange'];
const get = (t, v) => t.reg?.[v];
const yrs = [...new Set(all.map((t) => new Date(t.tSig).getUTCFullYear()))].sort();
L.push('Yıl yıl: TABAN ortalaması (n) ve rejim değişkenlerinin ortancası', '', '| yıl | TABAN ort (n) | ' + VARS.join(' | ') + ' |', '|---|---|' + VARS.map(() => '---').join('|') + '|');
for (const y of yrs) { const s = all.filter((t) => new Date(t.tSig).getUTCFullYear() === y); L.push(`| ${y} | ${f(mean(s.map(netT)))} (${s.length}) | ` + VARS.map((v) => f(median(s.map((t) => get(t, v)).filter(Number.isFinite)))).join(' | ') + ' |'); }
L.push('', 'Her değişkenin tek tek işlem getirisiyle sıra korelasyonu (tüm dönem): ' + VARS.map((v) => `${v} ${f(spearman(all.map((t) => get(t, v)), all.map(netT)), 3)}`).join(' · '), '');
L.push('| kural (yalnız iyi rejimde al) | KEŞİF: ≤ medyan / > medyan ort | seçilen yarı | DOĞRULAMA n | DOĞRULAMA ort | TABAN\'a fark | günde en çok 2: getiri % | p (alt. fark > 0) |', '|---|---|---|---|---|---|---|---|');
const aRows = [];
for (const v of VARS) {
  const vals = kes.map((t) => get(t, v)).filter(Number.isFinite), med = median(vals);
  const lo = kes.filter((t) => get(t, v) <= med), hi = kes.filter((t) => get(t, v) > med);
  const mlo = mean(lo.map(netT)), mhi = mean(hi.map(netT)), side = mlo >= mhi ? 'low' : 'high';
  const pick = dog.filter((t) => Number.isFinite(get(t, v)) && (side === 'low' ? get(t, v) <= med : get(t, v) > med));
  const it = itm(pick, netT), s = summary(it), fo = fol(it, { perDay: 2 });
  const centered = it.map((x) => ({ ...x, net: x.net - tbD.mean }));
  const p = it.length >= 20 ? pValueMeanPositive(centered, (x) => x.net, 800) : 1;
  aRows.push({ v, s, fo, p, diff: s.mean - tbD.mean, n: it.length });
  L.push(`| ${v} ≤ ${f(med, 2)} ise ${side === 'low' ? 'al' : 'atla'} (yani ${side === 'low' ? '≤' : '>'} medyan) | ${f(mlo)} / ${f(mhi)} | ${side === 'low' ? '≤ medyan' : '> medyan'} | ${it.length} | ${f(s.mean)} | ${f(s.mean - tbD.mean)} | ${f(fo.ret, 0)} | ${f(p, 3)} |`);
}
const bhA = benjaminiHochberg(aRows.map((r) => r.p), 0.10);
L.push('', 'Geçme şartı (DOĞRULAMA n ≥ 100, TABAN\'dan ≥ +0.3, günde en çok 2 getiri > 0, BH): ' + aRows.map((r, i) => `${r.v}: ${r.n >= 100 && r.diff >= 0.3 && r.fo.ret > 0 && bhA[i] ? 'GEÇTİ' : 'geçmedi'}`).join(' · '), '');

/* ===== B ===== */
L.push('## B. Giriş zamanlaması', '', '"Aday başına ort" = dolmayan işlem 0 sayılır (yakalanan para); "dolan başına" yalnız dolanların ortalaması. KEŞİF / DOĞRULAMA.', '', '| hücre | KEŞİF aday başına | DOĞRULAMA aday başına | DOĞRULAMA dolan başına (n dolan) | DOĞRULAMA − E0 | günde en çok 2: getiri % | sonuç |', '|---|---|---|---|---|---|---|');
const E = ['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6'];
const eNet = (c) => (t) => t.E[c].net;
const e0d = mean(dog.map(eNet('E0')).filter(Number.isFinite));
for (const c of E) {
  const kn = mean(kes.map(eNet(c)).filter(Number.isFinite)), dn = dog.map(eNet(c)).filter(Number.isFinite), dm = mean(dn);
  const fl = dog.filter((t) => t.E[c].filled > 0 && Number.isFinite(t.E[c].net));
  const fo = fol(itm(fl, eNet(c), (t) => t.E[c].tExit), { perDay: 2 });
  const ok = c !== 'E0' && fl.length >= 100 && dm >= e0d + 0.3;
  L.push(`| ${c} | ${f(kn)} | ${f(dm)} | ${f(mean(fl.map(eNet(c))))} (${fl.length}) | ${f(dm - e0d)} | ${f(fo.ret, 0)} | ${c === 'E0' ? 'taban' : ok ? 'GEÇTİ' : 'geçmedi'} |`);
}
L.push('');

/* ===== C ===== */
L.push('## C. Boyut ve çeşitlendirme (betimleyici)', '');
const perDayCount = new Map(); all.forEach((t) => { const d = Math.floor(t.tSig / DAY); perDayCount.set(d, (perDayCount.get(d) || 0) + 1); });
const cnt = [...perDayCount.values()];
L.push(`Sinyalli gün ${cnt.length}; günlük sinyal ortanca ${median(cnt)}, en çok ${Math.max(...cnt)}, 3+ olan günlerin oranı ${f(cnt.filter((c) => c >= 3).length / cnt.length * 100, 0)}%.`, '', '| kural (1x, %5, DOĞRULAMA) | akış | alınan | bakiye $ | getiri % | en büyük düşüş % | en uzun kayıp | ayda beklenen $ | en kötü ay $ |', '|---|---|---|---|---|---|---|---|---|');
const spanM = (fo, it) => monthly(fo.byMonth, Math.min(...it.map((x) => x.tEntry)), Math.max(...it.map((x) => x.tExit)));
for (const [nm, opt] of [['sınırsız', {}], ['aynı anda en çok 3', { maxOpen: 3 }], ['günde en çok 2', { perDay: 2 }], ['ikisi birden', { perDay: 2, maxOpen: 3 }]]) {
  for (const [sn, g] of [['TABAN', netT], ['O1', netO]]) { const it = itm(dog, g, sn === 'TABAN' ? (t) => t.tp.TABAN.te : (t) => (t.early?.O1?.trig ? t.early.O1.te : t.tp.TABAN.te)); const fo = fol(it, opt), m = spanM(fo, it); L.push(`| ${nm} | ${sn} | ${fo.taken} | ${f(fo.final, 0)} | ${f(fo.ret, 0)} | ${f(fo.dd, 1)} | ${fo.longest} | ${f(m.expected, 1)} | ${f(m.worst, 1)} |`); }
}
try {
  const gt = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'out', 'analiz-trades.json'), 'utf8')).G;
  const g1 = gt.filter((x) => x.none?.ok && x.ret <= -10 && x.rankD <= 50 && x.tSig >= (dog[0]?.tSig || 0)).map((x) => ({ tSig: x.tSig, tEntry: x.none.tEntry, tExit: x.none.tExit, net: x.none.net, liq: { 1: false } }));
  const v1 = itm(dog, netO, (t) => (t.early?.O1?.trig ? t.early.O1.te : t.tp.TABAN.te));
  const dayNet = (arr) => { const m = new Map(); arr.forEach((x) => { const d = Math.floor(x.tEntry / DAY); m.set(d, (m.get(d) || 0) + x.net); }); return m; };
  const a = dayNet(v1), b = dayNet(g1), days = [...new Set([...a.keys(), ...b.keys()])].sort();
  const xa = days.map((d) => a.get(d) || 0), xb = days.map((d) => b.get(d) || 0), ma = mean(xa), mb = mean(xb);
  let sxy = 0, sxx = 0, syy = 0; days.forEach((_, i) => { sxy += (xa[i] - ma) * (xb[i] - mb); sxx += (xa[i] - ma) ** 2; syy += (xb[i] - mb) ** 2; });
  const comb = [...v1, ...g1];
  const foC = fol(comb, { maxOpen: 3 }), mC = spanM(foC, comb), foG = fol(g1, { maxOpen: 3 }), foV = fol(v1, { maxOpen: 3 });
  L.push('', `v1k (O1) ile G1-D akışları (DOĞRULAMA dönemi, n=${v1.length} ve ${g1.length}): günlük net getiri korelasyonu ${f(sxy / Math.sqrt(sxx * syy), 3)} (${days.length} gün).`,
    `Aynı anda en çok 3 açık ile bakiye: yalnız v1k-O1 ${f(foV.final, 0)} (düşüş ${f(foV.dd, 1)}%), yalnız G1-D ${f(foG.final, 0)} (düşüş ${f(foG.dd, 1)}%), ikisi birden ${f(foC.final, 0)} (düşüş ${f(foC.dd, 1)}%, ayda beklenen ${f(mC.expected, 1)} $, en kötü ay ${f(mC.worst, 1)} $).`);
} catch (e) { L.push('', 'G1-D akışı okunamadı (bt/out/analiz-trades.json): ' + e.message); }
L.push('');

/* ===== D ===== */
L.push('## D. Pump anatomisi ve tepe ayrımı', '');
const lab = (set) => ({ top: set.filter((t) => t.label === 'TEPE'), cont: set.filter((t) => t.label === 'DEVAM') });
const lk = lab(kes), ld = lab(dog);
L.push(`Etiket (ilk dokunan: −%10 = TEPE, +%10 = DEVAM): KEŞİF TEPE ${lk.top.length}, DEVAM ${lk.cont.length}, etiketsiz ${kes.length - lk.top.length - lk.cont.length}; DOĞRULAMA TEPE ${ld.top.length}, DEVAM ${ld.cont.length}, etiketsiz ${dog.length - ld.top.length - ld.cont.length}.`, '');
const featNames = [...TFS.flatMap(([nm]) => FEAT.map((x) => `${nm}.${x}`)), 'cvdDelta', 'volRatio', 'oi15', 'oi1h', 'taker', 'fund'];
const fv = (t, n) => (n in (t.mtf || {}) ? t.mtf[n] : t.chg?.[n]);
const rowsD = featNames.map((n) => {
  const ak = auc(lk.top.map((t) => fv(t, n)).filter(Number.isFinite), lk.cont.map((t) => fv(t, n)).filter(Number.isFinite));
  const ad = auc(ld.top.map((t) => fv(t, n)).filter(Number.isFinite), ld.cont.map((t) => fv(t, n)).filter(Number.isFinite));
  return { n, ak: ak.a, pk: ak.p, ad: ad.a, mt: median(lk.top.map((t) => fv(t, n)).filter(Number.isFinite)), mc: median(lk.cont.map((t) => fv(t, n)).filter(Number.isFinite)) };
});
const bhD = benjaminiHochberg(rowsD.map((r) => r.pk), 0.10);
rowsD.forEach((r, i) => { r.bh = bhD[i]; r.same = (r.ak > 0.55 && r.ad > 0.55) || (r.ak < 0.45 && r.ad < 0.45); r.sep = r.bh && r.same; });
L.push('AUC: olumlu sınıf = TEPE (fiyat önce −%10 gitti). 0.5 = ayırmaz; > 0.5 = özellik yüksekken TEPE daha olası. BH, KEŞİF p-değerleri üzerinde (q=0.10).', '', '| özellik | KEŞİF AUC | DOĞRULAMA AUC | BH | iki dönemde aynı yönde (>0.55 / <0.45) | ayırıcı | ortanca TEPE | ortanca DEVAM |', '|---|---|---|---|---|---|---|---|');
for (const r of [...rowsD].sort((a, b) => Math.abs(b.ak - 0.5) - Math.abs(a.ak - 0.5)).slice(0, 25)) L.push(`| ${r.n} | ${f(r.ak, 3)} | ${f(r.ad, 3)} | ${r.bh ? 'evet' : 'hayır'} | ${r.same ? 'evet' : 'hayır'} | ${r.sep ? '**evet**' : 'hayır'} | ${f(r.mt, 2)} | ${f(r.mc, 2)} |`);
L.push('', `(56 özelliğin en güçlü 25'i; tümü \`bt/out/v1/arge.jsonl\` içinde.) Ayırıcı sayısı: ${rowsD.filter((r) => r.sep).length}.`, '');
const seps = rowsD.filter((r) => r.sep).sort((a, b) => Math.abs(b.ak - 0.5) - Math.abs(a.ak - 0.5)).slice(0, 3);
if (!seps.length) L.push('**Tepeyi ayıran bir özellik bulunamadı (BH ve iki dönemde aynı yön şartını sağlayan yok): filtre denenmedi.**', '');
else {
  const stats = seps.map((r) => { const v = kes.map((t) => fv(t, r.n)).filter(Number.isFinite); return { n: r.n, sign: r.ak > 0.5 ? 1 : -1, m: mean(v), s: sd(v) }; });
  const score = (t) => stats.reduce((a, c) => { const x = fv(t, c.n); return a + (Number.isFinite(x) ? c.sign * (x - c.m) / c.s : 0); }, 0);
  const thr = median(kes.map(score));
  L.push(`Filtre: puan = ${stats.map((c) => (c.sign > 0 ? '+' : '−') + c.n).join(' ')} (z-skor toplamı), eşik = KEŞİF medyanı ${f(thr, 3)}; puanı eşiğin üstünde olanlar (TEPE yönü) alınır.`, '', '| akış | DOĞRULAMA n | ort | TABAN\'a fark | günde en çok 2 getiri % | düşüş % |', '|---|---|---|---|---|---|');
  for (const [sn, g, te] of [['TABAN', netT, (t) => t.tp.TABAN.te], ['O1', netO, (t) => (t.early?.O1?.trig ? t.early.O1.te : t.tp.TABAN.te)]]) {
    const pick = dog.filter((t) => score(t) >= thr), it = itm(pick, g, te), s = summary(it), fo = fol(it, { perDay: 2 }), base = mean(itm(dog, g, te).map((x) => x.net));
    const ok = it.length >= 100 && s.mean >= base + 0.5 && fo.ret > 0;
    L.push(`| ${sn} filtreli | ${it.length} | ${f(s.mean)} | ${f(s.mean - base)} | ${f(fo.ret, 0)} | ${f(fo.dd, 1)} | ${ok ? 'GEÇTİ' : 'geçmedi'} |`);
  }
  L.push('');
}
const pass = [];
L.push('## Özet', '', `- A rejim: ${aRows.map((r, i) => (r.n >= 100 && r.diff >= 0.3 && r.fo.ret > 0 && bhA[i] ? r.v : null)).filter(Boolean).join(', ') || 'geçen kural yok'}.`, `- B giriş: ${E.slice(1).filter((c) => { const fl = dog.filter((t) => t.E[c].filled > 0 && Number.isFinite(t.E[c].net)); return fl.length >= 100 && mean(dog.map(eNet(c)).filter(Number.isFinite)) >= e0d + 0.3; }).join(', ') || 'geçen hücre yok'}.`, `- D tepe ayrımı: ${seps.length ? seps.map((s) => s.n).join(', ') + ' ayırıcı bulundu' : 'ayırıcı bulunamadı'}.`, '');
fs.writeFileSync(path.join(HERE, '..', '..', 'docs', 'v1k-arge-rapor.md'), L.join('\n') + '\n');
log('report written');
