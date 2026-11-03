// Motor testleri — sentetik mum verisiyle. Ağ gerektirmez.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ema, atr, cvdOf, zigzag, findSetup, findSetupDown, levels, volProfile, barsFor } from '../src/indicators.js';
import { planTargets, planOf, costR } from '../src/plan.js';
import { decide, decideLong, gradeAdj } from '../src/decide.js';
import { stepTrack, stats } from '../src/tracker.js';
import { CFG, gradeAtLeast } from '../src/config.js';
import { expectedSig, makeOrderId, tgFromOrderId, DONE, BAD } from '../src/payments.js';
import { fmt, pct, shortn, dur, seans, trDayStart } from '../src/util.js';

/* ---------------- yardımcı: sentetik mum üretici ---------------- */
function bar(t, o, h, l, c, v = 1000, tbFrac = 0.5) {
  return { t, o, h, l, c, v, q: v * c, tb: v * tbFrac, tq: v * c * tbFrac };
}

// Yatay taban -> keskin pump -> fitilli tepe -> geri çekilme (klasik fade kurulumu)
function pumpSeries() {
  const k = [];
  let t = 1_700_000_000_000;
  const step = 15 * 60_000;
  // 60 mum yatay 100 civarı
  for (let i = 0; i < 60; i++) {
    const base = 100 + Math.sin(i / 3) * 0.4;
    k.push(bar(t, base, base + 0.5, base - 0.5, base + 0.1, 1000));
    t += step;
  }
  // 8 mum güçlü pump 100 -> 135
  let p = 100.1;
  for (let i = 0; i < 8; i++) {
    const o = p;
    const c = p * 1.038;
    k.push(bar(t, o, c * 1.004, o * 0.998, c, 4000 + i * 500, 0.72));
    p = c; t += step;
  }
  // tepe mumu: uzun üst fitil, gövde küçük (alıcı reddedildi)
  const o = p;
  const high = p * 1.045;
  const c = p * 1.004;
  k.push(bar(t, o, high, o * 0.999, c, 9000, 0.60));
  t += step;
  // 10 mum sönümlü geri çekilme — düşen tepeler
  let q = c;
  for (let i = 0; i < 10; i++) {
    const oo = q;
    const cc = q * 0.988;
    k.push(bar(t, oo, oo * 1.002, cc * 0.997, cc, 1200 - i * 60, 0.34));
    q = cc; t += step;
  }
  return k;
}

function dumpSeries() {
  // pump serisini fiyat olarak aynala -> dump kurulumu
  const k = pumpSeries();
  const mid = 100;
  return k.map((b) => ({
    ...b,
    o: 2 * mid - b.o,
    c: 2 * mid - b.c,
    h: 2 * mid - b.l,
    l: 2 * mid - b.h,
    tb: b.v - b.tb,
  }));
}

/* ======================= GÖSTERGELER ======================= */
test('ema: ilk p-1 değer null, sonra artan seride fiyatın altında kalır', () => {
  const a = Array.from({ length: 50 }, (_, i) => 100 + i);
  const e = ema(a, 10);
  assert.equal(e.slice(0, 9).every((x) => x === null), true, 'ilk 9 null olmalı');
  assert.ok(e[49] !== null);
  assert.ok(e[49] < a[49], 'artan seride EMA fiyatın altında');
  assert.ok(e[49] > a[40], 'ama çok geride değil');
});

test('ema: sabit seride sabite yakınsar', () => {
  const e = ema(new Array(200).fill(42), 21);
  assert.ok(Math.abs(e[199] - 42) < 1e-9);
});

test('atr: bilinen aralıkta doğru ortalama', () => {
  // her mum tam 10 birim aralık, boşluk yok -> ATR = 10
  const k = Array.from({ length: 40 }, (_, i) => bar(i * 1000, 100, 105, 95, 100));
  const A = atr(k, 14);
  assert.equal(A.slice(0, 13).every((x) => x === null), true);
  assert.ok(Math.abs(A[39] - 10) < 1e-6, 'ATR 10 olmalı, geldi: ' + A[39]);
});

test('cvd: taker alım baskınsa yükselir, satım baskınsa düşer', () => {
  const up = cvdOf([bar(1, 1, 1, 1, 1, 100, 0.8), bar(2, 1, 1, 1, 1, 100, 0.8)]);
  assert.ok(up[1] > up[0], 'alım baskın -> CVD artar');
  const dn = cvdOf([bar(1, 1, 1, 1, 1, 100, 0.2), bar(2, 1, 1, 1, 1, 100, 0.2)]);
  assert.ok(dn[1] < dn[0], 'satım baskın -> CVD düşer');
});

