// Stop / hedef / pozisyon boyutu — HUD'daki planOf + planTargets portu.
import { CFG } from './config.js';
import { barsFor } from './indicators.js';
import { decFor } from './util.js';
import { PREC } from './binance.js';

/* Likidasyon kaskadı: fiyatın önündeki likidasyon yakıtı ile emir defteri
   derinliğini bant bant karşılaştırır. Defterin yakıtı yuttuğu yer "kaskad durağı". */
export function cascade(m, side, depth) {
  if (!depth?.bids || !m.oiUsd) return null;
  const L = side === 'L', px = m.last.c, atrv = m.lastAtr;
  const anchor = L ? m.DN.av || px : m.av || px;
  const LEV = [[10, 0.40], [25, 0.35], [50, 0.25]];
  const rows = [];
  let cumLiq = 0, cumBook = 0, stopAt = null;
  for (let i = 1; i <= 8; i++) {
    const lo = L ? px + atrv * 0.6 * (i - 1) : px - atrv * 0.6 * (i - 1);
    const hi = L ? px + atrv * 0.6 * i : px - atrv * 0.6 * i;
    let liq = 0;
    LEV.forEach(([lev, shr]) => {
      const lp = L ? anchor * (1 + 1 / lev) : anchor * (1 - 1 / lev);
      if (L ? lp > lo && lp <= hi : lp < lo && lp >= hi) liq += m.oiUsd * shr * 0.5;
    });
    const book = (L ? depth.asks : depth.bids)
      .filter(([p2]) => (L ? p2 > lo && p2 <= hi : p2 < lo && p2 >= hi))
      .reduce((a, [p2, q]) => a + p2 * q, 0);
    cumLiq += liq; cumBook += book;
    if (stopAt === null && cumBook > cumLiq && i > 1) stopAt = hi;
    rows.push({ lo, hi, liq, book, cumLiq, cumBook });
  }
  return { rows, stopAt };
}

export function planOf(m, side, depth = null) {
  const L = side === 'L', mkt = m.last.c;
  const D = decFor(mkt, m.sym, PREC);
  const atrv = m.lastAtr;
  const structSt = L ? m.DN.stopPx : m.stopPx;

  // STOP: coinin kendi gürültü birimiyle (ATR) sınırlanır
  let dist = Math.abs(structSt - mkt);
  const dMin = CFG.minStopAtr * atrv, dMax = CFG.maxStopAtr * atrv;
  const tooFar = dist > dMax; // yapı çok uzak = geç kalınmış
  dist = Math.max(dMin, Math.min(dMax, dist));
  const st = L ? mkt - dist : mkt + dist;
  const risk = dist || mkt * 0.005;

  return planTargets(m, side, {
    en: mkt, st, mkt, mode: 'piyasa', risk, D, atr: atrv,
    stopAtr: risk / atrv, tooFar, structSt,
    structAtr: Math.abs(structSt - mkt) / atrv,
    riskPct: ((st - mkt) / mkt) * 100,
    structPct: ((structSt - mkt) / mkt) * 100,
  }, depth);
}

