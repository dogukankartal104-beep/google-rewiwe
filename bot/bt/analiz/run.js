#!/usr/bin/env node
// docs/analiz-protokol.md → docs/analiz-rapor.md.  node --max-old-space-size=6144 bt/analiz/run.js [--from 2022-01-01] [--limit N]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSymbols, loadKlines, stats as dl } from '../archive.js';
import { scanSymbol, monthRanks, prevMonth } from './scan.js';
import { buildV1k, buildG1, DELAYS, periodOf } from './trades.js';
import { summary, row, TABLE_HEAD, cooldown, follower, monthly, ci90, f, mean, median, pctRank } from './analyses.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const FROM = Date.parse(arg('from', '2022-01-01') + 'T00:00:00Z');
const TO = Date.now() - 2 * 864e5 > 0 ? new Date(new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10) + 'T00:00:00Z').getTime() : 0;
const cacheFile = path.join(HERE, '..', 'out', 'analiz-trades.json');
fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
const PER = ['KESIF', 'DOGRULAMA', 'SON'];
const VS = (r) => r.period === 'DOGRULAMA' || r.period === 'SON';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ---------------- data ---------------- */
let V = null, G = null, cov = null;
if (fs.existsSync(cacheFile) && process.argv.includes('--cached')) {
  ({ V, G, cov } = JSON.parse(fs.readFileSync(cacheFile, 'utf8')));
} else {
  let syms = await listSymbols();
  if (arg('limit')) syms = syms.slice(0, Number(arg('limit')));
  log('universe', syms.length);
  const { k: bk } = await loadKlines('BTCUSDT', '15m', FROM - 5 * 864e5, TO);
  const btc = { k: bk, idx: new Map(bk.map((x, i) => [x.t, i])) };
  const scans = []; let n = 0;
  const q = [...syms];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (q.length) {
      const s = q.shift();
      try { scans.push(await scanSymbol(s, FROM, TO, btc)); } catch (e) { scans.push({ sym: s, err: e.message, v1k: [], g1: [], monthVol: new Map(), daily: [], cov: {} }); }
      if (++n % 50 === 0) log(`scan ${n}/${syms.length}`);
    }
  }));
  scans.byName = new Map(scans.map((s) => [s.sym, s]));
  const ranks = monthRanks(scans);
  const v1kC = scans.flatMap((s) => s.v1k), g1C = scans.flatMap((s) => s.g1);
  cov = {
    symbols: syms.length, withData: scans.filter((s) => s.cov.bars15 > 200).length, errors: scans.filter((s) => s.err).map((s) => `${s.sym}: ${s.err}`).slice(0, 10),
    v1kCandidates: v1kC.length, g1Candidates: g1C.length, download: { fetched: dl.fetched, cached: dl.cached, notFound: dl.notFound, errorCount: dl.errorCount || 0, first: dl.errors[0] || null },
  };
  log(`candidates: v1k ${v1kC.length}, g1 ${g1C.length}`);
  V = await buildV1k(v1kC, scans, ranks, (d, t) => { if (d % 100 === 0) log(`v1k trades ${d}/${t}`); });
  G = await buildG1(g1C, scans, ranks, (d, t) => { if (d % 200 === 0) log(`g1 trades ${d}/${t}`); });
  fs.writeFileSync(cacheFile, JSON.stringify({ V, G, cov }));
}
const vOk = V.filter((x) => x.ok), vFail = V.filter((x) => !x.ok);
const gOk = G.filter((x) => x.none?.ok), gFail = G.filter((x) => !x.none?.ok);
const failWhy = (a) => { const m = {}; a.forEach((x) => { const w = x.fail || x.err || 'other'; m[w] = (m[w] || 0) + 1; }); return Object.entries(m).map(([k, v]) => `${k}: ${v}`).join(', ') || '—'; };

/* ---------------- cell definitions ---------------- */
const v1kCell = (chg, btc) => cooldown(vOk.filter((x) => x.chg24 >= chg && x.btc24 <= btc), 4);
// flatten a G1 record into a trade for one stop variant
const g1Trades = (ver, drop, stop) => G.filter((x) => x.none?.ok && x.ret <= drop && (ver === 'S' ? x.rankS <= 50 : x.rankD <= 50) && x[stop]?.ok)
  .map((x) => ({ ...x, ...x[stop], tSig: x.tSig, delays: x[stop].delays, s: x.s }));
const trades = (arr) => arr.map((x) => ({ ...x, net: x.net }));