test('zigzag: pump serisinde tepeyi en yüksek mumda bulur', () => {
  const k = pumpSeries();
  const A = atr(k, 14);
  const ZZ = zigzag(k, A, CFG.zz);
  const highs = ZZ.filter((x) => x.t === 'h');
  assert.ok(highs.length >= 1, 'en az bir swing tepe');
  const maxH = Math.max(...k.map((x) => x.h));
  const top = Math.max(...highs.map((x) => x.p));
  assert.ok(Math.abs(top - maxH) < 1e-6, `tepe ${top} vs gerçek max ${maxH}`);
});

test('findSetup: impulse bacağını ve tepe indeksini doğru bulur', () => {
  const k = pumpSeries();
  const A = atr(k, 14);
  const SU = findSetup(k, A, zigzag(k, A, CFG.zz));
  assert.equal(SU.solid, true, 'gerçek swing tepesi bulunmalı');
  assert.ok(SU.leg >= CFG.minPumpPct, `bacak %${SU.leg.toFixed(1)} >= %${CFG.minPumpPct}`);
  assert.ok(SU.high > SU.low);
  assert.ok(SU.si > SU.loI, 'tepe dipten sonra gelmeli');
  // tepe, serinin en yükseği olmalı
  assert.ok(Math.abs(SU.high - Math.max(...k.map((x) => x.h))) < 1e-6);
});

test('findSetup: tepe sonradan kırıldıysa o swing geçersiz sayılır', () => {
  const k = pumpSeries();
  // sona tepeyi aşan bir mum ekle
  const top = Math.max(...k.map((x) => x.h));
  const t = k[k.length - 1].t + 15 * 60_000;
  k.push(bar(t, top, top * 1.05, top * 0.999, top * 1.04, 5000, 0.8));
  const A = atr(k, 14);
  const SU = findSetup(k, A, zigzag(k, A, CFG.zz));
  // yeni tepe artık en yüksek nokta; eski tepe aday olamaz
  assert.ok(SU.high >= top, 'setup yeni tepeyi kullanmalı');
});

test('findSetupDown: dump serisinde dip bacağını bulur', () => {
  const k = dumpSeries();
  const A = atr(k, 14);
  const SD = findSetupDown(k, A, zigzag(k, A, CFG.zz));
  assert.ok(SD.leg >= CFG.minPumpPct, `dump bacağı %${SD.leg.toFixed(1)}`);
  assert.ok(SD.low < SD.high);
  assert.ok(Math.abs(SD.low - Math.min(...k.map((x) => x.l))) < 1e-6);
});

test('levels: tekrar dokunulan seviyeleri bulur ve fiyata yakınlığa göre sıralar', () => {
  const k = pumpSeries();
  const A = atr(k, 14);
  const L = levels(k, A);
  assert.ok(Array.isArray(L));
  assert.ok(L.length <= 4);
  L.forEach((x) => assert.ok(x.n >= CFG.srTouch, 'her seviye min dokunuş şartını geçmeli'));
  // fiyata yakınlık sıralaması
  const price = k[k.length - 1].c;
  for (let i = 1; i < L.length; i++) {
    assert.ok(Math.abs(L[i - 1].p - price) <= Math.abs(L[i].p - price) + 1e-9);
  }
});

test('volProfile: POC value area içinde, VAL <= POC <= VAH', () => {
  const k = pumpSeries();
  const vp = volProfile(k, 200, 60);
  assert.ok(vp.val <= vp.poc + 1e-9, `VAL ${vp.val} <= POC ${vp.poc}`);
  assert.ok(vp.poc <= vp.vah + 1e-9, `POC ${vp.poc} <= VAH ${vp.vah}`);
  assert.ok(Array.isArray(vp.lvn));
  // yatay taban en çok hacmi aldığı için POC 100 civarında olmalı
  assert.ok(vp.poc > 95 && vp.poc < 108, 'POC taban bölgesinde: ' + vp.poc);
});

test('barsFor: mesafe ATR ile karekök ölçekler', () => {
  assert.equal(barsFor(10, 10), 1);
  assert.equal(barsFor(20, 10), 4);
  assert.equal(barsFor(30, 10), 9);
  assert.ok(barsFor(0, 10) >= 1, 'en az 1 mum');
});

