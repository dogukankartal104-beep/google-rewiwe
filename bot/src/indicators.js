// Göstergeler ve yapı motoru — HUD'dan birebir port.
import { CFG } from './config.js';

export function ema(a, p) {
  const k = 2 / (p + 1), o = [];
  let e = null;
  for (let i = 0; i < a.length; i++) {
    e = e === null ? a[i] : a[i] * k + e * (1 - k);
    o.push(i < p - 1 ? null : e);
  }
  return o;
}

export function atr(k, p = 14) {
  const tr = k.map((c, i) =>
    i ? Math.max(c.h - c.l, Math.abs(c.h - k[i - 1].c), Math.abs(c.l - k[i - 1].c)) : c.h - c.l);
  const o = [];
  let s = 0;
  for (let i = 0; i < tr.length; i++) {
    s += tr[i];
    if (i >= p) s -= tr[i - p];
    o.push(i >= p - 1 ? s / p : null);
  }
  return o;
}

// CVD: taker alım - taker satım kümülatifi
export function cvdOf(k) {
  let cum = 0;
  return k.map((x) => { cum += 2 * x.tb - x.v; return cum; });
}

/* Fiyat, ATR'nin mult katı kadar ters yöne dönene kadar aynı bacak sayılır.
   Döndüğü an o bacağın uç noktası SWING olarak kilitlenir. */
export function zigzag(k, A, mult) {
  const out = [];
  let dir = 1, hiP = k[0].h, hiI = 0, loP = k[0].l, loI = 0;
  for (let i = 1; i < k.length; i++) {
    const th = (A[i] || A[A.length - 1] || k[i].c * 0.02) * mult;
    if (dir > 0) {
      if (k[i].h >= hiP) { hiP = k[i].h; hiI = i; }
      else if (hiP - k[i].l >= th) { out.push({ i: hiI, p: hiP, t: 'h' }); dir = -1; loP = k[i].l; loI = i; }
    } else {
      if (k[i].l <= loP) { loP = k[i].l; loI = i; }
      else if (k[i].h - loP >= th) { out.push({ i: loI, p: loP, t: 'l' }); dir = 1; hiP = k[i].h; hiI = i; }
    }
  }
  out.push(dir > 0 ? { i: hiI, p: hiP, t: 'h' } : { i: loI, p: loP, t: 'l' });
  return out;
}

// Aktif setup: en son, KIRILMAMIŞ ve bacağı >= minPumpPct olan swing tepe.
export function findSetup(k, A, ZZ) {
  const n = k.length, minBar = Math.max(0, n - CFG.searchBars);
  const hs = ZZ.filter((x) => x.t === 'h'), ls = ZZ.filter((x) => x.t === 'l');
  const biggest = (a, b) => {
    let pi = a, best = -1;
    for (let i = Math.max(1, a); i <= b; i++) {
      const at = A[i - 1] || A[i];
      if (!at) continue;
      const sc = ((k[i].h - k[i].l) / at) * (k[i].c >= k[i].o ? 1 : 0.35);
      if (sc > best) { best = sc; pi = i; }
    }
    return pi;
  };
  for (let j = hs.length - 1; j >= 0; j--) {
    const h = hs[j];
    if (h.i < minBar) break;
    const pr = ls.filter((x) => x.i < h.i);
    const lo = pr.length ? pr[pr.length - 1] : {
      i: Math.max(0, h.i - 24),
      p: Math.min(...k.slice(Math.max(0, h.i - 24), h.i + 1).map((x) => x.l)),
    };
    const leg = ((h.p - lo.p) / lo.p) * 100;
    if (leg < CFG.minPumpPct) continue;
    const aft = k.slice(h.i + 1);
    if (aft.length && Math.max(...aft.map((x) => x.h)) > h.p) continue; // tepe kırıldı
    return { pi: biggest(lo.i, h.i), si: h.i, high: h.p, low: lo.p, loI: lo.i, leg, solid: true };
  }
  const st = Math.max(0, n - 100);
  let si = st;
  for (let i = st; i < n; i++) if (k[i].h > k[si].h) si = i;
  let loI = Math.max(0, si - 30);
  for (let i = loI; i <= si; i++) if (k[i].l < k[loI].l) loI = i;
  return {
    pi: biggest(loI, si), si, high: k[si].h, low: k[loI].l, loI,
    leg: ((k[si].h - k[loI].l) / k[loI].l) * 100, solid: false,
  };
}

