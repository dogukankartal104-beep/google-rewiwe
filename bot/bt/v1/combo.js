#!/usr/bin/env node
// docs/v1k-motor-protokol.md → docs/v1k-motor-rapor.md.   node --max-old-space-size=6144 bt/v1/combo.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { csvText, parseMetrics, metricsDaily, dayKey } from '../archive.js';
import { minuteBars, fundingOf } from '../analiz/data.js';
import { summary, follower, monthly, f, mean } from '../analiz/analyses.js';
import { benjaminiHochberg, pValueMeanPositive } from '../stats.js';
import { simulateParts, earlyClose, checkEvents, firstTrigger, CELLS_EARLY } from './sim.js';
import { engineEntry, FILTER_OI15 } from './engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'out', 'v1');
const MIN = 6e4, M15 = 9e5, DAY = 864e5;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const CELLS = {
  K0: { F: false, E1: false, O1: false }, K1: { F: true, E1: false, O1: false }, K2: { F: true, E1: false, O1: true },
  K3: { F: true, E1: true, O1: false }, K4: { F: true, E1: true, O1: true }, K5: { F: false, E1: true, O1: true },
};
const DELAYS = [0, 15];

const metricsCache = new Map();
async function recsM(sym, from, to) { const out = []; for (let d = Math.floor(from / DAY) * DAY; d <= to; d += DAY) { const key = sym + '|' + dayKey(d); let r = metricsCache.get(key); if (r === undefined) { const t = await csvText(metricsDaily(sym, dayKey(d))).catch(() => null); r = t ? parseMetrics(t) : null; metricsCache.set(key, r); if (metricsCache.size > 2000) metricsCache.delete(metricsCache.keys().next().value); } if (r) out.push(...r); } return out.sort((a, b) => a.t - b.t); }