/* ======================= PLAN ======================= */
// plan testleri için minimal, gerçekçi bir m nesnesi
function fakeM({ price = 130, atrv = 2, side = 'S' } = {}) {
  const k = pumpSeries();
  return {
    sym: 'TESTUSDT', tf: '15m', k,
    last: { c: price, o: price, h: price, l: price, v: 1000 },
    lastAtr: atrv,
    atrPct: (atrv / price) * 100,
    volRatio: 1,
    e21: [price * 0.97], e50: [price * 0.94], e200: [price * 0.9],
    sr: [{ p: price * 0.96, n: 3 }, { p: price * 1.05, n: 2 }],
    vp: { poc: price * 0.93, vah: price * 1.02, val: price * 0.9, lvn: [] },
    av: price * 0.98,
    spikeHigh: price * 1.06, preLow: 100,
    stopPx: price + atrv * 1.6,
    oiUsd: 5e6,
    DN: {
      low: price * 0.94, top: price * 1.06, av: price * 1.01,
      stopPx: price - atrv * 1.6, huntBot: price * 0.9, sweep: null,
    },
    huntTop: price * 1.1, sweep: null,
  };
}

test('planOf (SHORT): stop girişin üstünde, hedef altında, R:R pozitif', () => {
  const m = fakeM({ side: 'S' });
  const P = planOf(m, 'S');
  assert.ok(P.st > P.en, 'short stopu girişin üstünde olmalı');
  assert.ok(P.t1 < P.en, 'short hedefi girişin altında olmalı');
  assert.ok(P.rr > 0 && Number.isFinite(P.rr));
  assert.ok(P.qty > 0, 'pozisyon boyutu pozitif');
});

test('planOf (LONG): stop girişin altında, hedef üstünde', () => {
  const m = fakeM({ side: 'L' });
  const P = planOf(m, 'L');
  assert.ok(P.st < P.en, 'long stopu girişin altında');
  assert.ok(P.t1 > P.en, 'long hedefi girişin üstünde');
  assert.ok(P.rr > 0);
});

test('plan: stop mesafesi minStopAtr ve maxStopAtr arasına sıkıştırılır', () => {
  const m = fakeM({ price: 130, atrv: 2 });
  // yapıyı absürt uzağa koy -> maxStopAtr'a kırpılmalı
  m.stopPx = 130 + 2 * 50;
  const P = planOf(m, 'S');
  const atrMult = Math.abs(P.st - P.en) / m.lastAtr;
  assert.ok(atrMult <= CFG.maxStopAtr + 1e-9, `stop ${atrMult}× ATR <= ${CFG.maxStopAtr}`);
  assert.equal(P.tooWide, true, 'yapı çok uzaktı, işaretlenmeli');

  // yapıyı absürt yakına koy -> minStopAtr'a açılmalı
  const m2 = fakeM({ price: 130, atrv: 2 });
  m2.stopPx = 130.01;
  const P2 = planOf(m2, 'S');
  const atrMult2 = Math.abs(P2.st - P2.en) / m2.lastAtr;
  assert.ok(atrMult2 >= CFG.minStopAtr - 1e-9, `stop ${atrMult2}× ATR >= ${CFG.minStopAtr}`);
});

test('plan: pozisyon boyutu riske göre — risk iki katına çıkarsa boyut yarılanır', () => {
  const a = planOf(fakeM({ price: 130, atrv: 1 }), 'S');
  const b = planOf(fakeM({ price: 130, atrv: 2 }), 'S');
  const riskRatio = Math.abs(b.st - b.en) / Math.abs(a.st - a.en);
  const qtyRatio = a.qty / b.qty;
  assert.ok(Math.abs(riskRatio - qtyRatio) < 0.05,
    `risk ${riskRatio.toFixed(2)}× iken boyut ${qtyRatio.toFixed(2)}× azalmalı`);
});

test('plan: hedef maxTpR sınırını aşmaz', () => {
  const m = fakeM();
  const P = planOf(m, 'S');
  const r = Math.abs(P.t1 - P.en) / Math.abs(P.st - P.en);
  assert.ok(r <= CFG.maxTpR + 1e-9, `hedef ${r.toFixed(2)}R <= ${CFG.maxTpR}`);
});

test('plan: hedef LVN içine düşerse düğümün ötesine taşınır', () => {
  const m = fakeM({ price: 130, atrv: 2 });
  const P0 = planOf(m, 'S');
  // P0.t1 çevresine bir LVN koy
  m.vp.lvn = [{ a: P0.t1 - 0.5, b: P0.t1 + 0.5 }];
  const P1 = planOf(m, 'S');
  if (P1.t1ad.includes('LVN')) {
    assert.ok(P1.t1 <= m.vp.lvn[0].a + 1e-9, 'short hedefi LVN altına taşınmalı');
  }
  assert.ok(Number.isFinite(P1.t1));
});

