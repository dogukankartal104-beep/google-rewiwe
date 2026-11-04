#!/usr/bin/env node
// docs/v1k-stop-protokol.md → docs/v1k-stop-rapor.md.   node --max-old-space-size=6144 bt/v1/stopgrid.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { csvText, parseMetrics, metricsDaily, dayKey } from '../archive.js';
import { minuteBars, fundingOf } from '../analiz/data.js';
import { summary, cooldown, follower, monthly, f, mean } from '../analiz/analyses.js';
import { benjaminiHochberg, pValueMeanPositive } from '../stats.js';
import { simulateParts, earlyClose, checkEvents, firstTrigger, CELLS_EARLY, TP_CELLS } from './sim.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'out', 'v1');
const MIN = 6e4, DAY = 864e5;
const STOPS = [20, 30, 40, 50];
const STRUCT = ['X0', 'T15', 'T20', 'M1a', 'M1b', 'M2a', 'M2b', 'M3a', 'M3b', 'O1', 'L1'];
const DELAYS = [0, 5, 15];
const PARTS = { X0: { parts: [{ frac: 1, tp: null }] }, T15: TP_CELLS.T15, T20: TP_CELLS.T20, M1a: TP_CELLS.M1a, M1b: TP_CELLS.M1b, M2a: TP_CELLS.M2a, M2b: TP_CELLS.M2b, M3a: TP_CELLS.M3a, M3b: TP_CELLS.M3b };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const metricsCache = new Map();
async function metricsRecs(sym, fromMs, toMs) {
  const out = [];
  for (let d = Math.floor(fromMs / DAY) * DAY; d <= toMs; d += DAY) {
    const key = sym + '|' + dayKey(d);
    let r = metricsCache.get(key);
    if (r === undefined) { const t = await csvText(metricsDaily(sym, dayKey(d))).catch(() => null); r = t ? parseMetrics(t) : null; metricsCache.set(key, r); if (metricsCache.size > 2000) metricsCache.delete(metricsCache.keys().next().value); }
    if (r) out.push(...r);
  }
  return out.sort((a, b) => a.t - b.t);
}

/* ---- the v1k trade set: the same records as the v1 run ---- */
const recs = fs.readFileSync(path.join(OUT, 'records.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const sigs = cooldown(recs.filter((r) => !r.fail && r.v1k && r.tp?.TABAN), 4).sort((a, b) => a.tSig - b.tSig);
log('v1k signals', sigs.length);

const cacheFile = path.join(OUT, 'stopgrid.jsonl');
const done = new Map();
if (fs.existsSync(cacheFile)) for (const l of fs.readFileSync(cacheFile, 'utf8').split('\n')) { if (!l) continue; try { const r = JSON.parse(l); done.set(r.key, r); } catch { /* torn line */ } }

async function build(r) {
  const { k } = await minuteBars(r.s, r.tSig - 61 * MIN, r.tSig + DAY + 95 * MIN);
  const i0 = k.findIndex((x) => x.t === r.tSig);
  if (i0 < 60) return { key: r.key, tSig: r.tSig, s: r.s, fail: 'no 1m data' };
  const funding = await fundingOf(r.s, r.tSig, r.tSig + DAY + 3600e3);
  const recsM = await metricsRecs(r.s, r.tSig - DAY, r.tSig + DAY);
  const cells = {};
  for (const stop of STOPS) {
    for (const st of STRUCT) {
      const nets = [], meta = {};
      for (const d of DELAYS) {
        const ie = i0 + d;
        if (st === 'O1' || st === 'L1') {
          const base = simulateParts({ k, i0: ie, parts: PARTS.X0.parts, stopPct: stop, funding });
          if (!base.ok) { nets.push(null); continue; }
          const ce = checkEvents({ k, i0: ie, recs: recsM, baseExitT: base.tExit, volume24: r.vol });
          let net = base.net, te = base.tExit;
          if (ce.ok) {
            const x = firstTrigger(ce, CELLS_EARLY[st], k, ie);
            if (x) { const ec = earlyClose({ k, i0: ie, jx: x.jx, funding }); net = ec.net; te = ec.t; }
          } else if (d === 0) meta.noMetrics = true;
          nets.push(net); if (d === 0) { meta.te = te; meta.x = base.exit; }
        } else {
          const c = PARTS[st];
          const s = simulateParts({ k, i0: ie, parts: c.parts, stopPct: stop, be: !!c.be, funding });
          nets.push(s.ok ? s.net : null);
          if (d === 0 && s.ok) { meta.te = s.tExit; meta.x = s.exit; }
        }
      }
      cells[`S${stop}|${st}`] = { nets, ...meta };
    }
  }
  return { key: r.key, tSig: r.tSig, s: r.s, cells };
}

const todo = sigs.filter((r) => !done.has(r.key));
log('to simulate', todo.length, 'cached', done.size);
const fd = fs.openSync(cacheFile, 'a');
let n = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (todo.length) {
    const r = todo.shift();
    let o; try { o = await build(r); } catch (e) { o = { key: r.key, tSig: r.tSig, s: r.s, fail: 'error: ' + e.message }; }
    fs.writeSync(fd, JSON.stringify(o) + '\n'); done.set(o.key, o);
    if (++n % 100 === 0) log(`simulated ${n}`);
  }
}));
fs.closeSync(fd);

