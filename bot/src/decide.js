// Karar motoru: 3 fazlı onay + vetolar + teyit skoru. HUD'daki decide/decideLong portu.
import { CFG, GRADES } from './config.js';
import { fmt, pct, shortn, seans, decFor } from './util.js';
import { PREC, slip } from './binance.js';
import { cascade, planOf } from './plan.js';

/* ctx: botun o an elindeki bağlam.
   { depth, tape, market:{up,dn,n}, dvol, betaV, rvolV, fundHist, liq15, macro, shock } */

export function extras(m, side, ctx = {}) {
  const L = side === 'L';
  const E = [];
  const add = (n, w, p, v) => E.push([n, w, p, v === undefined ? '—' : v]);
  const dp = ctx.depth || null;
  const tape = ctx.tape || null; // canlı tape varsa mikro yapı kontrolleri açılır
  const D = decFor(m.last.c, m.sym, PREC);

  // ---------- likidasyon tarafı ----------
  const cs = dp ? cascade(m, side, dp) : null;
  add('kaskad durağı', 'likidasyon yakıtının bittiği seviye bulundu',
    cs ? !!cs.stopAt : null, cs ? (cs.stopAt ? fmt(cs.stopAt, D) : 'yok') : '—');

  const liq = ctx.liq15 || null; // {buy,sell} son 15dk likidasyon $
  add('likidasyon yönü', L ? 'short likidasyonu baskın' : 'long likidasyonu baskın',
    liq && liq.buy + liq.sell > 0 ? (L ? liq.buy > liq.sell : liq.sell > liq.buy) : null,
    liq && liq.buy + liq.sell > 0 ? '$' + shortn(L ? liq.buy : liq.sell) : '—');

  const poolD = (m.liqLv || [])
    .filter((x) => (L ? !x.long : x.long))
    .map((x) => Math.abs(x.p - m.last.c) / m.last.c)
    .sort((a, b) => a - b)[0];
  add('likidasyon havuzu', 'hedef yönünde 2R içinde havuz var',
    poolD !== undefined ? poolD <= 0.12 : null,
    poolD !== undefined ? pct(poolD * 100 * (L ? 1 : -1)) : '—');

  // ---------- emir defteri (REST snapshot) ----------
  if (dp) {
    const sk = dp.bidN / ((dp.bidN + dp.askN) || 1);
    add('defter dengesi', L ? 'alış tarafı ağır' : 'satış tarafı ağır',
      L ? sk > 0.55 : sk < 0.45, fmt(sk * 100, 0) + '% alış');
    const wallsAhead = (dp.walls || []).filter((w) => (L ? w.ask : !w.ask)).length;
    add('önde duvar yok', 'hedef yolunda büyük duvar yok', wallsAhead === 0,
      wallsAhead ? wallsAhead + ' duvar' : 'temiz');
    const gap = dp.gaps
      ? dp.gaps
          .map((g) => ({ d: Math.abs((L ? g.a : g.b) - m.last.c) / m.last.c, g }))
          .filter((x) => (L ? x.g.a > m.last.c : x.g.b < m.last.c))
          .sort((a, b) => a.d - b.d)[0]
      : null;
    add('likidite boşluğu', 'hedef yönünde boşluk var = hızlanır', !!gap,
      gap ? pct(gap.d * 100 * (L ? 1 : -1)) : 'yok');
    // kayma: planlanan pozisyon büyüklüğü defteri ne kadar süpürür
    const P0 = planOf(m, side, dp);
    const u = P0.qty * P0.en;
    const s1 = slip(dp, u, L ? 'buy' : 'sell');
    const s2 = slip(dp, u, L ? 'sell' : 'buy');
    const slipR = s1?.full && s2?.full ? ((s1.pct + s2.pct) / Math.abs(P0.riskPct)) * 100 : null;
    add('kayma kabul edilebilir', "giriş+çıkış < R'nin %15'i",
      slipR === null ? null : slipR < 15, slipR === null ? '—' : fmt(slipR, 1) + '%');
  } else {
    ['defter dengesi', 'önde duvar yok', 'likidite boşluğu', 'kayma kabul edilebilir']
      .forEach((n) => add(n, 'emir defteri gerekli', null));
  }

  // ---------- canlı tape (opsiyonel WS teyidi) ----------
  if (tape && tape.trades >= 20) {
    add('tik yönü', L ? 'alış baskın' : 'satış baskın',
      L ? tape.sellN < tape.trades / 2 : tape.sellN > tape.trades / 2,
      tape.sellN + '/' + tape.trades + ' satış');
    add('balina akışı', 'hacmin %25+ı büyük emir',
      tape.vol ? tape.whale / tape.vol > 0.25 : null,
      tape.vol ? fmt((tape.whale / tape.vol) * 100, 0) + '%' : '—');
    add('akış yönü', L ? 'taker alım net pozitif' : 'taker satım net pozitif',
      tape.vol ? (L ? tape.buyVol > tape.sellVol : tape.sellVol > tape.buyVol) : null,
      tape.vol ? fmt((((L ? tape.buyVol : tape.sellVol) / tape.vol) * 100), 0) + '%' : '—');
  } else {
    ['tik yönü', 'balina akışı', 'akış yönü'].forEach((n) => add(n, 'canlı tape gerekli', null));
  }

  // ---------- bağlam ----------
  add('DVOL rejimi', 'panik rejimi değil (< 75. dilim)',
    ctx.dvol ? ctx.dvol.pctl < 75 : null, ctx.dvol ? fmt(ctx.dvol.pctl, 0) + 'p' : '—');
  add('BTC betası makul', 'beta < 3',
    ctx.betaV?.beta != null ? ctx.betaV.beta < 3 : null,
    ctx.betaV?.beta != null ? fmt(ctx.betaV.beta, 2) + '×' : '—');
  add('katalizör yok', 'RVOL < 3 (haber pumpı değil)',
    ctx.rvolV != null ? ctx.rvolV < 3 : null,
    ctx.rvolV != null ? fmt(ctx.rvolV, 1) + '×' : '—');
  add('OI derinliği', 'notional OI ≥ $2M',
    m.oiUsd ? m.oiUsd >= 2e6 : null, m.oiUsd ? '$' + shortn(m.oiUsd) : '—');

  const mk = ctx.market;
  add('piyasa rejimi', L ? 'toplu çöküş yok' : 'toplu pump yok',
    mk?.n ? (L ? mk.dn / mk.n <= 0.25 : mk.up / mk.n <= 0.25) : null,
    mk?.n ? mk.up + '↑/' + mk.dn + '↓' : '—');
  add('seans', 'ölü saat değil', seans() !== 'ölü saat', seans());

  const FH = ctx.fundHist || [];
  if (FH.length >= 2) {
    const f = FH.map((x) => +x.fundingRate * 100);
    add('funding tepe yapmış', 'son periyot öncekinden düşük',
      Math.abs(f[f.length - 1]) < Math.abs(f[f.length - 2]), fmt(f[f.length - 1], 4) + '%');
  } else add('funding tepe yapmış', 'funding geçmişi gerekli', null);

  const av = E.filter((x) => x[2] !== null);
  const ps = av.filter((x) => x[2]).length;
  return { E, av: av.length, ps, ratio: av.length ? ps / av.length : null };
}