test('planTargets: uygun seviye yoksa sabit R hedefine düşer', () => {
  const m = fakeM({ price: 130, atrv: 2 });
  // tüm hedef kaynaklarını girişin ters tarafına taşı -> aday kalmasın
  m.vp = { poc: 999, vah: 999, val: 999, lvn: [] };
  m.e21 = [999]; m.e50 = [999]; m.av = 999;
  m.sr = []; m.preLow = 999; m.DN.low = 999;
  const P = planTargets(m, 'S', {
    en: 130, st: 134, mkt: 130, mode: 'piyasa', risk: 4, D: 2, atr: 2,
    riskPct: 3, tooFar: false, structSt: 134,
  });
  assert.ok(P.t1ad.includes('uygun seviye yok'), 'yedek hedef kullanılmalı: ' + P.t1ad);
  assert.ok(Math.abs(Math.abs(P.t1 - 130) / 4 - CFG.rrTarget) < 1e-6);
});

test('costR: stop daraldıkça komisyonun R maliyeti artar', () => {
  const wide = costR(100, 110);   // %10 stop
  const tight = costR(100, 101);  // %1 stop
  assert.ok(tight > wide, 'dar stopta maliyet daha büyük R yer');
  assert.ok(wide > 0);
  assert.equal(costR(100, 100), 0, 'sıfır mesafede maliyet tanımsız -> 0');
});

/* ======================= TAKİP (REPLAY) ======================= */
const mkSig = (over = {}) => ({
  key: 'TESTUSDTS1', symbol: 'TESTUSDT', dir: 'S', tf: '15m',
  created_at: new Date(1_700_000_000_000).toISOString(),
  entry: 100, stop: 104, tp1: 96, tp2: 92,
  cost_r: 0, mode: 'piyasa', ...over,
});

const ser = (bars) => bars.map((b, i) =>
  bar(1_700_000_000_000 + (i + 1) * 15 * 60_000, b.o, b.h, b.l, b.c));

test('stepTrack: TP1\'e değince kısmi çıkış yapar, pozisyon açık kalır', () => {
  // Kısmi çıkış açıkken (CFG.partialOn) TP1 pozisyonu KAPATMAZ:
  // yarısı alınır, stop başabaşa çekilir, kalan takipte kalır.
  const sig = mkSig();
  const k = ser([
    { o: 100, h: 101, l: 99, c: 99.5 },
    { o: 99.5, h: 100, l: 95.5, c: 96 },    // TP1 = 96 vuruldu
  ]);
  const p = stepTrack(sig, k, 15);
  assert.equal(p.status, 'takip', 'kısmi alındı ama pozisyon açık');
  assert.equal(p.partial, true, 'kısmi çıkış işaretlenmeli');
  assert.ok(!p.closed_at, 'henüz kapanmadı');
  // yarısı +1R realize edildi; kalan yarı GÜNCEL fiyatta (96 = +1R) değerlenir
  // -> açık R = 0.5 + 0.5×1 = 1.0  (başabaş olan stop, fiyat değil)
  assert.ok(Math.abs(p.open_r - 1) < 1e-9, 'açık R = 1.0 olmalı: ' + p.open_r);
  assert.ok(p.max_r >= 1 - 1e-9, 'seyir en az +1R görmüş olmalı: ' + p.max_r);
  assert.equal(p.stop_now, 100, 'stop başabaşa (girişe) çekilmiş olmalı');
});

test('stepTrack: kısmi çıkış kapalıyken TP1 pozisyonu tamamen kapatır', () => {
  // partialOn=0 davranışını doğrudan doğrulamak için tp1Frac=1 etkisini
  // tp2'yi TP1 ile aynı yöne çok yakın koyarak değil, CFG'yi geçici değiştirerek test ediyoruz.
  const saved = CFG.partialOn;
  CFG.partialOn = 0;
  try {
    const sig = mkSig({ tp2: null });
    const p = stepTrack(sig, ser([{ o: 100, h: 100.5, l: 95.5, c: 96 }]), 15);
    assert.equal(p.status, 'kazanç');
    assert.ok(Math.abs(p.r - 1) < 1e-9, 'tam +1R olmalı: ' + p.r);
  } finally {
    CFG.partialOn = saved;
  }
});

test('stepTrack: SHORT stop olursa kayıp ve -1R', () => {
  const sig = mkSig({ tp2: null });
  const k = ser([
    { o: 100, h: 104.5, l: 99, c: 104.2 },  // stop 104 vuruldu
  ]);
  const p = stepTrack(sig, k, 15);
  assert.equal(p.status, 'kayıp');
  assert.ok(Math.abs(p.r + 1) < 1e-9, 'tam -1R olmalı, geldi: ' + p.r);
  assert.equal(p.close_px, 104);
});