/* ---------------- report ---------------- */
const all = sigs.map((r) => done.get(r.key)).filter((r) => r && !r.fail);
const failed = sigs.length - all.length;
const cut = Math.floor(all.length * 0.6);
const kes = all.slice(0, cut), dog = all.slice(cut);
const names = []; for (const s of STOPS) for (const st of STRUCT) names.push(`S${s}|${st}`);
const valid = (t) => names.every((c) => Number.isFinite(t.cells[c]?.nets?.[0]));
const common = all.filter(valid);
const nExcl = all.length - common.length;
const items = (set, c, d = 0) => set.map((t) => ({ tSig: t.tSig, tS: t.tSig, net: t.cells[c].nets[DELAYS.indexOf(d)], tEntry: t.tSig, tExit: t.cells[c].te, liq: { 1: false } })).filter((x) => Number.isFinite(x.net));
const kV = common.filter((t) => kes.includes(t)), dV = common.filter((t) => dog.includes(t));
const worst10 = (a) => { const s = [...a].sort((x, y) => x - y); return mean(s.slice(0, Math.max(1, Math.ceil(s.length * 0.1)))); };
const BASE = 'S50|X0';

const L = ['# v1k SHORT: daha sıkı stop, TP kademeleri ve işlem-içi göstergeler raporu', '', `Oluşturuldu: ${new Date().toISOString()} · protokol: \`docs/v1k-stop-protokol.md\` (sonuçlardan önce commit'lendi).`, '',
  `Kapsam: v1k sinyali ${sigs.length}, simülasyonu tamamlanamayan ${failed}, bir hücrenin yolu eksik olduğu için dışarıda bırakılan ${nExcl}; tablolar ortak kümede (n=${common.length}, KEŞİF ${kV.length}, DOĞRULAMA ${dV.length}; bölme tarihi ${dV[0] ? new Date(dV[0].tSig).toISOString().slice(0, 10) : '—'}).`,
  '**Sınırlılık:** DOĞRULAMA yalnız son dönemi (tek rejim) kapsıyor. 44 hücre denendiği için şans payı yüksektir.', ''];

// DOĞRULAMA vs baseline with BH
const dBase = items(dV, BASE);
const rows = names.map((c) => {
  const k1 = items(kV, c), d1 = items(dV, c);
  const diff = d1.map((x, i) => ({ tSig: x.tSig, tS: x.tSig, net: x.net - dBase[i].net }));
  return { c, nk: k1.length, mk: mean(k1.map((x) => x.net)), nd: d1.length, md: mean(d1.map((x) => x.net)), diff: mean(diff.map((x) => x.net)), p: c === BASE ? 1 : pValueMeanPositive(diff, (x) => x.net, 600) };
});
const sig = benjaminiHochberg(rows.map((r) => r.p), 0.10);
rows.forEach((r, i) => { r.bh = sig[i] && r.c !== BASE; });
L.push('## Tüm hücreler (net %, masraf ve funding dahil)', '', '| hücre | KEŞİF ort (n) | DOĞRULAMA ort (n) | DOĞRULAMA − TABAN | BH q=0.10 |', '|---|---|---|---|---|');
for (const r of rows) L.push(`| ${r.c}${r.c === BASE ? ' (TABAN)' : ''} | ${f(r.mk)} (${r.nk}) | ${f(r.md)} (${r.nd}) | ${f(r.diff)} | ${r.bh ? 'evet' : 'hayır'} |`);