const arge = fs.readFileSync(path.join(OUT, 'arge.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && !r.fail);
const recMap = new Map(fs.readFileSync(path.join(OUT, 'records.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).map((r) => [r.key, r]));
const sigs = arge.sort((a, b) => a.tSig - b.tSig).map((a) => ({ ...a, vol: recMap.get(a.key)?.vol, tbase: recMap.get(a.key)?.tp?.TABAN }));
log('signals', sigs.length);

const cacheFile = path.join(OUT, 'combo.jsonl');
const done = new Map();
if (fs.existsSync(cacheFile)) for (const l of fs.readFileSync(cacheFile, 'utf8').split('\n')) { if (!l) continue; try { const r = JSON.parse(l); done.set(r.key, r); } catch { /* torn */ } }

async function build(sg) {
  const { k } = await minuteBars(sg.s, sg.tSig - 61 * MIN, sg.tSig + DAY + 120 * MIN);
  const i0 = k.findIndex((x) => x.t === sg.tSig);
  if (i0 < 60) return { key: sg.key, tSig: sg.tSig, fail: 'no 1m data' };
  const funding = await fundingOf(sg.s, sg.tSig, sg.tSig + DAY + 3600e3);
  const recs = await recsM(sg.s, sg.tSig - DAY, sg.tSig + DAY);
  const out = { key: sg.key, tSig: sg.tSig, s: sg.s, oi15: sg.chg?.oi15, cells: {} };
  for (const [name, c] of Object.entries(CELLS)) {
    const nets = [], meta = {};
    for (const d of DELAYS) {
      const r = engineEntry({ k, i0, tSig: sg.tSig, funding, recs, vol: sg.vol, useE1: c.E1, useO1: c.O1, delayMin: d });
      nets.push(r.ok ? r.net : (r.skip ? 'skip' : null));
      if (d === 0 && r.ok) { meta.te = r.te; meta.tf = r.tEntry; meta.x = r.exit; }
    }
    out.cells[name] = { nets, ...meta };
  }
  return out;
}

const todo = sigs.filter((r) => !done.has(r.key));
log('to simulate', todo.length, 'cached', done.size);
const fd = fs.openSync(cacheFile, 'a');
let nb = 0;
await Promise.all(Array.from({ length: 6 }, async () => { while (todo.length) { const r = todo.shift(); let o; try { o = await build(r); } catch (e) { o = { key: r.key, tSig: r.tSig, fail: 'error: ' + e.message }; } fs.writeSync(fd, JSON.stringify(o) + '\n'); done.set(o.key, o); if (++nb % 100 === 0) log(`built ${nb}`); } }));
fs.closeSync(fd);

/* ---------------- report ---------------- */
const all = sigs.map((s) => done.get(s.key)).filter((r) => r && !r.fail);
const cut = Math.floor(all.length * 0.6);
const kes = all.slice(0, cut), dog = all.slice(cut);
const pass = (t, c) => (c.F ? Number.isFinite(t.oi15) && t.oi15 <= FILTER_OI15 : true);
const items = (set, cell, di = 0) => set.filter((t) => pass(t, CELLS[cell])).map((t) => ({ t, v: t.cells[cell].nets[di] })).filter((x) => Number.isFinite(x.v)).map((x) => ({ tSig: x.t.tSig, tS: x.t.tSig, net: x.v, tEntry: x.t.cells[cell].tf ?? x.t.tSig, tExit: x.t.cells[cell].te ?? x.t.tSig + DAY, liq: { 1: false } }));
const worst10 = (a) => { const s = [...a].sort((x, y) => x - y); return mean(s.slice(0, Math.max(1, Math.ceil(s.length * 0.1)))); };
const L = ['# v1k motoru: birleşik kuralın sınavı', '', `Oluşturuldu: ${new Date().toISOString()} · protokol: \`docs/v1k-motor-protokol.md\` (sonuçlardan önce commit'lendi). Sinyaller Finora kuralının Binance ikizi değil, v1k kuralıdır (24s ≥ %50, BTC 24s ≤ −%1).`, '',
  `Kapsam: ${sigs.length} sinyal, simülasyonu tamamlanamayan ${sigs.length - all.length}; KEŞİF ${kes.length}, DOĞRULAMA ${dog.length} (bölme ${dog[0] ? new Date(dog[0].tSig).toISOString().slice(0, 10) : '—'}). OI verisi olmayan sinyal sayısı: ${all.filter((t) => !Number.isFinite(t.oi15)).length}. Filtre eşiği: son 15 dk OI artışı ≤ %${FILTER_OI15}.`, ''];
const k0d = items(dog, 'K0'), k0k = items(kes, 'K0');
const m0d = mean(k0d.map((x) => x.net)), m0k = mean(k0k.map((x) => x.net));
L.push('## Hücreler', '', '| hücre | KEŞİF n / ort | DOĞRULAMA n | ort | ortanca | kazanma | en kötü | en kötü %10 | %90 aralık | K0\'a fark | $/işlem (1000 $, %5) |', '|---|---|---|---|---|---|---|---|---|---|---|');
const pv = [], res = {};
for (const c of Object.keys(CELLS)) {
  const ik = items(kes, c), id = items(dog, c), s = summary(id), sk = summary(ik);
  const diff = s.mean - m0d;
  res[c] = { ik, id, s, sk, diff };
  pv.push(c === 'K0' ? 1 : (() => { const cen = id.map((x) => ({ ...x, net: x.net - m0d })); return id.length >= 20 ? pValueMeanPositive(cen, (x) => x.net, 800) : 1; })());
  L.push(`| ${c}${c === 'K4' ? ' (MOTOR)' : c === 'K0' ? ' (TABAN)' : ''} | ${sk.n} / ${f(sk.mean)} | ${s.n} | ${f(s.mean)} | ${f(s.median)} | ${f(s.win, 0)}% | ${f(s.worst, 1)} | ${f(worst10(id.map((x) => x.net)))} | ${f(s.lo)} … ${f(s.hi)} | ${f(diff)} | ${f(s.mean * 0.5, 2)} |`);
}
const bh = benjaminiHochberg(pv, 0.10);
const names = Object.keys(CELLS);
L.push('', '## Takipçi: 1000 $, işlem başına bakiyenin %5\'i, 1x (DOĞRULAMA)', '', '| hücre | kural | alınan | bakiye $ | getiri % | en büyük düşüş % | en uzun kayıp | ayda beklenen $ | en kötü ay $ |', '|---|---|---|---|---|---|---|---|---|');
const folRes = {};
for (const c of names) for (const [nm, opt] of [['günde en çok 2', { perDay: 2 }], ['aynı anda en çok 3', { maxOpen: 3 }]]) {
  const it = res[c].id; if (!it.length) continue;
  const fo = follower(it, { L: 1, ...opt }), m = monthly(fo.byMonth, Math.min(...it.map((x) => x.tEntry)), Math.max(...it.map((x) => x.tExit)));
  folRes[c + nm] = { fo, m };
  L.push(`| ${c} | ${nm} | ${fo.taken} | ${f(fo.final, 0)} | ${f(fo.ret, 0)} | ${f(fo.dd, 1)} | ${fo.longest} | ${f(m.expected, 1)} | ${f(m.worst, 1)} |`);
}
L.push('', '## Yıl yıl ortalama % (n)', '', '| hücre | ' + [...new Set(all.map((t) => new Date(t.tSig).getUTCFullYear()))].sort().join(' | ') + ' |', '|---|' + [...new Set(all.map((t) => new Date(t.tSig).getUTCFullYear()))].sort().map(() => '---').join('|') + '|');
const yrs = [...new Set(all.map((t) => new Date(t.tSig).getUTCFullYear()))].sort();
for (const c of names) L.push(`| ${c} | ` + yrs.map((y) => { const it = items(all.filter((t) => new Date(t.tSig).getUTCFullYear() === y), c); return it.length ? `${f(mean(it.map((x) => x.net)))} (${it.length})` : '—'; }).join(' | ') + ' |');
L.push('', '## Geçme şartları (protokol 4. bölüm)', '', '| hücre | n ≥ 100 | ort ≥ K0+0.5 | %90 alt > 0 | iki yarı > 0 | KEŞİF ≥ K0 KEŞİF | günde 2: getiri > 0 ve düşüş ≤ %30 | 15 dk gecikme > 0 | BH | sonuç |', '|---|---|---|---|---|---|---|---|---|---|');
const passed = [];
names.forEach((c, i) => {
  if (c === 'K0') return;
  const r = res[c], id = r.id, half = Math.floor(id.length / 2);
  const h1 = mean(id.slice(0, half).map((x) => x.net)), h2 = mean(id.slice(half).map((x) => x.net));
  const fo2 = folRes[c + 'günde en çok 2']?.fo;
  const d15 = mean(items(dog, c, 1).map((x) => x.net));
  const cs = [id.length >= 100, r.s.mean >= m0d + 0.5, r.s.lo > 0, h1 > 0 && h2 > 0, r.sk.mean >= m0k, !!fo2 && fo2.ret > 0 && fo2.dd >= -30, d15 > 0, bh[i]];
  const ok = cs.slice(0, 7).every(Boolean);
  if (ok) passed.push(c);
  L.push(`| ${c} | ${cs.slice(0, 7).map((v, j) => (v ? 'evet' : 'hayır') + (j === 1 ? ` (${f(r.s.mean)} vs ${f(m0d)})` : j === 3 ? ` (${f(h1)}/${f(h2)})` : j === 4 ? ` (${f(r.sk.mean)} vs ${f(m0k)})` : j === 6 ? ` (${f(d15)})` : '')).join(' | ')} | ${cs[7] ? 'evet' : 'hayır'} | ${ok ? '**GEÇTİ**' : 'geçmedi'} |`);
});
const comp = { K1: 1, K3: 2, K2: 2, K4: 3, K5: 2 };
const chosen = passed.sort((a, b) => comp[a] - comp[b])[0];
L.push('', '## Sonuç', '', chosen ? `**Geçen hücre(ler): ${passed.join(', ')}; en sade: ${chosen}.** Yayından önce 30 canlı kâğıt sinyal karnesi şart.${passed.includes('K4') ? '' : ' K4 (tam motor) geçmedi: motor gölgede izlenir, öneri olmaz.'}` : '**Hiçbir hücre geçme şartlarını sağlamadı: birleşik kural kanıtlanmadı. Tüm varyantlar gölgede izlenir, öneri yok.**', '');
const pick = chosen || 'K4', pr = folRes[pick + 'günde en çok 2'];
if (pr) L.push(`Tek satır: ${pick} için 1000 $, %5, 1x, günde en çok 2 ile ayda beklenen ${f(pr.m.expected, 1)} $, en kötü ay ${f(pr.m.worst, 1)} $ (DOĞRULAMA, ${pr.m.months} ay); işlem başı ortalama net ${f(res[pick].s.mean)}% (= ${f(res[pick].s.mean * 0.5, 2)} $ / işlem).`, '');
fs.writeFileSync(path.join(HERE, '..', '..', 'docs', 'v1k-motor-rapor.md'), L.join('\n') + '\n');
log('report written');