test('stepTrack: aynı mumda hem stop hem hedef varsa muhafazakâr davranır (stop)', () => {
  const sig = mkSig({ tp2: null });
  const k = ser([
    { o: 100, h: 105, l: 95, c: 100 },   // hem 104 stop hem 96 hedef içinde
  ]);
  const p = stepTrack(sig, k, 15);
  assert.equal(p.status, 'kayıp', 'mum içi sıra bilinmediği için stop varsayılmalı');
});

test('stepTrack: kısmi çıkış sonrası stop başabaşa çekilir', () => {
  const sig = mkSig({ tp2: 80 });   // TP2 uzak, TP1 ile kısmi alınacak
  const k = ser([
    { o: 100, h: 100.5, l: 95.5, c: 96 },  // TP1 vuruldu -> %50 kapat, stop = 100
    { o: 96, h: 100.5, l: 95, c: 100.2 },  // başabaş stop (100) vuruldu
  ]);
  const p = stepTrack(sig, k, 15);
  assert.ok(p.closed_at, 'kapanmalı');
  assert.equal(p.partial, true, 'kısmi çıkış işaretlenmeli');
  // yarısı +1R, yarısı 0R -> ~+0.5R
  assert.ok(Math.abs(p.r - 0.5) < 1e-6, 'yaklaşık +0.5R olmalı, geldi: ' + p.r);
});

test('stepTrack: TP2 vurulursa tam R:R alınır', () => {
  const sig = mkSig({ tp1: 96, tp2: 92 });  // 1R ve 2R
  const k = ser([
    { o: 100, h: 100.2, l: 91.5, c: 92 },   // aynı mumda TP2'ye kadar gitti
  ]);
  const p = stepTrack(sig, k, 15);
  assert.equal(p.status, 'kazanç');
  assert.ok(Math.abs(p.r - 2) < 1e-6, 'TP2 = 2R olmalı, geldi: ' + p.r);
});

test('stepTrack: süre dolarsa zaman ile kapanır', () => {
  const sig = mkSig({ tp1: 50, tp2: null });  // ulaşılamaz hedef
  const bars = [];
  for (let i = 0; i < CFG.trackBars + 3; i++) bars.push({ o: 100, h: 100.5, l: 99.5, c: 99.8 });
  const p = stepTrack(sig, bars.map((b, i) =>
    bar(1_700_000_000_000 + (i + 1) * 15 * 60_000, b.o, b.h, b.l, b.c)), 15);
  assert.equal(p.status, 'zaman');
  assert.ok(p.r > 0, 'fiyat lehimize kapandıysa küçük artı');
});

test('stepTrack: komisyon net R\'den düşülür', () => {
  const sig = mkSig({ tp2: null, cost_r: 0.08 });
  const k = ser([{ o: 100, h: 104.5, l: 99, c: 104.2 }]);
  const p = stepTrack(sig, k, 15);
  assert.ok(Math.abs(p.r + 1) < 1e-9);
  assert.ok(Math.abs(p.r_net + 1.08) < 1e-9, 'net = brüt - maliyet, geldi: ' + p.r_net);
});

test('stepTrack: LONG yönü simetrik çalışır', () => {
  // stop tarafı
  const sigA = mkSig({ dir: 'L', entry: 100, stop: 96, tp1: 104, tp2: null });
  const stop = stepTrack(sigA, ser([{ o: 100, h: 101, l: 95.5, c: 95.8 }]), 15);
  assert.equal(stop.status, 'kayıp');
  assert.ok(Math.abs(stop.r + 1) < 1e-9, 'tam -1R: ' + stop.r);

  // kazanç tarafı: TP2'ye kadar koşsun ki pozisyon tamamen kapansın
  const sigB = mkSig({ dir: 'L', entry: 100, stop: 96, tp1: 104, tp2: 108 });
  const win = stepTrack(sigB, ser([{ o: 100, h: 108.5, l: 99.8, c: 108.2 }]), 15);
  assert.equal(win.status, 'kazanç');
  assert.ok(Math.abs(win.r - 2) < 1e-6, 'TP2 = 2R: ' + win.r);
});

test('stepTrack: sinyalden önceki mumlar yok sayılır', () => {
  const sig = mkSig({ tp2: null });
  // ilk mum sinyal zamanından ÖNCE ve stopu aşıyor -> sayılmamalı
  const k = [
    bar(1_700_000_000_000 - 60 * 60_000, 100, 110, 100, 109),
    bar(1_700_000_000_000 + 15 * 60_000, 100, 100.5, 95.5, 96),
  ];
  const p = stepTrack(sig, k, 15);
  assert.notEqual(p.status, 'kayıp', 'geçmiş mum stop tetiklememeli');
});