export function gradeAdj(g, x) {
  if (x.ratio === null || x.av < 4) return g;
  let i = GRADES.indexOf(g);
  if (x.ratio >= 0.7) i = Math.min(3, i + 1);
  else if (x.ratio <= 0.3) i = Math.max(0, i - 1);
  return GRADES[i];
}

const macroRed = (ctx) => ctx.macro?.lvl === 'kırmızı';
const shocked = (ctx) => (ctx.shock ?? 0) > 2.5;

// ======================= SHORT (pump-fade) =======================
export function decide(m, btc15, ctx = {}) {
  // FAZ 1 — pump tipi
  let type, typeOk;
  if (m.oiChg !== null && m.oiChg <= -3) { type = 'SHORT SQUEEZE'; typeOk = 2; }
  else if (m.ratio !== null && m.ratio >= CFG.oiPriceRatio) { type = 'SPOT SÜRÜKLÜ'; typeOk = 2; }
  else if (m.oiChg !== null && m.oiChg > CFG.oiVeto) { type = 'KALDIRAÇLI TREND'; typeOk = 0; }
  else { type = 'KARIŞIK'; typeOk = 1; }

  // FAZ 2 — tükenme (>=3 gerekli)
  const EX = [
    ['tepe mumu üst fitilli', 'fitil ≥ gövdenin yarısı', m.wick >= 0.4, fmt(m.wick * 100, 0) + '%'],
    ['hacim sönümü', 'son mum ≤ pump×' + CFG.volDecay, m.volR <= CFG.volDecay, fmt(m.volR, 2) + '×'],
    ['CVD dönmüş', 'tepeden beri delta eriyor', m.cvdFall, m.cvdFall ? 'evet' : 'hayır'],
    ['OI tepeden eriyor', '≥ %' + CFG.oiBleed + ' pozisyon kapandı',
      m.oiBleed !== null && m.oiBleed <= -CFG.oiBleed, pct(m.oiBleed)],
    ['taker alım soğuyor', 'oran düşüşte / < 1',
      m.takerNow !== null && (m.takerNow < 1 || (m.takerPrev && m.takerNow < m.takerPrev)),
      fmt(m.takerNow, 2)],
  ];
  const exN = EX.filter((x) => x[2]).length;

  // FAZ 3 — tetik (>=1 gerekli)
  const TR = [
    ['likidite süpürmesi', 'önceki tepe kırıldı, altında kapandı', !!m.sweep, m.sweep ? 'VAR' : 'yok'],
    ['başarısız retest', 'tepeye yaklaşıp kırmızı kapanış', m.t_retest, m.t_retest ? 'var' : 'yok'],
    ['yapı kırılımı', 'impulse ilk HL kırıldı', m.t_break, m.t_break ? 'var' : 'yok'],
    ['aVWAP reddi', 'pump VWAP altına düştü', m.t_vwap, m.t_vwap ? 'var' : 'yok'],
  ];
  const trN = TR.filter((x) => x[2]).length;

  // VETOLAR
  const V = [
    ['OI VETO', "pump'ta OI ≤ %" + CFG.oiVeto, !(m.oiChg !== null && m.oiChg > CFG.oiVeto), pct(m.oiChg)],
    ['BTC rejimi', 'BTC 15m ≤ %' + CFG.btcVeto, !(btc15 !== null && btc15 > CFG.btcVeto), pct(btc15)],
    ['makro / BTC şok', 'olaya 30dk yok + BTC sakin', !macroRed(ctx) && !shocked(ctx),
      macroRed(ctx) ? 'OLAY' : shocked(ctx) ? 'ŞOK' : 'temiz'],
    ['yeni listeleme', '≥ ' + CFG.newListDays + ' gün olmalı',
      !(m.onb !== null && m.onb < CFG.newListDays), m.onb === null ? '—' : m.onb + 'g'],
    ['impulse yeterli', '≥ %' + CFG.minPumpPct, m.pumpPct >= CFG.minPumpPct, pct(m.pumpPct)],
    ['tek mum patlaması', '≥ ' + CFG.candleAtr + '× ATR', m.cAtr >= CFG.candleAtr, fmt(m.cAtr, 1) + '×'],
    ['funding (bonus)', '≥ %' + CFG.fundingHot + ' = kalabalık long',
      m.funding !== null && m.funding >= CFG.fundingHot, fmt(m.funding, 4) + '%'],
    ['üst TF uyumu (bonus)', '4× TF yönü aşağı', m.htfBias === 'aşağı', m.htfBias || '—'],
    ['sektör sakin (bonus)', 'sektör toplu pompalanmıyor', !(m.sect && m.sect.hot),
      m.sect ? (m.sect.hot ? 'SEKTÖR HAREKETİ' : fmt(m.sect.med, 1) + '%') : '—'],
    ['spot sürüklü (bonus)', 'spot payı ≥ %40 = kaldıraçsız alım',
      m.spotShare !== null && m.spotShare >= 40, m.spotShare === null ? '—' : fmt(m.spotShare, 0) + '%'],
    ['kalabalık defter (bonus)', 'OI ≥ 24s hacmin 0.8 katı',
      m.oiPerVol !== null && m.oiPerVol >= 0.8, m.oiPerVol === null ? '—' : fmt(m.oiPerVol, 2) + '×'],
  ];
  const hardVeto = !V[0][2] || !V[1][2] || !V[2][2] || !V[3][2];
  const setupOk = V[4][2] && V[5][2];

  let vd, sub;
  if (hardVeto || typeOk === 0) {
    vd = 'SHORT YASAK';
    sub = !V[0][2] ? `OI %${fmt(m.oiChg, 1)} şişmiş. Bu pump'ı kaldıraçlı alım taşıyor — fade değil trend. Dokunma.`
      : !V[1][2] ? "BTC yukarı impulsta. Altcoin fade'i bu rejimde çalışmaz."
      : !V[2][2] ? 'Makro olay penceresi veya BTC şok hareketi — yeni pozisyon açma.'
      : !V[3][2] ? `Coin ${m.onb} günlük listelenmiş. Üstte direnç yok, fiyat keşfi. Fade etme.`
      : 'Pump tipi kaldıraçlı trend.';
  } else if (!setupOk) {
    vd = 'SETUP YOK';
    sub = 'Fade edilecek bir impulse yok.';
  } else if (exN < 3) {
    vd = 'TÜKENME BEKLE';
    sub = `Pump tipi uygun ama tükenme onayı ${exN}/5. Hâlâ alıcı var — düşen bıçak yakalama.`;
  } else if (trN < 1) {
    vd = 'TETİK BEKLE';
    sub = 'Tükenme onaylandı. Şimdi tetiği bekle: başarısız retest, yapı kırılımı veya aVWAP reddi.';
  } else if (!m.structOk || m.pull < CFG.minPullback) {
    vd = 'TETİK BEKLE';
    sub = 'Tetik var ama fiyat hâlâ tepe bölgesinde. Düşük tepe teyidi olmadan girme.';
  } else {
    vd = 'SHORT';
    sub = 'Üç faz da tamam. Stop/hedef ile gir, boyutu stop mesafesine göre küçült.';
  }

  const X = extras(m, 'S', ctx);
  const qual = Math.round((typeOk / 2) * 26 + (exN / 5) * 34 + (trN / 4) * 26 + (X.ratio === null ? 0.5 : X.ratio) * 14);
  let grade = typeOk === 2 && exN >= 4 && trN >= 1 ? 'A' : typeOk === 2 && exN >= 3 ? 'B' : exN >= 3 ? 'C' : 'D';
  grade = gradeAdj(grade, X);
  return { dir: 'S', type, typeOk, EX, TR, V, X, exN, trN, vd, sub, qual, grade };
}

