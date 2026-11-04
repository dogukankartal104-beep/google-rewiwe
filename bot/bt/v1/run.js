#!/usr/bin/env node
// docs/v1-tp-protokol.md and docs/stop-ayir-protokol.md  →  docs/v1-tp-rapor.md and docs/stop-ayir-rapor.md
// node --max-old-space-size=6144 bt/v1/run.js [--from 2022-01-01] [--limit N] [--out bt/out/v1] [--report-only]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSymbols, loadKlines, csvText, parseMetrics, metricsDaily, dayKey, stats as dl } from '../archive.js';
import { minuteBars, fundingOf } from '../analiz/data.js';
import { summary, cooldown, follower, monthly, ci90, f, mean, median } from '../analiz/analyses.js';
import { simulateParts, earlyClose, checkEvents, firstTrigger, CELLS_EARLY, HALF, TP_CELLS } from './sim.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const FROM = Date.parse(arg('from', '2022-01-01') + 'T00:00:00Z');
const TO = new Date(new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
const OUT = path.resolve(arg('out', path.join(HERE, '..', 'out', 'v1')));
fs.mkdirSync(path.join(OUT, 'scan'), { recursive: true });
const BAR = 9e5, MIN = 6e4, DAY = 864e5;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const DELAYS = [0, 5, 15];

/* ---------------- stage A: 15m candidates (cached per symbol) ---------------- */
async function scan(sym, btc) {
  const cf = path.join(OUT, 'scan', sym + '.json');
  if (fs.existsSync(cf)) return JSON.parse(fs.readFileSync(cf, 'utf8'));
  const { k } = await loadKlines(sym, '15m', FROM - 3 * DAY, TO);
  const out = [];
  let q = 0; for (let j = 0; j < 96 && j < k.length; j++) q += k[j].q;
  for (let i = 96; i < k.length; i++) {
    q += k[i].q - k[i - 96].q;
    const tSig = k[i].t + BAR;
    if (tSig < FROM || tSig >= TO) continue;
    if (k[i].t - k[i - 96].t !== 96 * BAR || k[i].t - k[i - 1].t !== BAR) continue;
    const r15 = (k[i].c / k[i - 1].c - 1) * 100, chg24 = (k[i].c / k[i - 96].c - 1) * 100;
    if (r15 < 4 || chg24 < 15 || q < 1e6 || !(k[i].v > 0) || k[i].h === k[i].l) continue;
    const bi = btc.idx.get(k[i].t);
    const btc24 = bi >= 96 ? (btc.k[bi].c / btc.k[bi - 96].c - 1) * 100 : null;
    out.push({ s: sym, tSig, r15, chg24, btc24, vol: q });
  }
  fs.writeFileSync(cf, JSON.stringify(out));
  return out;
}

/* ---------------- stage B: one record per candidate ---------------- */
const metricsCache = new Map();
async function metricsRecs(sym, fromMs, toMs) {
  const out = [];
  for (let d = Math.floor(fromMs / DAY) * DAY; d <= toMs; d += DAY) {
    const key = sym + '|' + dayKey(d);
    let r = metricsCache.get(key);
    if (r === undefined) { const t = await csvText(metricsDaily(sym, dayKey(d))).catch(() => null); r = t ? parseMetrics(t) : null; metricsCache.set(key, r); if (metricsCache.size > 3000) metricsCache.delete(metricsCache.keys().next().value); }
    if (r) out.push(...r);
  }
  return out.sort((a, b) => a.t - b.t);
}

async function build(c) {
  const rec = { key: `${c.s}|${c.tSig}`, s: c.s, tSig: c.tSig, r15: c.r15, chg24: c.chg24, btc24: c.btc24, vol: c.vol };
  const { k } = await minuteBars(c.s, c.tSig - 61 * MIN, c.tSig + DAY + 95 * MIN);
  const i0 = k.findIndex((x) => x.t === c.tSig);
  if (i0 < 60) return { ...rec, fail: 'no 1m candles around the alarm' };
  for (let j = Math.max(1, i0 - 60); j < k.length - 1 && j <= i0 + 1500; j++) if (k[j].t - k[j - 1].t !== MIN) return { ...rec, fail: 'gap in 1m data' };
  const cvd = (n) => { let s = 0; for (let j = i0 - n; j < i0; j++) s += 2 * k[j].tq - k[j].q; return s; };
  rec.cvd15 = cvd(15); rec.cvd60 = cvd(60);
  rec.v1 = c.chg24 >= 15 && rec.cvd15 < 0 && rec.cvd60 < 0;
  rec.v1k = c.chg24 >= 50 && c.btc24 !== null && c.btc24 <= -1;
  if (!rec.v1 && !rec.v1k) return rec;
  const funding = await fundingOf(c.s, c.tSig, c.tSig + DAY + 3600e3);
  rec.tp = {};
  for (const [name, cell] of Object.entries(TP_CELLS)) {
    const nets = []; let first = null;
    for (const d of DELAYS) {
      const r = simulateParts({ k, i0: i0 + d, parts: cell.parts, be: !!cell.be, funding });
      nets.push(r.ok ? r.net : null);
      if (d === 0) first = r.ok ? { x: r.exit, te: r.tExit, n: r.net, tEntry: r.tEntry } : null;
    }
    rec.tp[name] = { nets, ...(first || {}) };
  }
  const base = rec.tp.TABAN;
  if (!base?.n && base?.n !== 0) return { ...rec, fail: 'baseline path incomplete' };
  rec.base = { net: base.n, exit: base.x, te: base.te };
  // ---- early exits ----
  const recs = await metricsRecs(c.s, c.tSig - DAY, c.tSig + DAY);
  const ce = checkEvents({ k, i0, recs, baseExitT: base.te, volume24: c.vol });
  if (!ce.ok) { rec.early = null; rec.earlyWhy = ce.why; return rec; }
  rec.early = {};
  const totalChecks = ce.ev.length, missing = ce.ev.filter((x) => x.miss).length;
  rec.checks = { total: totalChecks, missing };
  const trigs = {};
  for (const [name, cond] of Object.entries(CELLS_EARLY)) {
    const x = firstTrigger(ce, cond, k, i0);
    trigs[name] = x;
    if (!x) { rec.early[name] = { trig: false, net: base.n }; continue; }
    const ec = earlyClose({ k, i0, jx: x.jx, funding });
    rec.early[name] = { trig: true, t: x.tc, P: x.P, dOI: x.dOI, dLS: x.dLS, taker: x.taker, net: ec.net, te: ec.t };
  }
  for (const [name, from] of Object.entries(HALF)) {
    const t = rec.early[from];
    rec.early[name] = t.trig ? { ...t, net: 0.5 * t.net + 0.5 * base.n, half: true } : { trig: false, net: base.n };
  }
  // in-trade discrimination: the first check at or after 1, 2, 4, 8 hours (only trades still open then)
  rec.auc = {};
  for (const h of [1, 2, 4, 8]) {
    const x = ce.ev.find((e) => !e.miss && e.tc >= c.tSig + h * 36e5);
    if (x) rec.auc[h] = { P: x.P, maxP: x.maxP, dOI: x.dOI, dLS: x.dLS, taker: x.taker };
  }
  return rec;
}

/* ---------------- main ---------------- */
const jsonl = path.join(OUT, 'records.jsonl');
const have = new Set();
if (fs.existsSync(jsonl)) for (const line of fs.readFileSync(jsonl, 'utf8').split('\n')) { if (!line) continue; try { have.add(JSON.parse(line).key); } catch { /* ignore a torn last line */ } }
if (!process.argv.includes('--report-only')) {
  let syms = await listSymbols();
  if (arg('limit')) syms = syms.slice(0, Number(arg('limit')));
  log('universe', syms.length, 'records already', have.size);
  const { k: bk } = await loadKlines('BTCUSDT', '15m', FROM - 5 * DAY, TO);
  const btc = { k: bk, idx: new Map(bk.map((x, i) => [x.t, i])) };
  const cands = []; let n = 0, scanErr = 0;
  const qs = [...syms];
  await Promise.all(Array.from({ length: 4 }, async () => { while (qs.length) { const s = qs.shift(); try { cands.push(...await scan(s, btc)); } catch (e) { scanErr++; } if (++n % 100 === 0) log(`scan ${n}/${syms.length} candidates ${cands.length}`); } }));
  log(`candidates ${cands.length} (scan errors ${scanErr})`);
  const todo = cands.filter((c) => !have.has(`${c.s}|${c.tSig}`)).sort((a, b) => a.tSig - b.tSig);
  const fd = fs.openSync(jsonl, 'a');
  let done = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (todo.length) {
      const c = todo.shift();
      let r; try { r = await build(c); } catch (e) { r = { key: `${c.s}|${c.tSig}`, s: c.s, tSig: c.tSig, fail: 'error: ' + e.message }; }
      fs.writeSync(fd, JSON.stringify(r) + '\n');
      if (++done % 200 === 0) log(`records ${done}/${done + todo.length}`);
    }
  }));
  fs.closeSync(fd);
}