/* ---------------- one engine, ten analyses ---------------- */
function analyse(name, T, o) {
  const L = [];
  const H = (t) => L.push('', `#### ${t}`, '');
  L.push(`### ${name}`, '', `Kural: ${o.rule}`, `n (tüm dönemler) = ${T.length}`);
  // 1
  H('1. Yeniden üretim');
  L.push(TABLE_HEAD, row('tüm dönemler', summary(T)), row('DOĞRULAMA+SON', summary(T.filter(VS))), '', `İddia: ${o.claim}`, o.diff);
  // 2
  H('2. Dönem kırılımı');
  L.push(TABLE_HEAD); for (const p of PER) L.push(row(p, summary(T.filter((x) => x.period === p))));
  const yrs = [...new Set(T.map((x) => new Date(x.tSig).getUTCFullYear()))].sort();
  for (const y of yrs) L.push(row(String(y), summary(T.filter((x) => new Date(x.tSig).getUTCFullYear() === y))));
  const qs = [...new Set(T.map((x) => { const d = new Date(x.tSig); return `${d.getUTCFullYear()}Ç${Math.floor(d.getUTCMonth() / 3) + 1}`; }))].sort();
  L.push('', 'Çeyrekler:', '', TABLE_HEAD);
  for (const qk of qs) L.push(row(qk, summary(T.filter((x) => { const d = new Date(x.tSig); return `${d.getUTCFullYear()}Ç${Math.floor(d.getUTCMonth() / 3) + 1}` === qk; }))));
  // 3
  H('3. Sağlamlık');
  const vs = T.filter(VS), sv = summary(vs);
  L.push(`DOĞRULAMA+SON (n=${sv.n}): ortalama ${f(sv.mean)}%, %90 aralık ${f(sv.lo)} … ${f(sv.hi)}, en iyi 5 hariç ${f(sv.exTop5)}%, en çok kâr eden günün toplam kârdaki payı ${f(sv.dayShare, 0)}% (≤ %20 beklenir).`);
  // 4
  H('4. Plasebo ve piyasa fazlası (DOĞRULAMA+SON)');
  for (const p of ['p3', 'p14']) {
    const pr = vs.filter((x) => Number.isFinite(x[p])).map((x) => ({ ...x, d: x.net - x[p] }));
    const sd = summary(pr, (x) => x.d);
    L.push(`- ${p === 'p3' ? '3' : '14'} gün önceki aynı işlem (n=${pr.length}): plasebo ort ${f(mean(pr.map((x) => x[p])))}%, fark (sinyal − plasebo) ${f(sd.mean)}%, %90 aralık ${f(sd.lo)} … ${f(sd.hi)}`);
  }
  const bx = vs.filter((x) => Number.isFinite(x.basket)).map((x) => ({ ...x, d: x.net - x.basket }));
  const sb = summary(bx, (x) => x.d);
  L.push(`- Piyasa fazlası (işlem − aynı süredeki ilk-10 sepeti, saatlik çözünürlük; n=${bx.length}): sepet ort ${f(mean(bx.map((x) => x.basket)))}%, fazla ${f(sb.mean)}%, %90 aralık ${f(sb.lo)} … ${f(sb.hi)}`);
  // 5
  H('5. Eşik platosu (DOĞRULAMA+SON birleşik ortalama %, n)');
  L.push(o.plateau());
  // 6
  H('6. Gecikme (DOĞRULAMA+SON ortalama %, n)');
  L.push('| gecikme | ort % | n |', '|---|---|---|');
  const dm = {}; for (const d of DELAYS) { const v = vs.map((x) => x.delays?.[d]).filter(Number.isFinite); dm[d] = mean(v); L.push(`| ${d} dk | ${f(dm[d])} | ${v.length} |`); }
  const half = DELAYS.find((d) => d > 0 && dm[d] <= 0.5 * dm[0]);
  L.push('', dm[0] > 0 ? `Kenarın yarıya indiği ilk gecikme: ${half !== undefined ? half + ' dk' : '60 dk içinde inmiyor'}.` : 'Ortalama 0 dk gecikmede de pozitif değil; yarıya inme tanımsız.');
  // 7
  H('7. Stop, kaldıraç ve takipçi hesabı (DOĞRULAMA+SON)');
  for (const lev of [1, 2, 3]) { const liq = vs.filter((x) => x.liq?.[lev]).length; L.push(`- ${lev}x: tasfiye (stoptan önce ya da stop tasfiye seviyesinin ötesinde) ${liq}/${vs.length} işlem`); }
  L.push('', '| hesap (1000 $, sinyal başına %5) | bakiye $ | getiri % | en büyük düşüş % | en uzun kayıp serisi | tasfiye |', '|---|---|---|---|---|---|');
  const span = [Date.UTC(2024, 0, 1), TO];
  const fo = {};
  for (const lev of [1, 2]) { fo[lev] = follower(vs, { L: lev }); const r = fo[lev]; L.push(`| ${lev}x | ${f(r.final, 0)} | ${f(r.ret, 0)} | ${f(r.dd, 1)} | ${r.longest} | ${r.liqs} |`); }
  // 8
  H('8. Eşzamanlılık');
  const perDay = new Map(); T.forEach((x) => { const d = Math.floor(x.tSig / 864e5); perDay.set(d, (perDay.get(d) || 0) + 1); });
  const cnt = [...perDay.values()].sort((a, b) => a - b);
  L.push(`Sinyalli gün ${cnt.length}; günlük sinyal: ortanca ${median(cnt)}, en çok ${cnt[cnt.length - 1] ?? 0}, 3+ olan gün oranı ${f(cnt.filter((c) => c >= 3).length / Math.max(1, cnt.length) * 100, 0)}%.`, '', '| kural (1x, %5) | alınan | bakiye $ | getiri % | en büyük düşüş % |', '|---|---|---|---|---|');
  for (const [nm, opt] of [['sınırsız', {}], ['günde en çok 2', { perDay: 2 }], ['aynı anda en çok 3', { maxOpen: 3 }], ['ikisi birden', { perDay: 2, maxOpen: 3 }]]) { const r = follower(vs, { L: 1, ...opt }); L.push(`| ${nm} | ${r.taken} | ${f(r.final, 0)} | ${f(r.ret, 0)} | ${f(r.dd, 1)} |`); }
  // 9
  H('9. Kalabalık etkisi');
  const vols = vs.map(o.vol).filter(Number.isFinite).sort((a, b) => a - b);
  const pc = (p) => vols[Math.min(vols.length - 1, Math.floor(p * vols.length))];
  L.push(`24 saatlik hacim (milyon $) yüzdelikler: %10 ${f(pc(0.1) / 1e6, 1)}, %25 ${f(pc(0.25) / 1e6, 1)}, ortanca ${f(pc(0.5) / 1e6, 1)}, %75 ${f(pc(0.75) / 1e6, 1)} (n=${vols.length}).`);
  const share = (t) => f(vols.filter((v) => 20000 / v > t).length / Math.max(1, vols.length) * 100, 0) + '%';
  L.push(`100 takipçi × 200 $ = 20.000 $: hacmin %0.1'ini aşan sinyal oranı ${share(0.001)}, %0.5'ini ${share(0.005)}, %1'ini ${share(0.01)}. Ortanca sinyalde giriş hacmin ${f(20000 / pc(0.5) * 1000, 2)}‰'i.`);
  const small = vs.filter((x) => o.vol(x) < 3e6);
  L.push(`Hacmi 3M$ altı sinyaller (n=${small.length}): ortalama ${f(mean(small.map((x) => x.net)))}%, kalanlar (n=${vs.length - small.length}): ${f(mean(vs.filter((x) => !(o.vol(x) < 3e6)).map((x) => x.net)))}%.`);
  // 10
  H('10. Kayıp anatomisi');
  const worst = [...T].sort((a, b) => a.net - b.net).slice(0, 10);
  L.push('| coin | tarih | net % | çıkış | en kötü ters hareket % | ' + o.featNames.join(' | ') + ' |', '|---|---|---|---|---|' + o.featNames.map(() => '---').join('|') + '|');
  for (const w of worst) L.push(`| ${w.s} | ${new Date(w.tSig).toISOString().slice(0, 10)} | ${f(w.net, 1)} | ${w.exit} | ${f(w.maxAdv, 1)} | ${o.feats(w).map((v) => f(v, 1)).join(' | ')} |`);
  const rest = T.filter((x) => !worst.includes(x));
  L.push('', 'En kötü 10\'un giriş özelliklerinin geri kalanlara göre yüzdelik sırası (50 civarı = ayırt edilemiyor): ' + o.featNames.map((nm, i) => `${nm} ${f(mean(worst.map((w) => pctRank(rest.map((r) => o.feats(r)[i]).filter(Number.isFinite), o.feats(w)[i]))), 0)}`).join(', ') + '.', 'Filtre denenmedi (protokol 10).');
  // decision
  H('Karar (protokol 4. bölüm)');
  const dec = decide(T, o, dm, fo[1]);
  L.push(...dec.lines);
  const mo = monthly(fo[1].byMonth, span[0], span[1]);
  L.push('', `**Takipçi özeti (${name}, 1x, sinyal başına %5, 1000 $, DOĞRULAMA+SON): ayda beklenen ${f(mo.expected, 1)} $, en kötü ay ${f(mo.worst, 1)} $** (${mo.months} ay; karar: ${dec.verdict}).`);
  return { text: L.join('\n'), verdict: dec.verdict, oneLine: `${name}: ayda ${f(mo.expected, 1)} $, en kötü ay ${f(mo.worst, 1)} $ → ${dec.verdict}` };
}