test('stepTrack: idempotent — aynı girdi aynı sonucu verir', () => {
  const k = ser([
    { o: 100, h: 100.5, l: 95.5, c: 96 },
    { o: 96, h: 100.5, l: 95, c: 100.2 },
  ]);
  const a = stepTrack(mkSig({ tp2: 80 }), k, 15);
  const b = stepTrack(mkSig({ tp2: 80 }), k, 15);
  assert.deepEqual(a, b);
});

/* ======================= İSTATİSTİK ======================= */
test('stats: temel toplamlar ve isabet oranı', () => {
  const rows = [
    { status: 'kazanç', r: 1, r_net: 0.95, dir: 'S', grade: 'A', symbol: 'AUSDT', closed_at: '2026-01-01T00:00:00Z' },
    { status: 'kayıp', r: -1, r_net: -1.05, dir: 'S', grade: 'B', symbol: 'BUSDT', closed_at: '2026-01-02T00:00:00Z' },
    { status: 'kazanç', r: 2, r_net: 1.9, dir: 'L', grade: 'A', symbol: 'CUSDT', closed_at: '2026-01-03T00:00:00Z' },
  ];
  const st = stats(rows);
  assert.equal(st.n, 3);
  assert.equal(st.win, 2);
  assert.equal(st.loss, 1);
  assert.ok(Math.abs(st.tot - 1.8) < 1e-9, 'net toplam 1.8 olmalı: ' + st.tot);
  assert.ok(Math.abs(st.winPct - 66.666) < 0.01);
  assert.equal(st.byGrade.A.n, 2);
  assert.equal(st.byDir.SHORT.n, 2);
  assert.equal(st.best.symbol, 'CUSDT');
  assert.equal(st.worst.symbol, 'BUSDT');
});

test('stats: atlanan ve dolmayan sinyaller istatistiğe girmez', () => {
  const st = stats([
    { status: 'atlandı', r: 5, r_net: 5, dir: 'S', grade: 'A', symbol: 'X' },
    { status: 'dolmadı', r: 0, r_net: 0, dir: 'S', grade: 'A', symbol: 'Y' },
    { status: 'kazanç', r: 1, r_net: 1, dir: 'S', grade: 'A', symbol: 'Z', closed_at: '2026-01-01T00:00:00Z' },
  ]);
  assert.equal(st.n, 1, 'sadece gerçekleşen işlem sayılmalı');
  assert.equal(st.tot, 1);
});

test('stats: boş girdi çökmez', () => {
  const st = stats([]);
  assert.equal(st.n, 0);
  assert.equal(st.tot, 0);
  assert.equal(st.best, null);
});

test('stats: maksimum düşüş negatif ve mantıklı', () => {
  const mk = (r, d) => ({ status: r > 0 ? 'kazanç' : 'kayıp', r, r_net: r, dir: 'S', grade: 'A', symbol: 'X', closed_at: d });
  const st = stats([
    mk(2, '2026-01-01T00:00:00Z'),
    mk(-1, '2026-01-02T00:00:00Z'),
    mk(-1, '2026-01-03T00:00:00Z'),
    mk(1, '2026-01-04T00:00:00Z'),
  ]);
  assert.ok(Math.abs(st.mdd + 2) < 1e-9, 'tepe 2, dip 0 -> -2R düşüş: ' + st.mdd);
});

/* ======================= KARAR MOTORU ======================= */
// decide() gerçek analyze çıktısına benzeyen tam bir m nesnesi ister
function decideM(over = {}) {
  const base = fakeM({ price: 130, atrv: 2 });
  return {
    ...base,
    pumpPct: 35, cAtr: 3.0, wick: 0.5, volR: 0.3, cvdFall: true,
    oiChg: -6, oiBleed: -4, ratio: null,
    takerNow: 0.8, takerPrev: 1.2, topNow: 1.1,
    structOk: true, pull: 6,
    sweep: { i: 70, h: 138, lvl: 136 },
    t_retest: true, t_break: true, t_vwap: true,
    onb: 400, funding: 0.08, htfBias: 'aşağı',
    sect: null, spotShare: 55, oiPerVol: 1.1,
    oiUsd: 5e6, liqLv: [{ p: 120, long: true, lbl: 'L10x' }],
    ...over,
  };
}

