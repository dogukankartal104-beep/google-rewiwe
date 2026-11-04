#!/usr/bin/env node
// docs/v1k-teyit-protokol.md EK-1: v1p only when no v1k (K1) position is open.  node bt/v1/teyit2.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summary, follower, monthly, f, mean } from '../analiz/analyses.js';
import { benjaminiHochberg, pValueMeanPositive } from '../stats.js';
import { FILTER_OI15 } from './engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url)), OUT = path.join(HERE, '..', 'out', 'v1');
const DAY = 864e5, SPLIT = Date.UTC(2026, 2, 2);
const rd = (f2) => fs.readFileSync(path.join(OUT, f2), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && !r.coinDone && !r.fail);
const C = rd('combo.jsonl').sort((a, b) => a.tSig - b.tSig), R = rd('teyit.jsonl').sort((a, b) => a.tSig - b.tSig);
const k1 = C.filter((t) => Number.isFinite(t.oi15) && t.oi15 <= FILTER_OI15).map((t) => ({ t, v: t.cells.K1.nets[0] })).filter((x) => Number.isFinite(x.v))
  .map((x) => ({ tSig: x.t.tSig, tS: x.t.tSig, net: x.v, tEntry: x.t.cells.K1.tf ?? x.t.tSig, tExit: x.t.cells.K1.te ?? x.t.tSig + DAY, liq: { 1: false }, s: x.t.s }));
const open1 = (t) => k1.some((p) => p.tEntry <= t && t < p.tExit);
const dK1 = k1.filter((x) => x.tSig >= SPLIT), k1Alone = follower(dK1, { L: 1, maxOpen: 3 });
const items = (c, di = 0) => R.map((t) => ({ t, v: t.cells[c].nets[di] })).filter((x) => Number.isFinite(x.v)).map((x) => ({ tSig: x.t.tSig, tS: x.t.tSig, net: x.v, tEntry: x.t.cells[c].tf ?? x.t.tSig, tExit: x.t.cells[c].te ?? x.t.tSig + DAY, liq: { 1: false }, s: x.t.s }));
const L = ['# v1p yalnız hiçbir v1k pozisyonu açık değilken (EK-1)', '', `Oluşturuldu: ${new Date().toISOString()} · \`docs/v1k-teyit-protokol.md\` EK-1 (sonuçtan önce yazıldı). v1k K1 DOĞRULAMA tek başına (aynı anda en çok 3): bakiye ${f(k1Alone.final, 0)}, getiri ${f(k1Alone.ret, 0)}%, düşüş ${f(k1Alone.dd, 1)}%.`, '',
  '| hücre | kabul edilen / toplam (DOĞRULAMA) | ort | ortanca | kazanma | %90 aralık | 15 dk gecikme ort | birleşik getiri % / düşüş % | ayda $ / en kötü ay $ |', '|---|---|---|---|---|---|---|---|---|'];
const names = ['P1', 'P2', 'P1F', 'P2F'], res = {};
for (const c of names) {
  const all = items(c), acc = all.filter((x) => !open1(x.tEntry)), d = acc.filter((x) => x.tSig >= SPLIT), dAll = all.filter((x) => x.tSig >= SPLIT);
  const sd = summary(d), half = Math.floor(d.length / 2), h1 = mean(d.slice(0, half).map((x) => x.net)), h2 = mean(d.slice(half).map((x) => x.net));
  const acc15 = items(c, 1).filter((x) => x.tSig >= SPLIT && !open1(x.tEntry)), d15 = mean(acc15.map((x) => x.net));
  const comb = follower([...dK1, ...d], { L: 1, maxOpen: 3 }), mo = monthly(comb.byMonth, Math.min(...[...dK1, ...d].map((x) => x.tEntry)), Math.max(...[...dK1, ...d].map((x) => x.tExit)));
  res[c] = { d, sd, h1, h2, d15, comb };
  L.push(`| ${c} | ${d.length} / ${dAll.length} | ${f(sd.mean)} | ${f(sd.median)} | ${f(sd.win, 0)}% | ${f(sd.lo)} … ${f(sd.hi)} | ${f(d15)} | ${f(comb.ret, 0)} / ${f(comb.dd, 1)} | ${f(mo.expected, 1)} / ${f(mo.worst, 1)} |`);
}
const pv = names.map((c) => (res[c].d.length >= 20 ? pValueMeanPositive(res[c].d, (x) => x.net, 800) : 1)), bh = benjaminiHochberg(pv, 0.10);
L.push('', '## Geçme şartları (EK-1)', '', '| hücre | n ≥ 60 | ort > 0 | %90 alt > 0 | iki yarı > 0 | 15 dk gecikme > 0 | birleşik getiri > K1 tek başına ve düşüş ≤ %30 | BH (ort > 0) | sonuç |', '|---|---|---|---|---|---|---|---|---|');
const passed = [];
names.forEach((c, i) => { const r = res[c], cs = [r.d.length >= 60, r.sd.mean > 0, r.sd.lo > 0, r.h1 > 0 && r.h2 > 0, r.d15 > 0, r.comb.ret > k1Alone.ret && r.comb.dd >= -30]; const ok = cs.every(Boolean); if (ok) passed.push(c); L.push(`| ${c} | ${cs.map((v) => (v ? 'evet' : 'hayır')).join(' | ')} | ${bh[i] ? 'evet' : 'hayır'} | ${ok ? '**GEÇTİ**' : 'geçmedi'} |`); });
const chosen = names.find((c) => passed.includes(c));
L.push('', chosen ? `**Sonuç: ${chosen} (v1k pozisyonu açıkken atlanarak) ikinci motor olabilir. Geçenler: ${passed.join(', ')}.${bh[names.indexOf(chosen)] ? '' : ' Çoklu test düzeltmesinden geçmedi: şansa bağlı olabilir.'}**` : '**Sonuç: hiçbir hücre geçmedi; v1p yayına alınmaz.**', '');
fs.writeFileSync(path.join(HERE, '..', '..', 'docs', 'v1k-teyit-ek1-rapor.md'), L.join('\n') + '\n');
console.log(L.join('\n'));