// ======================= LONG (dump-fade) =======================
export function decideLong(m, btc15, ctx = {}) {
  const D = m.DN;
  let type, typeOk;
  if (D.oiChg !== null && D.oiChg <= -3) { type = 'LONG LİKİDASYONU'; typeOk = 2; }
  else if (D.ratio !== null && D.ratio >= CFG.oiPriceRatio) { type = 'SPOT SATIŞ'; typeOk = 2; }
  else if (D.oiChg !== null && D.oiChg > CFG.oiVeto) { type = 'SHORT TRENDİ'; typeOk = 0; }
  else { type = 'KARIŞIK'; typeOk = 1; }

  const EX = [
    ['dip mumu alt fitilli', 'fitil ≥ gövdenin yarısı', D.wick >= 0.4, fmt(D.wick * 100, 0) + '%'],
    ['hacim sönümü', 'son mum ≤ dump×' + CFG.volDecay, D.volR <= CFG.volDecay, fmt(D.volR, 2) + '×'],
    ['CVD dönmüş', 'dipten beri alıcı geliyor', D.cvdRise, D.cvdRise ? 'evet' : 'hayır'],
    ['OI dipten eriyor', 'zorunlu satış bitti',
      D.oiBleed !== null && D.oiBleed <= -CFG.oiBleed, pct(D.oiBleed)],
    ['taker alım ısınıyor', 'oran > 1 veya yükselişte',
      m.takerNow !== null && (m.takerNow > 1 || (m.takerPrev && m.takerNow > m.takerPrev)),
      fmt(m.takerNow, 2)],
  ];
  const exN = EX.filter((x) => x[2]).length;

  const TR = [
    ['likidite süpürmesi', 'önceki dip kırıldı, üstünde kapandı', !!D.sweep, D.sweep ? 'VAR' : 'yok'],
    ['başarısız retest', 'dibe yaklaşıp yeşil kapanış', D.t_retest, D.t_retest ? 'var' : 'yok'],
    ['yapı kırılımı', 'dump ilk LH kırıldı', D.t_break, D.t_break ? 'var' : 'yok'],
    ['aVWAP üstü', 'dump VWAP üstüne çıktı', D.t_vwap, D.t_vwap ? 'var' : 'yok'],
  ];
  const trN = TR.filter((x) => x[2]).length;

  const V = [
    ['OI VETO', 'dumpta OI ≤ %' + CFG.oiVeto, !(D.oiChg !== null && D.oiChg > CFG.oiVeto), pct(D.oiChg)],
    ['BTC rejimi', 'BTC 15m ≥ -%' + CFG.btcVeto, !(btc15 !== null && btc15 < -CFG.btcVeto), pct(btc15)],
    ['makro / BTC şok', 'olaya 30dk yok + BTC sakin', !macroRed(ctx) && !shocked(ctx),
      macroRed(ctx) ? 'OLAY' : shocked(ctx) ? 'ŞOK' : 'temiz'],
    ['yeni listeleme', '≥ ' + CFG.newListDays + ' gün olmalı',
      !(m.onb !== null && m.onb < CFG.newListDays), m.onb === null ? '—' : m.onb + 'g'],
    ['dump yeterli', '≥ %' + CFG.minPumpPct, D.leg >= CFG.minPumpPct, pct(-D.leg)],
    ['tek mum çöküşü', '≥ ' + CFG.candleAtr + '× ATR', D.cAtr >= CFG.candleAtr, fmt(D.cAtr, 1) + '×'],
    ['funding negatif (bonus)', '≤ -%' + CFG.fundingHot + ' = kalabalık short',
      m.funding !== null && m.funding <= -CFG.fundingHot, fmt(m.funding, 4) + '%'],
    ['üst TF uyumu (bonus)', '4× TF yönü yukarı', m.htfBias === 'yukarı', m.htfBias || '—'],
    ['sektör sakin (bonus)', 'sektör toplu çökmüyor', !(m.sect && m.sect.med <= -6),
      m.sect ? fmt(m.sect.med, 1) + '%' : '—'],
    ['spot sürüklü (bonus)', 'spot payı ≥ %40 = panik spotta',
      m.spotShare !== null && m.spotShare >= 40, m.spotShare === null ? '—' : fmt(m.spotShare, 0) + '%'],
    ['kalabalık defter (bonus)', 'OI ≥ 24s hacmin 0.8 katı',
      m.oiPerVol !== null && m.oiPerVol >= 0.8, m.oiPerVol === null ? '—' : fmt(m.oiPerVol, 2) + '×'],
  ];
  const hardVeto = !V[0][2] || !V[1][2] || !V[2][2] || !V[3][2];
  const setupOk = V[4][2] && V[5][2];

  let vd, sub;
  if (hardVeto || typeOk === 0) {
    vd = 'LONG YASAK';
    sub = !V[0][2] ? 'OI ' + fmt(D.oiChg, 1) + '% şişmiş — düşüşü yeni shortlar sürüyor. Trend, dip değil.'
      : !V[1][2] ? 'BTC aşağı impulsta. Altcoin dip alımı bu rejimde çalışmaz.'
      : !V[2][2] ? 'Makro olay penceresi veya BTC şok hareketi — beklemede kal.'
      : !V[3][2] ? 'Coin ' + m.onb + ' günlük listelenmiş — altta zemin yok.'
      : 'Düşüş tipi short trendi.';
  } else if (!setupOk) {
    vd = 'SETUP YOK';
    sub = 'Fade edilecek bir çöküş yok.';
  } else if (exN < 3) {
    vd = 'TÜKENME BEKLE';
    sub = 'Tükenme onayı ' + exN + '/5. Satış hâlâ sürüyor.';
  } else if (trN < 1) {
    vd = 'TETİK BEKLE';
    sub = 'Tükenme onaylandı, tetik bekleniyor.';
  } else if (!D.structOk || D.bounce < CFG.minPullback) {
    vd = 'TETİK BEKLE';
    sub = 'Tetik var ama fiyat hâlâ dip bölgesinde.';
  } else {
    vd = 'LONG';
    sub = 'Üç faz tamam. Stop süpürme fitiğinin altında, boyutu ona göre küçült.';
  }

  const X = extras(m, 'L', ctx);
  const qual = Math.round((typeOk / 2) * 26 + (exN / 5) * 34 + (trN / 4) * 26 + (X.ratio === null ? 0.5 : X.ratio) * 14);
  let grade = typeOk === 2 && exN >= 4 && trN >= 1 ? 'A' : typeOk === 2 && exN >= 3 ? 'B' : exN >= 3 ? 'C' : 'D';
  grade = gradeAdj(grade, X);
  return { dir: 'L', type, typeOk, EX, TR, V, X, exN, trN, vd, sub, qual, grade };
}

export const VERDICT_LIVE = ['SHORT', 'LONG'];
export const VERDICT_WATCH = ['TETİK BEKLE', 'TÜKENME BEKLE'];