test('decide: tüm fazlar tamamsa SHORT verir', () => {
  const d = decide(decideM(), 0.2, {});
  assert.equal(d.vd, 'SHORT');
  assert.equal(d.typeOk, 2);
  assert.ok(d.exN >= 3, 'tükenme >= 3 olmalı: ' + d.exN);
  assert.ok(d.trN >= 1);
  assert.ok(['A', 'B'].includes(d.grade), 'iyi kurulum A/B olmalı: ' + d.grade);
});

test('decide: OI şişmişse hard veto -> SHORT YASAK', () => {
  const d = decide(decideM({ oiChg: 40 }), 0.2, {});
  assert.equal(d.vd, 'SHORT YASAK');
  assert.equal(d.typeOk, 0);
  assert.match(d.sub, /kaldıraçlı/i);
});

test('decide: BTC yukarı impulstaysa veto', () => {
  const d = decide(decideM(), CFG.btcVeto + 1, {});
  assert.equal(d.vd, 'SHORT YASAK');
  assert.match(d.sub, /BTC/);
});

test('decide: yeni listelenen coin veto', () => {
  const d = decide(decideM({ onb: 5 }), 0.2, {});
  assert.equal(d.vd, 'SHORT YASAK');
  assert.match(d.sub, /listelenmiş/);
});

test('decide: BTC şoku veto', () => {
  const d = decide(decideM(), 0.2, { shock: 3.5 });
  assert.equal(d.vd, 'SHORT YASAK');
});

test('decide: impulse küçükse SETUP YOK', () => {
  const d = decide(decideM({ pumpPct: 5 }), 0.2, {});
  assert.equal(d.vd, 'SETUP YOK');
});

test('decide: tükenme yetersizse TÜKENME BEKLE', () => {
  const d = decide(decideM({
    wick: 0.1, volR: 2, cvdFall: false, oiBleed: 0, takerNow: 1.5, takerPrev: 1.0,
  }), 0.2, {});
  assert.equal(d.vd, 'TÜKENME BEKLE');
  assert.ok(d.exN < 3);
});

test('decide: tetik yoksa TETİK BEKLE', () => {
  const d = decide(decideM({
    sweep: null, t_retest: false, t_break: false, t_vwap: false,
  }), 0.2, {});
  assert.equal(d.vd, 'TETİK BEKLE');
  assert.equal(d.trN, 0);
});

test('decide: fiyat hâlâ tepe bölgesindeyse TETİK BEKLE', () => {
  const d = decide(decideM({ pull: 0.5 }), 0.2, {});
  assert.equal(d.vd, 'TETİK BEKLE');
});

test('decideLong: ayna kurulumda LONG verir', () => {
  const base = fakeM({ price: 130, atrv: 2 });
  const m = {
    ...base,
    onb: 400, funding: -0.08, htfBias: 'yukarı', sect: null,
    spotShare: 55, oiPerVol: 1.1, takerNow: 1.4, takerPrev: 0.9,
    oiUsd: 5e6, liqLv: [{ p: 140, long: false, lbl: 'S10x' }],
    DN: {
      ...base.DN, leg: 35, cAtr: 3.0, wick: 0.5, volR: 0.3, cvdRise: true,
      oiChg: -6, oiBleed: -4, ratio: null, structOk: true, bounce: 6,
      sweep: { i: 70, l: 120, lvl: 122 }, t_retest: true, t_break: true, t_vwap: true,
    },
  };
  const d = decideLong(m, -0.2, {});
  assert.equal(d.vd, 'LONG');
  assert.equal(d.dir, 'L');
});

test('decideLong: BTC aşağı impulstaysa veto', () => {
  const base = fakeM();
  const m = {
    ...base, onb: 400, funding: -0.08, htfBias: 'yukarı', takerNow: 1.4,
    DN: { ...base.DN, leg: 35, cAtr: 3, wick: 0.5, volR: 0.3, cvdRise: true, oiChg: -6, oiBleed: -4, structOk: true, bounce: 6, sweep: {}, t_retest: true, t_break: true, t_vwap: true },
  };
  const d = decideLong(m, -(CFG.btcVeto + 1), {});
  assert.equal(d.vd, 'LONG YASAK');
});

test('gradeAdj: teyit oranı yüksekse sınıf yükselir, düşükse düşer', () => {
  assert.equal(gradeAdj('B', { ratio: 0.8, av: 10 }), 'A');
  assert.equal(gradeAdj('B', { ratio: 0.2, av: 10 }), 'C');
  assert.equal(gradeAdj('B', { ratio: 0.5, av: 10 }), 'B');
  assert.equal(gradeAdj('B', { ratio: null, av: 10 }), 'B', 'veri yoksa dokunma');
  assert.equal(gradeAdj('B', { ratio: 0.9, av: 2 }), 'B', 'az örnekte dokunma');
  assert.equal(gradeAdj('A', { ratio: 0.9, av: 10 }), 'A', 'A üstü yok');
  assert.equal(gradeAdj('D', { ratio: 0.1, av: 10 }), 'D', 'D altı yok');
});

