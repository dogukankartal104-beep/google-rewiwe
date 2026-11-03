// analyze(): bir coin için tüm ölçümleri çıkarır. HUD'daki analyze() portu.
import { CFG } from './config.js';
import { api, FAPI, SAPI, oiP, toK, ONBOARD } from './binance.js';
import { ema, atr, cvdOf, zigzag, findSetup, findSetupDown, oldPeaks, levels, volProfile } from './indicators.js';

export async function analyze(sym, tf, { limit = 140, endTime, ticker24 = null, sector = null } = {}) {
  const [kl, oiRaw, prem, tk, tp, spotK] = await Promise.all([
    api('/fapi/v1/klines', { symbol: sym, interval: tf, limit, endTime }),
    api('/futures/data/openInterestHist', { symbol: sym, period: oiP(tf), limit: 500, endTime }).catch(() => []),
    api('/fapi/v1/premiumIndex', { symbol: sym }).catch(() => null),
    api('/futures/data/takerlongshortRatio', { symbol: sym, period: oiP(tf), limit: 30, endTime }).catch(() => []),
    api('/futures/data/topLongShortPositionRatio', { symbol: sym, period: oiP(tf), limit: 30, endTime }).catch(() => []),
    api('/api/v3/klines', { symbol: sym, interval: tf, limit: 200, endTime }, SAPI).catch(() => null),
  ]);

  const k = toK(kl);
  if (k.length < 40) throw new Error(sym + ': yetersiz mum (' + k.length + ')');

  const cl = k.map((x) => x.c);
  const e21 = ema(cl, 21), e50 = ema(cl, 50), e200 = ema(cl, 200), A = atr(k, 14);
  const last = k[k.length - 1];
  const lastAtr = A[A.length - 1] || last.c * 0.01;
  const cvd = cvdOf(k);

  const ZZ = zigzag(k, A, CFG.zz);
  const SU = findSetup(k, A, ZZ);
  const pi = SU.pi, si = SU.si, pc = k[pi];
  const preLow = SU.low, spikeHigh = SU.high;
  const pumpPct = ((spikeHigh - preLow) / preLow) * 100;
  const cAtr = (pc.h - pc.l) / (A[pi - 1] || lastAtr);
  const pull = ((spikeHigh - last.c) / spikeHigh) * 100;
  const wick = (pc.h - Math.max(pc.o, pc.c)) / ((pc.h - pc.l) || 1);

  // anchored VWAP (pump başından)
  let pv = 0, pvv = 0;
  const anch = SU.loI;
  const avwap = k.map((x, i) => {
    if (i < anch) return null;
    const tp3 = (x.h + x.l + x.c) / 3;
    pv += tp3 * x.v; pvv += x.v;
    return pv / pvv;
  });

  // --- Open Interest ---
  const oi = (oiRaw || []).map((o) => ({ t: +o.timestamp, v: +o.sumOpenInterest, u: +o.sumOpenInterestValue }));
  let oiChg = null, oiBleed = null;
  if (oi.length) {
    const at = (ts) => { let b = null; for (const p of oi) if (p.t <= ts) b = p; return b || oi[0]; };
    const s = at(pc.t).v, pk = at(k[si].t + 6e4).v, nw = oi[oi.length - 1].v;
    oiChg = ((pk - s) / s) * 100;
    oiBleed = ((nw - pk) / pk) * 100;
  }
  const ratio = oiChg !== null && Math.abs(oiChg) > 0.05 ? pumpPct / Math.abs(oiChg) : null;
  const oiUsd = oi.length ? oi[oi.length - 1].u : null;
  const oiPerVol = oiUsd && ticker24?.v ? oiUsd / ticker24.v : null;

  const cvdFall = cvd[cvd.length - 1] < cvd[si];
  const after = k.slice(si + 1);
  const structOk = after.length >= 2 && Math.max(...after.map((x) => x.h)) < spikeHigh && last.c < spikeHigh;
  const volR = last.v / (pc.v || 1);
  const takerNow = tk.length ? +tk[tk.length - 1].buySellRatio : null;
  const takerPrev = tk.length > 4 ? +tk[tk.length - 5].buySellRatio : null;
  const topNow = tp.length ? +tp[tp.length - 1].longShortRatio : null;

  // --- tetikler (short tarafı) ---
  const near = after.slice(-4);
  const t_retest = near.length >= 2
    && near.some((x) => x.h >= spikeHigh * (1 - CFG.retestZone / 100) && x.h < spikeHigh)
    && last.c < last.o;
  const firstHL = after.length > 2
    ? Math.min(...after.slice(0, Math.min(4, after.length)).map((x) => x.l))
    : null;
  const t_break = firstHL !== null && last.c < firstHL;
  const av = avwap[avwap.length - 1];
  const t_vwap = av !== null && last.c < av;

  /* LİKİDİTE SÜPÜRMESİ: önceki 12 mumun tepesini kıran ama altında kapanan mum.
     Stop'ların toplandığı ve reddedildiği an — fade için en kaliteli tetik. */
  let sweep = null;
  for (let i = Math.max(20, k.length - 8); i < k.length; i++) {
    const pm = Math.max(...k.slice(i - 12, i).map((x) => x.h));
    if (k[i].h > pm && k[i].c < pm) sweep = { i, h: k[i].h, lvl: pm };
  }

  // --- coine özel oynaklık profili ---
  const atrPct = (lastAtr / last.c) * 100;
  const As = A.slice(-60).filter(Boolean).slice().sort((a, b) => a - b);
  const atrMed = As.length ? As[Math.floor(As.length / 2)] : lastAtr;
  const volRatio = atrMed ? lastAtr / atrMed : 1;
  const bodyPct = k.slice(-50).reduce((a, x) => a + (Math.abs(x.c - x.o) / x.o) * 100, 0) / Math.min(50, k.length);
  const day = k.slice(-96);
  const rngDay = day.length
    ? ((Math.max(...day.map((x) => x.h)) - Math.min(...day.map((x) => x.l))) / last.c) * 100
    : null;
  const stopMult = Math.min(CFG.volCap, Math.max(CFG.stopAtr, CFG.stopAtr * volRatio));
  const huntTop = spikeHigh + CFG.huntAtr * lastAtr * Math.min(volRatio, 2);

  /* Stop adayları: yerel tepe, süpürme fitiği, asıl tepe. En DAR seçilir,
     ama ATR tabanının altına inemez. */
  const recHigh = Math.max(...k.slice(-CFG.stopLook).map((x) => x.h));
  const stopCands = [recHigh + 0.35 * lastAtr, spikeHigh + stopMult * lastAtr];
  if (sweep) stopCands.push(sweep.h + 0.4 * lastAtr);
  const floorS = last.c * (1 + (CFG.minStopAtr * atrPct) / 100);
  const stopPx = Math.max(floorS, Math.min(...stopCands));

  const vp = volProfile(k, 200, 60);
  const volAvg = k.slice(-50).reduce((a, x) => a + x.v, 0) / Math.min(50, k.length);
  const peaks = oldPeaks(k, A, ZZ, si);

  // likidasyon seviyeleri (kaldıraç bantları)
  const liqLv = [];
  if (av) [10, 25, 50].forEach((L) => liqLv.push({ p: av * (1 - 1 / L), long: true, lbl: 'L' + L + 'x' }));
  [10, 25].forEach((L) => liqLv.push({ p: last.c * (1 + 1 / L), long: false, lbl: 'S' + L + 'x' }));

  // üst zaman dilimi eğilimi (4x TF)
  const agg = [];
  for (let i = k.length % 4; i < k.length; i += 4) {
    const g = k.slice(i, i + 4);
    if (g.length < 4) break;
    agg.push(g[3].c);
  }
  const aggE = ema(agg, 21);
  const htfBias = agg.length && aggE[aggE.length - 1]
    ? agg[agg.length - 1] >= aggE[aggE.length - 1] ? 'yukarı' : 'aşağı'
    : null;

  // ================= LONG tarafı (dump-fade) =================
  const SD = findSetupDown(k, A, ZZ);
  const di = SD.si, dpi = SD.pi, dc = k[dpi];
  const dipLow = SD.low, dumpTop = SD.high;
  const dumpPct = ((dumpTop - dipLow) / dumpTop) * 100;
  const bounce = ((last.c - dipLow) / dipLow) * 100;
  const wickD = (Math.min(dc.o, dc.c) - dc.l) / ((dc.h - dc.l) || 1);

  let oiChgD = null, oiBleedD = null;
  if (oi.length) {
    const at = (ts) => { let b = null; for (const q of oi) if (q.t <= ts) b = q; return b || oi[0]; };
    const s0 = at(k[SD.hiI].t).v, sd = at(k[di].t + 6e4).v, nw = oi[oi.length - 1].v;
    oiChgD = ((sd - s0) / s0) * 100;
    oiBleedD = ((nw - sd) / sd) * 100;
  }
  const ratioD = oiChgD !== null && Math.abs(oiChgD) > 0.05 ? dumpPct / Math.abs(oiChgD) : null;
  const aftD = k.slice(di + 1);

  let sweepD = null;
  for (let i = Math.max(20, k.length - 8); i < k.length; i++) {
    const pm = Math.min(...k.slice(i - 12, i).map((x) => x.l));
    if (k[i].l < pm && k[i].c > pm) sweepD = { i, l: k[i].l, lvl: pm };
  }

  let pvD = 0, pvvD = 0;
  const avwapD = k.map((x, i) => {
    if (i < SD.hiI) return null;
    const t3 = (x.h + x.l + x.c) / 3;
    pvD += t3 * x.v; pvvD += x.v;
    return pvD / pvvD;
  });
  const avD = avwapD[avwapD.length - 1];
  const nearD = aftD.slice(-4);

  const DN = {
    si: di, pi: dpi, low: dipLow, top: dumpTop, leg: dumpPct, bounce, wick: wickD,
    oiChg: oiChgD, oiBleed: oiBleedD, ratio: ratioD,
    cvdRise: cvd[cvd.length - 1] > cvd[di],
    structOk: aftD.length >= 2 && Math.min(...aftD.map((x) => x.l)) > dipLow && last.c > dipLow,
    volR: last.v / (dc.v || 1),
    sweep: sweepD,
    cAtr: (dc.h - dc.l) / (A[dpi - 1] || lastAtr),
    av: avD,
    solid: SD.solid,
    t_retest: nearD.length >= 2
      && nearD.some((x) => x.l <= dipLow * (1 + CFG.retestZone / 100) && x.l > dipLow)
      && last.c > last.o,
    t_break: aftD.length > 2
      ? last.c > Math.max(...aftD.slice(0, Math.min(4, aftD.length)).map((x) => x.h))
      : false,
    t_vwap: avD !== null && last.c > avD,
    huntBot: dipLow - CFG.huntAtr * lastAtr * Math.min(volRatio, 2),
    stopPx: (() => {
      const recLow = Math.min(...k.slice(-CFG.stopLook).map((x) => x.l));
      const c2 = [recLow - 0.35 * lastAtr, dipLow - stopMult * lastAtr];
      if (sweepD) c2.push(sweepD.l - 0.4 * lastAtr);
      return Math.min(last.c * (1 - (CFG.minStopAtr * atrPct) / 100), Math.max(...c2));
    })(),
  };

  // spot payı: kaldıraçsız alım/satım oranı
  let spotShare = null, spotVol = null, perpVol = null;
  if (spotK && spotK.length) {
    const t0 = k[Math.min(pi, di)].t;
    spotVol = spotK.filter((r) => +r[0] >= t0).reduce((a, r) => a + +r[7], 0);
    perpVol = k.filter((x) => x.t >= t0).reduce((a, x) => a + x.q, 0);
    if (spotVol + perpVol > 0) spotShare = (spotVol / (spotVol + perpVol)) * 100;
  }

  const onb = ONBOARD[sym] ? Math.floor((Date.now() - ONBOARD[sym]) / 864e5) : null;

  return {
    sym, tf, k, e21, e50, e200, A, cvd, oi, avwap, last, lastAtr,
    pi, si, pc, preLow, spikeHigh, pumpPct, cAtr, pull, wick,
    oiChg, oiBleed, ratio, cvdFall, structOk, volR, takerNow, takerPrev, topNow, firstHL, av,
    funding: prem ? +prem.lastFundingRate * 100 : null,
    nextF: prem ? +prem.nextFundingTime : null,
    mark: prem ? +prem.markPrice : null,
    index: prem ? +prem.indexPrice : null,
    estFund: (() => {
      if (!prem || !+prem.indexPrice) return null;
      const pm = (+prem.markPrice - +prem.indexPrice) / +prem.indexPrice;
      const c = Math.max(-0.0005, Math.min(0.0005, 0.0001 - pm));
      return (pm + c) * 100;
    })(),
    t_retest, t_break, t_vwap, onb,
    sr: levels(k, A), peaks, volAvg, liqLv, vp,
    sect: sector, oiUsd, oiPerVol, spotShare, spotVol, perpVol,
    atrPct, volRatio, bodyPct, rngDay, stopMult,
    solid: SU.solid, loI: SU.loI, sweep, huntTop, stopPx, DN, htfBias,
  };
}