/* ---------------- stage C: reports ---------------- */
const recsAll = fs.readFileSync(jsonl, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const failed = recsAll.filter((r) => r.fail);
const failWhy = (() => { const m = {}; failed.forEach((r) => { m[r.fail] = (m[r.fail] || 0) + 1; }); return Object.entries(m).map(([a, b]) => `${a}: ${b}`).join(', ') || '—'; })();
const arms = { 'v1 (Finora ikizi)': (r) => r.v1, 'v1k kolu': (r) => r.v1k };
const worst10 = (a) => { const s = [...a].sort((x, y) => x - y); return mean(s.slice(0, Math.max(1, Math.ceil(s.length * 0.1)))); };
const yearOf = (t) => new Date(t).getUTCFullYear();

function cellStats(trades, getNet, getTexit) {
  const items = trades.map((t) => ({ tSig: t.tSig, net: getNet(t), tEntry: t.tSig, tExit: getTexit(t), liq: { 1: false } })).filter((x) => Number.isFinite(x.net));
  return items;
}
const sline = (name, items, base) => {
  const s = summary(items);
  if (!s.n) return `| ${name} | 0 | — | — | — | — | — | — | — |`;
  const v = items.map((x) => x.net);
  let diff = '—';
  if (base) { const pd = items.map((x, i) => ({ tSig: x.tSig, net: x.net - base[i].net })); const sd = summary(pd); diff = `${f(sd.mean)} (${f(sd.lo)} … ${f(sd.hi)})`; }
  return `| ${name} | ${s.n} | ${f(s.mean)} | ${f(s.median)} | ${f(s.win, 0)}% | ${f(s.worst, 1)} | ${f(worst10(v))} | ${f(s.lo)} … ${f(s.hi)} | ${f(s.exTop5)} | ${diff} |`;
};
const HEAD = '| hücre | n | ort % | ortanca % | kazanma | en kötü % | en kötü %10 ort | %90 aralık | en iyi 5 hariç | TABAN\'a fark (aralık) |\n|---|---|---|---|---|---|---|---|---|---|';
const span = (items) => (items.length ? monthly(follower(items, { L: 1 }).byMonth, Math.min(...items.map((x) => x.tEntry)), Math.max(...items.map((x) => x.tExit))) : { expected: NaN, worst: NaN, months: 0 });

const out1 = ['# v1 SHORT: TP1/TP2/TP3 kademeli kâr alma raporu', '', `Oluşturuldu: ${new Date().toISOString()} · protokol: \`docs/v1-tp-protokol.md\` (sonuçlardan önce commit'lendi).`, '',
  '**Kaynak notu:** Finora kanal geçmişine bu oturumdan erişilemedi; sinyaller kuralın Binance arşivinden üretilen "ikizidir". Sonuçlar kanalın gerçek alarmları için değil, bu kuralın ikizi için geçerlidir.', '',
  `Kapsam: ${recsAll.length} aday kaydı, hatalı/atılan ${failed.length} (${failWhy}). Dönem: ${new Date(FROM).toISOString().slice(0, 10)} → ${new Date(TO).toISOString().slice(0, 10)}. İndirme hatası: ${dl.errorCount || 0}.`, ''];
const out2 = ['# v1 SHORT: stopa gidecek işlemi işlem sırasında tanıma raporu', '', `Oluşturuldu: ${new Date().toISOString()} · protokol: \`docs/stop-ayir-protokol.md\` (sonuçlardan önce commit'lendi).`, '',
  '**Kaynak notu:** sinyaller Finora kuralının Binance ikizidir (kanal geçmişi erişilemedi). **Tasfiye geçmişi** hücresi ölçülmedi: Bybit geçmiş tasfiye verisi yok, yalnız ileri kayıt (canlı WS allLiquidation) olabilir.', ''];
const oneLines = [];

for (const [armName, pick] of Object.entries(arms)) {
  const all = cooldown(recsAll.filter((r) => !r.fail && pick(r) && r.tp?.TABAN), 4).sort((a, b) => a.tSig - b.tSig);
  const cut = Math.floor(all.length * 0.6);
  const kes = all.slice(0, cut), dog = all.slice(cut);
  out1.push(`## ${armName}`, '', `n = ${all.length} işlem (KEŞİF ${kes.length}, DOĞRULAMA ${dog.length}; bölme tarihi ${dog[0] ? new Date(dog[0].tSig).toISOString().slice(0, 10) : '—'}).`, '');
  if (all.length < 10) { out1.push('Yetersiz veri: karar verilemez.', ''); continue; }

  /* ===== TP protocol ===== */
  const names = Object.keys(TP_CELLS);
  const itemsOf = (set, name, d = 0) => set.map((t) => ({ tSig: t.tSig, net: d === 0 ? t.tp[name].n : t.tp[name].nets[DELAYS.indexOf(d)], tEntry: t.tSig, tExit: t.tp[name].te, liq: { 1: false } })).filter((x) => Number.isFinite(x.net));
  const valid = (t) => names.every((n) => Number.isFinite(t.tp[n]?.n));
  const allV = all.filter(valid), kesV = kes.filter(valid), dogV = dog.filter(valid);
  if (allV.length !== all.length) out1.push(`Not: ${all.length - allV.length} işlemde bir hücrenin yolu tamamlanamadı, bütün hücrelerde ortak küme (${allV.length}) kullanıldı.`, '');
  for (const [title, set] of [['Tüm dönem', allV], ['KEŞİF (ilk %60)', kesV], ['DOĞRULAMA (son %40)', dogV]]) {
    out1.push(`### ${title}`, '', HEAD);
    const base = itemsOf(set, 'TABAN');
    for (const n of names) out1.push(sline(n, itemsOf(set, n), n === 'TABAN' ? null : base));
    out1.push('');
  }
  out1.push('### Yıl yıl ortalama % (n)', '', '| hücre | ' + [...new Set(allV.map((t) => yearOf(t.tSig)))].sort().join(' | ') + ' |', '|---|' + [...new Set(allV.map((t) => yearOf(t.tSig)))].map(() => '---').join('|') + '|');
  const yrs = [...new Set(allV.map((t) => yearOf(t.tSig)))].sort();
  for (const n of names) out1.push(`| ${n} | ` + yrs.map((y) => { const s = itemsOf(allV.filter((t) => yearOf(t.tSig) === y), n); return s.length ? `${f(mean(s.map((x) => x.net)))} (${s.length})` : '—'; }).join(' | ') + ' |');
  out1.push('', '### Takipçi: 1000 $, sinyal başına %5, 1x (tüm dönem)', '', '| hücre | son bakiye $ | en büyük düşüş % | en uzun kayıp serisi | ayda beklenen $ | en kötü ay $ |', '|---|---|---|---|---|---|');
  const fol = {};
  for (const n of names) { const it = itemsOf(allV, n); const r = follower(it, { L: 1 }); const m = span(it); fol[n] = { r, m }; out1.push(`| ${n} | ${f(r.final, 0)} | ${f(r.dd, 1)} | ${r.longest} | ${f(m.expected, 1)} | ${f(m.worst, 1)} |`); }
  out1.push('', '### Gecikme: giriş 0 / 5 / 15 dk geç, ortalama % (tüm dönem)', '', '| hücre | 0 dk | 5 dk | 15 dk |', '|---|---|---|---|');
  for (const n of names) out1.push(`| ${n} | ` + DELAYS.map((d) => f(mean(itemsOf(allV, n, d).map((x) => x.net)))).join(' | ') + ' |');
  // decision
  const dT = summary(itemsOf(dogV, 'TABAN')), kT = summary(itemsOf(kesV, 'TABAN'));
  out1.push('', '### Karar (protokol 5. bölüm)', '');
  if (!(dT.mean > 0 && dT.lo > 0)) {
    out1.push(`**TABAN DOĞRULAMA'da ortalama ${f(dT.mean)}%, %90 alt ${f(dT.lo)}: "v1 bu kanalda kâr etmiyor" (${armName}). TP sonucu ne olursa olsun yayın yok.**`);
  }
  const passing = [];
  out1.push('', '| hücre | DOĞRULAMA ort ≥ TABAN−0.3 | kazanma ≥ TABAN+5 | en kötü %10 > TABAN | KEŞİF>0 ve DOĞRULAMA>0 | sonuç |', '|---|---|---|---|---|---|');
  for (const n of names.filter((x) => x !== 'TABAN')) {
    const d = summary(itemsOf(dogV, n)), k2 = summary(itemsOf(kesV, n));
    const c1 = d.mean >= dT.mean - 0.3, c2 = d.win >= dT.win + 5, c3 = worst10(itemsOf(dogV, n).map((x) => x.net)) > worst10(itemsOf(dogV, 'TABAN').map((x) => x.net)), c4 = k2.mean > 0 && d.mean > 0;
    const ok = c1 && c2 && c3 && c4; if (ok) passing.push(n);
    out1.push(`| ${n} | ${c1 ? 'evet' : 'hayır'} (${f(d.mean)} vs ${f(dT.mean)}) | ${c2 ? 'evet' : 'hayır'} (${f(d.win, 0)} vs ${f(dT.win, 0)}) | ${c3 ? 'evet' : 'hayır'} | ${c4 ? 'evet' : 'hayır'} | ${ok ? 'TUTTU' : 'tutmadı'} |`);
  }
  const taban = dT.mean > 0 && dT.lo > 0;
  const tiers = (n) => TP_CELLS[n].tiers * 10 + (n.endsWith('b') ? 1 : 0);
  const chosen = passing.sort((a, b) => tiers(a) - tiers(b))[0];
  out1.push('', chosen ? (taban ? `**ÖNERİLEN: ${chosen}** (tutan hücreler: ${passing.join(', ')}; en sade seçildi). Yayından önce 30 canlı kâğıt sinyalle doğrulanmalı.` : `Tutan hücreler: ${passing.join(', ')} (en sade: ${chosen}) ama TABAN kâr etmediği için **yayın yok**.`) : '**Hiçbir TP hücresi koşulları sağlamadı: TP kademesi önerilmez.**', '');
  const refCell = chosen && taban ? chosen : 'TABAN';
  oneLines.push(`- ${armName}: 1000 $, %5, 1x ile ${refCell} hücresinde ayda beklenen ${f(fol[refCell].m.expected, 1)} $, en kötü ay ${f(fol[refCell].m.worst, 1)} $ (${fol[refCell].m.months} ay; ${chosen && taban ? 'önerilen hücre' : 'TABAN gösteriliyor, TP önerilmedi'}).`);

  /* ===== early exit protocol ===== */
  out2.push(`## ${armName}`, '');
  const E = all.filter((t) => t.early && t.early.O1);
  const miss = all.length - E.length;
  out2.push(`n = ${all.length} işlem; metrik verisi (OI, L/S, taker) olan ${E.length}, olmayan ${miss} (bu işlemler erken-çıkış analizinden atıldı; tabloda ortak küme ${E.length}).`, '');
  if (E.length < 10) { out2.push('Yetersiz veri: karar verilemez.', ''); continue; }
  const cut2 = Math.floor(E.length * 0.6), Ek = E.slice(0, cut2), Ed = E.slice(cut2);
  const eNames = ['TABAN', 'O1', 'O2', 'O3', 'L1', 'T1', 'Y1', 'Y2', 'Y3'];
  const eItems = (set, n) => set.map((t) => ({ tSig: t.tSig, net: n === 'TABAN' ? t.base.net : t.early[n].net, tEntry: t.tSig, tExit: n === 'TABAN' || !t.early[n].trig ? t.base.te : (t.early[n].half ? t.base.te : t.early[n].te), liq: { 1: false } }));
  const baseD = eItems(Ed, 'TABAN');
  const tDog = summary(baseD), tKes = summary(eItems(Ek, 'TABAN'));
  out2.push(`**TABAN: KEŞİF ort ${f(tKes.mean)}% (n=${tKes.n}); DOĞRULAMA ort ${f(tDog.mean)}% (n=${tDog.n}), %90 aralık ${f(tDog.lo)} … ${f(tDog.hi)}.**${tDog.mean <= 0 ? ' TABAN DOĞRULAMA\'da zarar ediyor.' : ''}`, '');
  for (const [title, set] of [['Tüm dönem', E], ['KEŞİF (ilk %60)', Ek], ['DOĞRULAMA (son %40)', Ed]]) {
    out2.push(`### ${title}`, '', HEAD);
    const base = eItems(set, 'TABAN');
    for (const n of eNames) out2.push(sline(n, eItems(set, n), n === 'TABAN' ? null : base));
    out2.push('');
  }
  out2.push('### Tetik istatistiği ve isabet (tüm dönem)', '', '| hücre | tetik | oran | çıkış↔tutsaydık farkı (aralık) | stopa gidecekti | kârla dönecekti | diğer (zararla bitti) |', '|---|---|---|---|---|---|---|');
  for (const n of eNames.slice(1)) {
    const T = E.filter((t) => t.early[n].trig);
    if (!T.length) { out2.push(`| ${n} | 0 | 0% | — | — | — | — |`); continue; }
    const dd = summary(T.map((t) => ({ tSig: t.tSig, net: t.early[n].net - t.base.net })));
    const st = T.filter((t) => t.base.exit === 'stop').length, pr = T.filter((t) => t.base.net > 0).length, ot = T.length - st - pr;
    out2.push(`| ${n} | ${T.length} | ${f(T.length / E.length * 100, 1)}% | ${f(dd.mean)} (${f(dd.lo)} … ${f(dd.hi)}) | ${st} (${f(st / T.length * 100, 0)}%) | ${pr} (${f(pr / T.length * 100, 0)}%) | ${ot} (${f(ot / T.length * 100, 0)}%) |`);
  }
  out2.push('', '### Takipçi: 1000 $, %5, 1x (tüm dönem)', '', '| hücre | son bakiye $ | en büyük düşüş % | en uzun kayıp serisi | ayda beklenen $ | en kötü ay $ |', '|---|---|---|---|---|---|');
  for (const n of eNames) { const it = eItems(E, n); const r = follower(it, { L: 1 }); const m = span(it); out2.push(`| ${n} | ${f(r.final, 0)} | ${f(r.dd, 1)} | ${r.longest} | ${f(m.expected, 1)} | ${f(m.worst, 1)} |`); }
  // AUC
  out2.push('', '### Ayırt edicilik (AUC; olumlu sınıf = TABAN\'da stopa giden)', '', 'Yalnız o ana kadarki veriyle; o saatte hâlâ açık olan işlemler. AUC 0.5 = ayırt etmez; 0.5\'in altı = ters yön.', '', '| özellik | saat | KEŞİF AUC (stop/diğer) | DOĞRULAMA AUC (stop/diğer) |', '|---|---|---|---|');
  const auc = (pos, neg) => { if (pos.length < 5 || neg.length < 5) return NaN; const all2 = [...pos.map((v) => [v, 1]), ...neg.map((v) => [v, 0])].sort((a, b) => a[0] - b[0]); let rs = 0, i = 0; while (i < all2.length) { let j = i; while (j + 1 < all2.length && all2[j + 1][0] === all2[i][0]) j++; const rank = (i + j) / 2 + 1; for (let m = i; m <= j; m++) if (all2[m][1]) rs += rank; i = j + 1; } return (rs - pos.length * (pos.length + 1) / 2) / (pos.length * neg.length); };
  for (const feat of ['dOI', 'dLS', 'taker', 'P', 'maxP']) for (const h of [1, 2, 4, 8]) {
    const g = (set) => { const a = set.filter((t) => t.auc?.[h] && Number.isFinite(t.auc[h][feat])); return { n: a.length, pos: a.filter((t) => t.base.exit === 'stop').map((t) => t.auc[h][feat]), neg: a.filter((t) => t.base.exit !== 'stop').map((t) => t.auc[h][feat]) }; };
    const a1 = g(Ek), a2 = g(Ed);
    out2.push(`| ${feat} | ${h} | ${f(auc(a1.pos, a1.neg), 3)} (${a1.pos.length}/${a1.neg.length}) | ${f(auc(a2.pos, a2.neg), 3)} (${a2.pos.length}/${a2.neg.length}) |`);
  }
  // decision
  out2.push('', '### Karar (protokol 6. bölüm)', '', '| hücre | DOĞRULAMA ort ≥ TABAN | en kötü %10 ≥ TABAN+5 | KEŞİF ≥ TABAN−0.1 ve DOĞRULAMA ≥ TABAN−0.1 | sonuç |', '|---|---|---|---|---|');
  const w10 = (set, n) => worst10(eItems(set, n).map((x) => x.net));
  for (const n of eNames.slice(1)) {
    const dd = mean(eItems(Ed, n).map((x) => x.net)), kk = mean(eItems(Ek, n).map((x) => x.net));
    const c1 = dd >= tDog.mean, c2 = w10(Ed, n) >= w10(Ed, 'TABAN') + 5, c3 = kk >= tKes.mean - 0.1 && dd >= tDog.mean - 0.1;
    let res = c1 && c2 && c3 ? 'ÖNERİLİR (20 canlı tetikle doğrulanmadan kanala "ÇIK" gönderilmez)' : 'önerilmez';
    if (n.startsWith('Y') && dd < tDog.mean) res = 'risk tercihi (ortalamayı düşürüyor, önerilmez)';
    out2.push(`| ${n} | ${c1 ? 'evet' : 'hayır'} (${f(dd)} vs ${f(tDog.mean)}) | ${c2 ? 'evet' : 'hayır'} (${f(w10(Ed, n))} vs ${f(w10(Ed, 'TABAN'))}) | ${c3 ? 'evet' : 'hayır'} | ${res} |`);
  }
  out2.push('');
}
out1.push('## Tek satır özet', '', ...oneLines, '');
fs.writeFileSync(path.join(HERE, '..', '..', 'docs', 'v1-tp-rapor.md'), out1.join('\n') + '\n');
fs.writeFileSync(path.join(HERE, '..', '..', 'docs', 'stop-ayir-rapor.md'), out2.join('\n') + '\n');
log('reports written');