test('gradeAtLeast: sınıf eşiği doğru karşılaştırır', () => {
  assert.equal(gradeAtLeast('A', 'B'), true);
  assert.equal(gradeAtLeast('B', 'B'), true);
  assert.equal(gradeAtLeast('C', 'B'), false);
  assert.equal(gradeAtLeast('D', 'C'), false);
});

/* ======================= ÖDEME GÜVENLİĞİ ======================= */
test('IPN imzası: anahtar sırası değişse de aynı imza çıkar', () => {
  const a = expectedSig({ b: 2, a: 1, c: { y: 2, x: 1 } }, 'secret');
  const b = expectedSig({ c: { x: 1, y: 2 }, a: 1, b: 2 }, 'secret');
  assert.equal(a, b, 'alfabetik sıralama tutarlı olmalı');
  assert.equal(a.length, 128, 'HMAC-SHA512 hex 128 karakter');
});

test('IPN imzası: farklı gövde farklı imza', () => {
  const a = expectedSig({ payment_status: 'finished' }, 'secret');
  const b = expectedSig({ payment_status: 'waiting' }, 'secret');
  assert.notEqual(a, b);
});

test('IPN imzası: farklı anahtar farklı imza', () => {
  assert.notEqual(expectedSig({ x: 1 }, 'k1'), expectedSig({ x: 1 }, 'k2'));
});

test('IPN imzası: secret yoksa null', () => {
  assert.equal(expectedSig({ x: 1 }, ''), null);
});

test('order_id: telegram id gidip geri gelir', () => {
  const oid = makeOrderId(123456789, '3ay');
  assert.match(oid, /^tg123456789-3ay-/);
  assert.equal(tgFromOrderId(oid), 123456789);
  assert.equal(tgFromOrderId('bozuk'), null);
  assert.equal(tgFromOrderId(null), null);
});

test('ödeme durumları: tamamlanan ve başarısız kümeler ayrık', () => {
  assert.equal(DONE.has('finished'), true);
  assert.equal(DONE.has('confirmed'), true);
  assert.equal(DONE.has('waiting'), false);
  assert.equal(DONE.has('partially_paid'), false, 'eksik ödeme otomatik erişim vermemeli');
  assert.equal(BAD.has('expired'), true);
  [...DONE].forEach((s) => assert.equal(BAD.has(s), false));
});

/* ======================= BİÇİMLEME ======================= */
test('fmt / pct / shortn: null güvenli ve beklenen biçim', () => {
  assert.equal(fmt(null), '—');
  assert.equal(fmt(undefined), '—');
  assert.equal(fmt(NaN), '—');
  assert.equal(fmt(1.234, 2), '1.23');
  assert.equal(pct(1.5), '+1.50%');
  assert.equal(pct(-1.5), '-1.50%');
  assert.equal(pct(null), '—');
  assert.equal(shortn(1500), '1.50K');
  assert.equal(shortn(2_500_000), '2.50M');
  assert.equal(shortn(3_000_000_000), '3.00B');
});

test('dur: süreyi insan diline çevirir', () => {
  assert.equal(dur(5 * 60_000), '5 dk');
  assert.equal(dur(134 * 60_000), '2 sa 14 dk');
  assert.equal(dur(120 * 60_000), '2 sa');
  assert.match(dur(26 * 3600_000), /gün/);
});

test('seans: TR saatine göre doğru seans', () => {
  const at = (hUtc) => seans(Date.UTC(2026, 0, 5, hUtc, 0, 0));
  assert.equal(at(22), 'ölü saat');   // TR 01:00
  assert.equal(at(5), 'asya');        // TR 08:00
  assert.equal(at(11), 'avrupa');     // TR 14:00
  assert.equal(at(16), 'abd');        // TR 19:00
});

test('trDayStart: TR gün başlangıcı tutarlı', () => {
  const t = Date.UTC(2026, 0, 5, 12, 0, 0);
  const s = trDayStart(t);
  assert.ok(s <= t, 'gün başı şimdiden önce');
  assert.ok(t - s < 864e5, 'aynı gün içinde');
  assert.equal(trDayStart(s + 1000), s, 'aynı güne düşen iki an aynı başlangıcı verir');
});