function decide(T, o, dm, fol1) {
  const per = (p) => summary(T.filter((x) => x.period === p));
  const dg = per('DOGRULAMA'), sn = per('SON'), vs = summary(T.filter(VS));
  const plac = (p) => { const pr = T.filter(VS).filter((x) => Number.isFinite(x[p])); return pr.length ? mean(pr.map((x) => x.net - x[p])) : NaN; };
  const lines = [];
  const rows = [];
  const chk = (n, ok, note) => rows.push([n, ok, note]);
  const usable = (s) => s.n >= 5;
  chk('DOĞRULAMA ort > 0 ve ortanca > 0', !usable(dg) || (dg.mean > 0 && dg.median > 0), usable(dg) ? `n=${dg.n} ort ${f(dg.mean)} ortanca ${f(dg.median)}` : 'veri yok (n<5), yok sayıldı');
  chk('SON ort > 0 ve ortanca > 0', !usable(sn) || (sn.mean > 0 && sn.median > 0), usable(sn) ? `n=${sn.n} ort ${f(sn.mean)} ortanca ${f(sn.median)}` : 'veri yok (n<5), yok sayıldı');
  chk('DOĞRULAMA+SON %90 alt > 0', vs.lo > 0, `n=${vs.n} alt ${f(vs.lo)}`);
  chk('plasebo farkı > 0 (3 gün ve 14 gün)', plac('p3') > 0 && plac('p14') > 0, `3g ${f(plac('p3'))} · 14g ${f(plac('p14'))}`);
  chk('15 dk gecikmede ort > 0', dm[15] > 0, `${f(dm[15])}`);
  chk('1x en büyük düşüş ≤ %30', fol1.dd >= -30, `${f(fol1.dd, 1)}%`);
  chk('n ≥ 30 (DOĞRULAMA+SON)', vs.n >= 30, `n=${vs.n}`);
  lines.push('| şart | sonuç | değer |', '|---|---|---|');
  rows.forEach(([n, ok, note]) => lines.push(`| ${n} | ${ok ? 'TUTTU' : 'TUTMADI'} | ${note} |`));
  const bad = (usable(dg) && !(dg.mean > 0)) || (usable(sn) && !(sn.mean > 0));
  let verdict;
  if (bad) verdict = 'BIRAK';
  else if (rows.every(([, ok]) => ok)) verdict = 'YAYINA UYGUN';
  else if (vs.mean > 0) verdict = 'GÖLGE';
  else verdict = 'BIRAK';
  lines.push('', `**KARAR: ${verdict}**`);
  return { lines, verdict };
}