// candidates: top 3 by KEŞİF mean, at least 200 completed trades
const need = Math.min(200, Math.floor(kV.length * 0.8));
const cands = rows.filter((r) => r.c !== BASE && r.nk >= need).sort((a, b) => b.mk - a.mk).slice(0, 3);
L.push('', `## Adaylar (KEŞİF ortalaması en yüksek 3 hücre, en az ${need} işlem)`, '');
const verdicts = [];
for (const cr of cands) {
  const c = cr.c, dI = items(dV, c), s = summary(dI), half = Math.floor(dI.length / 2);
  const m1 = mean(dI.slice(0, half).map((x) => x.net)), m2 = mean(dI.slice(half).map((x) => x.net));
  const fol2 = follower(dI, { L: 1, perDay: 2 }), fol3 = follower(dI, { L: 1, maxOpen: 3 }), folU = follower(dI, { L: 1 });
  const d15 = mean(items(dV, c, 15).map((x) => x.net));
  const conds = [
    ['DOĞRULAMA ort > 0', s.mean > 0, f(s.mean)],
    ['%90 alt > 0', s.lo > 0, `${f(s.lo)} … ${f(s.hi)}`],
    ['TABAN\'dan ≥ 0.3 yüksek', cr.diff >= 0.3, f(cr.diff)],
    ['günde en çok 2: getiri > 0 ve düşüş ≤ %30', fol2.ret > 0 && fol2.dd >= -30, `getiri ${f(fol2.ret, 0)}%, düşüş ${f(fol2.dd, 1)}%`],
    ['15 dk gecikmede ort > 0', d15 > 0, f(d15)],
    ['iki yarıda da ort > 0', m1 > 0 && m2 > 0, `${f(m1)} / ${f(m2)}`],
  ];
  const ok = conds.every(([, v]) => v);
  verdicts.push({ c, ok, bh: cr.bh });
  const span = (fo, it) => monthly(fo.byMonth, Math.min(...it.map((x) => x.tEntry)), Math.max(...it.map((x) => x.tExit)));
  const mo2 = span(fol2, dI);
  L.push(`### ${c}`, '', `KEŞİF ort ${f(cr.mk)} (n=${cr.nk}); DOĞRULAMA n=${s.n} ort ${f(s.mean)}, ortanca ${f(s.median)}, kazanma ${f(s.win, 0)}%, en kötü ${f(s.worst, 1)}, en kötü %10 ${f(worst10(dI.map((x) => x.net)))}.`, '',
    '| şart | sonuç | değer |', '|---|---|---|', ...conds.map(([n2, v, val]) => `| ${n2} | ${v ? 'TUTTU' : 'TUTMADI'} | ${val} |`), '',
    `Takipçi (1000 $, %5, 1x, DOĞRULAMA): sınırsız bakiye ${f(folU.final, 0)} (düşüş ${f(folU.dd, 1)}%), günde en çok 2 → ${f(fol2.final, 0)} (düşüş ${f(fol2.dd, 1)}%, en uzun kayıp ${fol2.longest}), aynı anda en çok 3 → ${f(fol3.final, 0)} (düşüş ${f(fol3.dd, 1)}%). Günde en çok 2 ile ayda beklenen ${f(mo2.expected, 1)} $, en kötü ay ${f(mo2.worst, 1)} $.`,
    `Çoklu test (BH q=0.10): ${cr.bh ? 'düzeltmeden de geçti' : '**düzeltmeden geçmedi: şansa bağlı olabilir**'}.`, `**${ok ? 'ÖNERİLİR (30 canlı kâğıt sinyalle doğrulama şartıyla)' : 'ÖNERİLMEZ'}**`, '');
  const yrs = [...new Set(common.map((t) => new Date(t.tSig).getUTCFullYear()))].sort();
  L.push('Yıl yıl ortalama % (n): ' + yrs.map((y) => { const it = items(common.filter((t) => new Date(t.tSig).getUTCFullYear() === y), c); return `${y}: ${f(mean(it.map((x) => x.net)))} (${it.length})`; }).join(' · '), '');
}
// baseline for reference
const fb = follower(items(dV, BASE), { L: 1, perDay: 2 });
const bs = summary(items(dV, BASE));
L.push('## TABAN (stop %50, hedef yok), DOĞRULAMA', '', `n=${bs.n} ort ${f(bs.mean)}, ortanca ${f(bs.median)}, %90 aralık ${f(bs.lo)} … ${f(bs.hi)}; günde en çok 2 ile bakiye ${f(fb.final, 0)} (düşüş ${f(fb.dd, 1)}%).`, '');
const winners = verdicts.filter((v) => v.ok);
L.push('## Sonuç', '', winners.length ? `Tutan aday(lar): ${winners.map((v) => v.c + (v.bh ? '' : ' (BH düzeltmesinden geçmedi)')).join(', ')}.` : '**Hiçbir aday koşulları sağlamadı: stop/TP/gösterge değişikliği v1k\'yı iyileştirmiyor, taban kalır.**', '');
const pick = winners[0]?.c || BASE, pickIt = items(dV, pick), pf = follower(pickIt, { L: 1, perDay: 2 });
const pm = monthly(pf.byMonth, Math.min(...pickIt.map((x) => x.tEntry)), Math.max(...pickIt.map((x) => x.tExit)));
L.push(`Tek satır: ${pick === BASE ? 'TABAN (değişiklik önerilmedi)' : pick} için 1000 $, %5, 1x, günde en çok 2 ile ayda beklenen ${f(pm.expected, 1)} $, en kötü ay ${f(pm.worst, 1)} $ (DOĞRULAMA dönemi, ${pm.months} ay).`, '');
fs.writeFileSync(path.join(HERE, '..', '..', 'docs', 'v1k-stop-rapor.md'), L.join('\n') + '\n');
log('report written');