export function planTargets(m, side, B, depth = null) {
  const L = side === 'L';
  const { en, risk, atr: atrv } = B;

  // HEDEF ADAYLARI — gerçek veriden, öncelik (w) sırasıyla
  const C = [];
  const push = (p, ad, w) => {
    if (p && Number.isFinite(p) && (L ? p > en : p < en)) C.push({ p, ad, w });
  };
  const cs = cascade(m, side, depth);
  if (cs?.stopAt) push(cs.stopAt, 'kaskad durağı', 1);
  if (depth?.walls) depth.walls.filter((w) => (L ? w.ask : !w.ask)).forEach((w) => push(w.p, 'defter duvarı', 2));
  push(m.vp.poc, 'POC', 3);
  push(L ? m.vp.vah : m.vp.val, L ? 'VA üst' : 'VA alt', 3);
  push(L ? (m.DN.low + m.DN.top) / 2 : (m.spikeHigh + m.preLow) / 2, '%50 fib', 4);
  push(L ? m.DN.av : m.av, 'aVWAP', 4);
  push(m.e21[m.e21.length - 1], 'EMA21', 5);
  push(m.e50[m.e50.length - 1], 'EMA50', 5);
  m.sr.forEach((x) => push(x.p, L ? 'direnç' : 'destek', 5));
  push(L ? m.DN.top : m.preLow, L ? 'dump tepesi' : 'impulse dibi', 6);

  C.forEach((x) => { x.r = Math.abs(x.p - en) / risk; });

  /* Seçim: önce ULAŞILABİLİRLİK (mesafe + süre), sonra kaynak kalitesi.
     Hedefin tipik süresi, stopun tipik süresinin tpBarRatio katını geçemez. */
  const bStop = barsFor(risk, atrv);
  const bMax = Math.max(4, CFG.tpBarRatio * bStop);
  let usable = C.filter((x) =>
    x.r >= CFG.rrTarget * 0.97 && x.r <= CFG.maxTpR && barsFor(Math.abs(x.p - en), atrv) <= bMax
  ).sort((a, b) => a.r - b.r);

  if (usable.length) {
    const nearR = usable[0].r;
    usable = usable.filter((x) => x.r <= nearR + 0.15).sort((a, b) => a.w - b.w);
  }

  const raw = L ? en + risk * CFG.rrTarget : en - risk * CFG.rrTarget;
  let t1o = usable[0] || {
    p: raw, ad: CFG.rrTarget.toFixed(1) + 'R (uygun seviye yok)', r: CFG.rrTarget,
  };

  // hedef bir LVN içine düşüyorsa fiyat orada durmaz — düğümün öbür ucuna taşı
  (m.vp.lvn || []).forEach((g) => {
    if (t1o.p > g.a && t1o.p < g.b) {
      const edge = L ? g.b : g.a;
      const r2 = Math.abs(edge - en) / risk;
      if (r2 <= CFG.maxTpR && barsFor(Math.abs(edge - en), atrv) <= bMax * 1.5) {
        t1o = { p: edge, ad: t1o.ad + ' → LVN ötesi', r: r2 };
      }
    }
  });

  const further = C.filter((x) =>
    (L ? x.p > t1o.p : x.p < t1o.p) && x.r <= CFG.maxTpR && barsFor(Math.abs(x.p - en), atrv) <= bMax * 2
  ).sort((a, b) => a.r - b.r);

  const t2fallback = Math.min(CFG.maxTpR, CFG.rrTarget * 2);
  const t2o = further[0] || {
    p: L ? en + risk * t2fallback : en - risk * t2fallback,
    ad: t2fallback.toFixed(1) + 'R',
  };

  // hedeften ÖNCE duran engel (R:R'yi fiilen düşürür)
  const blocker = C.filter((x) => x.r < CFG.rrTarget * 0.97 && x.w <= 2).sort((a, b) => a.r - b.r)[0] || null;

  const rr = Math.abs(t1o.p - en) / risk;
  const qty = (CFG.acct * CFG.riskPct / 100) / risk;

  return {
    ...B,
    t1: t1o.p, t1ad: t1o.ad, t2: t2o.p, t2ad: t2o.ad, rr, qty, blocker,
    barsStop: barsFor(risk, atrv),
    barsTp: barsFor(Math.abs(t1o.p - en), atrv),
    lowRR: rr < 0.95,
    atrPct: m.atrPct, volRatio: m.volRatio,
    hunt: L ? m.DN.huntBot : m.huntTop,
    sweep: L ? m.DN.sweep : m.sweep,
    idealEn: en, tooWide: B.tooFar,
  };
}

// Komisyon + kayma maliyetinin R cinsinden karşılığı
export function costR(en, st) {
  const rf = Math.abs(st - en) / (en || 1);
  if (!rf || !Number.isFinite(rf)) return 0;
  return (2 * (CFG.feeBps + CFG.extraSlipBps)) / 1e4 / rf;
}