/* ---------------- engines ---------------- */
const out = [];
out.push('# Analiz raporu: 3 aday sinyal motoru', '', `Oluşturuldu: ${new Date().toISOString()} · protokol: \`docs/analiz-protokol.md\` (sonuçlardan önce commit'lendi) · veri: Binance halka açık arşivi · tüm rakamlar kendi ölçümümüz, başka projenin rakamlarına güvenilmedi.`, '');
out.push('## Kapsam', '', `- Evren: ${cov.symbols} USDT vadeli sembolü (delist dahil); 15m verisi bulunan: ${cov.withData}. Dönem: ${new Date(FROM).toISOString().slice(0, 10)} → ${new Date(TO).toISOString().slice(0, 10)}.`,
  `- İndirmeler: ${cov.download.fetched} yeni, ${cov.download.cached} önbellekten, arşivde olmayan ${cov.download.notFound}, hata ${cov.download.errorCount}${cov.download.first ? ' (ilk: ' + cov.download.first + ')' : ''}.`,
  `- v1k: ${cov.v1kCandidates} aday (en gevşek eşik), 1m yolu çıkarılamayan ${vFail.length} (${failWhy(vFail)}).`,
  `- G1: ${cov.g1Candidates} aday, hacim sıralamasında ilk 50 olan ve simüle edilen ${G.length}, 1m yolu çıkarılamayan ${gFail.length} (${failWhy(gFail)}).`,
  `- Tarama hataları: ${cov.errors.length ? cov.errors.join('; ') : 'yok'}.`, '');