// Aktif dip: en son, KIRILMAMIŞ ve bacağı >= minPumpPct olan swing dip.
export function findSetupDown(k, A, ZZ) {
  const n = k.length, minBar = Math.max(0, n - CFG.searchBars);
  const ls = ZZ.filter((x) => x.t === 'l'), hs = ZZ.filter((x) => x.t === 'h');
  const biggest = (a, b) => {
    let pi = a, best = -1;
    for (let i = Math.max(1, a); i <= b; i++) {
      const at = A[i - 1] || A[i];
      if (!at) continue;
      const sc = ((k[i].h - k[i].l) / at) * (k[i].c < k[i].o ? 1 : 0.35);
      if (sc > best) { best = sc; pi = i; }
    }
    return pi;
  };
  for (let j = ls.length - 1; j >= 0; j--) {
    const lo = ls[j];
    if (lo.i < minBar) break;
    const pr = hs.filter((x) => x.i < lo.i);
    const hi = pr.length ? pr[pr.length - 1] : {
      i: Math.max(0, lo.i - 24),
      p: Math.max(...k.slice(Math.max(0, lo.i - 24), lo.i + 1).map((x) => x.h)),
    };
    const leg = ((hi.p - lo.p) / hi.p) * 100;
    if (leg < CFG.minPumpPct) continue;
    const aft = k.slice(lo.i + 1);
    if (aft.length && Math.min(...aft.map((x) => x.l)) < lo.p) continue;
    return { pi: biggest(hi.i, lo.i), si: lo.i, low: lo.p, high: hi.p, hiI: hi.i, leg, solid: true };
  }
  const st = Math.max(0, n - 100);
  let si = st;
  for (let i = st; i < n; i++) if (k[i].l < k[si].l) si = i;
  let hiI = Math.max(0, si - 30);
  for (let i = hiI; i <= si; i++) if (k[i].h > k[hiI].h) hiI = i;
  return {
    pi: biggest(hiI, si), si, low: k[si].l, high: k[hiI].h, hiI,
    leg: ((k[hiI].h - k[si].l) / k[hiI].h) * 100, solid: false,
  };
}

export function oldPeaks(k, A, ZZ, si) {
  const at = A[A.length - 1] || k[k.length - 1].c * 0.01;
  const hs = ZZ.filter((x) => x.t === 'h' && x.i !== si).sort((a, b) => b.p - a.p);
  const out = [];
  hs.forEach((h) => {
    if (!out.some((o) => Math.abs(o.p - h.p) < at * 0.8)) out.push({ i: h.i, t: k[h.i].t, p: h.p });
  });
  return out.sort((a, b) => a.i - b.i).slice(-10);
}

// Destek / direnç: fraktal tepe-dipler, ATR'ye göre kümelenmiş
export function levels(k, A) {
  const n = k.length, at = A[A.length - 1] || k[n - 1].c * 0.01, raw = [];
  for (let i = 3; i < n - 3; i++) {
    const H = k[i].h, L = k[i].l;
    if (H >= Math.max(k[i-1].h, k[i-2].h, k[i-3].h, k[i+1].h, k[i+2].h, k[i+3].h)) raw.push({ p: H, t: 'r' });
    if (L <= Math.min(k[i-1].l, k[i-2].l, k[i-3].l, k[i+1].l, k[i+2].l, k[i+3].l)) raw.push({ p: L, t: 's' });
  }
  raw.sort((a, b) => a.p - b.p);
  const cl = [];
  raw.forEach((x) => {
    const last = cl[cl.length - 1];
    if (last && Math.abs(x.p - last.sum / last.n) < at * 0.7) { last.sum += x.p; last.n++; }
    else cl.push({ sum: x.p, n: 1 });
  });
  const price = k[n - 1].c;
  return cl.map((c) => ({ p: c.sum / c.n, n: c.n }))
    .filter((c) => c.n >= CFG.srTouch)
    .sort((a, b) => Math.abs(a.p - price) - Math.abs(b.p - price))
    .slice(0, 4);
}

/* Hacim profili: her mumun hacmi low-high arasına eşit dağıtılır.
   POC, Value Area (%70) ve LVN (fiyatın kaydığı ince bantlar) çıkar. */
export function volProfile(k, bars = 200, NB = 60) {
  const win = k.slice(-bars);
  const vpLo = Math.min(...win.map((x) => x.l));
  const vpHi = Math.max(...win.map((x) => x.h));
  const bin = (vpHi - vpLo) / NB || 1;
  const B = new Array(NB).fill(0);
  win.forEach((c) => {
    const a = Math.max(0, Math.floor((c.l - vpLo) / bin));
    const b2 = Math.min(NB - 1, Math.floor((c.h - vpLo) / bin));
    const per = c.v / (b2 - a + 1);
    for (let i = a; i <= b2; i++) B[i] += per;
  });
  let pocI = 0;
  B.forEach((v, i) => { if (v > B[pocI]) pocI = i; });
  const tot = B.reduce((a, b) => a + b, 0);
  let acc = B[pocI], lo = pocI, hi = pocI;
  while (acc < tot * 0.7 && (lo > 0 || hi < NB - 1)) {
    const dn = lo > 0 ? B[lo - 1] : -1;
    const up = hi < NB - 1 ? B[hi + 1] : -1;
    if (up >= dn) { hi++; acc += B[hi]; } else { lo--; acc += B[lo]; }
  }
  const vp = { poc: vpLo + (pocI + 0.5) * bin, vah: vpLo + (hi + 1) * bin, val: vpLo + lo * bin };
  // LVN: hacmin medyanın %30'undan az olduğu ardışık bantlar
  const Bs = B.slice().sort((a, b) => a - b);
  const medB = Bs[Math.floor(NB / 2)] || 1;
  const lvn = []; let run = null;
  B.forEach((v, i) => {
    if (v < medB * 0.3) {
      if (!run) run = { a: vpLo + i * bin, b: vpLo + (i + 1) * bin };
      else run.b = vpLo + (i + 1) * bin;
    } else {
      if (run && run.b - run.a >= bin * 1.5) lvn.push(run);
      run = null;
    }
  });
  if (run && run.b - run.a >= bin * 1.5) lvn.push(run);
  vp.lvn = lvn;
  return vp;
}

// mesafe -> tipik kaç mum (rastgele yürüyüşte hareket √zaman ile ölçeklenir)
export const barsFor = (dist, atrv) => Math.max(1, Math.round((dist / atrv) ** 2));