const r1 = analyse('MOTOR 1 · v1k aşırı pump SHORT', trades(v1kCell(50, -1)), {
  rule: '15m ≥ +%4, 24s ≥ +%50, BTC 24s ≤ −%1, 24s hacim ≥ 1M $; SHORT, stop +%50, 24 saat, 4 saat soğuma.',
  claim: 'n 67, ort +9.55%, ortanca +14.1%, kazanma %64 (sonradan seçilmiş hücre).',
  diff: 'Fark yorumu aşağıdaki tablodan okunur: dönem, evren (delist dahil) ve masraf (%0.15 + stopta %0.20 + funding) iddiadan farklı olabilir; ızgaradan sonradan seçilmiş bir hücrede iyimser sapma beklenir.',
  vol: (x) => x.vol, featNames: ['15m %', '24s %', 'BTC24 %', 'hacim M$'], feats: (x) => [x.r15, x.chg24, x.btc24, x.vol / 1e6],
  plateau: () => ['| 24s \\ BTC | −0.5 | −1 | −2 |', '|---|---|---|---|', ...[40, 50, 60].map((c) => `| ≥ ${c}% | ` + [-0.5, -1, -2].map((b) => { const s = v1kCell(c, b).filter(VS); return `${f(mean(s.map((x) => x.net)))} (n=${s.length})`; }).join(' | ') + ' |')].join('\n'),
});
const g1Rule = 'günlük kapanış ≤ −%10, o ayın (G1-S) / önceki ayın (G1-D) hacimce ilk 50 coini; ertesi gün açılışta LONG, 3 gün tut';
const g1Opts = (stop, ver) => ({
  rule: `${g1Rule}; stop: ${stop === 'none' ? 'yok' : '−%33'}; sürüm: ${ver === 'S' ? 'G1-S (ifade edildiği gibi, ileriye bakma içerir)' : 'G1-D (dürüst)'}.`,
  claim: 'işlem başı +%1.76, 7 yılın 6\'sında +, çöküş günlerinde birlikte kaybeder.',
  diff: ver === 'S' ? 'G1-S ay hacmini ay bitmeden bilmeyi gerektirir; yalnız yeniden üretim içindir, karar dürüst sürümle verilir.' : 'Dürüst sürüm, sıralamayı yalnız önceki tam aydan alır.',
  vol: (x) => x.q, featNames: ['günlük %', 'sıra (D)'], feats: (x) => [x.ret, x.rankD],
  plateau: () => ['| eşik | ort % (DOĞRULAMA+SON) | n |', '|---|---|---|', ...[-8, -10, -12].map((d) => { const s = g1Trades(ver, d, stop).filter(VS); return `| ≤ ${d}% | ${f(mean(s.map((x) => x.net)))} | ${s.length} |`; })].join('\n'),
});
const results = [r1];
for (const [ver, stop] of [['S', 'none'], ['D', 'none'], ['D', 's33']]) {
  results.push(analyse(`MOTOR 3 · G1-${ver} · ${stop === 'none' ? 'stop yok' : 'stop −%33'}`, g1Trades(ver, -10, stop), g1Opts(stop, ver)));
}
out.push(...results.map((r) => r.text + '\n'));
out.push('## MOTOR 2 · Kilit açılışı SHORT', '', '**ÖLÇÜLEMEDİ: veri kaynağına erişim yok.** Bu oturumun ağ ilkesi `api.llama.fi` (DefiLlama emisyon verisi) adresini engelliyor; bağlantı reddedildi. Uydurma ya da tahmini veri konmadı. Ölçmek için oturum ağ ayarında `api.llama.fi` (ve sembol eşlemesi için `coins.llama.fi`) izin verilmeli.', '');
out.push('## Tek satır özet (takipçi: 1000 $, ayda beklenen $ ve en kötü ay $)', '', ...results.map((r) => `- ${r.oneLine}`), '- MOTOR 2: ölçülemedi.', '');
fs.writeFileSync(path.join(HERE, '..', '..', 'docs', 'analiz-rapor.md'), out.join('\n') + '\n');
console.log('\n' + results.map((r) => r.oneLine).join('\n'));
