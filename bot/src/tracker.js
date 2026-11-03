// Sinyal takibi: mum mum yeniden oynatma. HUD'daki stepTrack portu.
// Idempotent — her çağrıda baştan hesaplar, kaçan bir tur sonucu bozmaz.
import { CFG } from './config.js';
import { api, toK, TFM } from './binance.js';
import { pool, log, warn } from './util.js';
import * as db from './db.js';

/* Mum içi sıra bilinmediğinden muhafazakâr davranır: önce stop, sonra hedef.
   TP1 sonrası başabaş stop bir SONRAKİ mumdan itibaren geçerli sayılır. */
export function stepTrack(sig, k, mins) {
  const L = sig.dir === 'L';
  const t0 = Date.parse(sig.created_at);
  const en = sig.entry, stop0 = sig.stop, t1 = sig.tp1, t2 = sig.tp2;
  const risk = Math.abs(stop0 - en) || 1;
  const rOf = (px) => (L ? (px - en) / risk : (en - px) / risk);
  const rr1 = Math.abs(t1 - en) / risk;
  const rr2 = t2 != null && Number.isFinite(t2) && (L ? t2 > t1 : t2 < t1)
    ? Math.abs(t2 - en) / risk : null;
  const frac = CFG.partialOn ? Math.min(0.95, Math.max(0.05, CFG.tp1Frac)) : 1;
  const cost = sig.cost_r || 0;

  let filled = sig.mode !== 'limit';
  let stop = stop0, part = false, acc = 0, left = 1;
  let maxR = 0, minR = 0, lastPx = en;
  const limitDl = t0 + CFG.limitWaitBars * mins * 6e4;
  const dl = t0 + CFG.trackBars * mins * 6e4;

  const fin = (status, r, px, t) => ({
    status, r, r_net: r - cost, close_px: px,
    closed_at: new Date(t).toISOString(),
    max_r: maxR, min_r: minR, partial: part, open_r: 0, last_px: px,
  });

  for (const b of k) {
    if (b.t + mins * 6e4 <= t0) continue;          // sinyalden önceki mumlar
    if (!filled) {                                  // limit emri doldu mu
      if (L ? b.l <= en : b.h >= en) filled = true;
      else {
        if (b.t > limitDl) {
          const p = fin('dolmadı', 0, en, b.t);
          p.r_net = 0;
          return p;
        }
        continue;
      }
    }
    lastPx = b.c;
    maxR = Math.max(maxR, rOf(L ? b.h : b.l));
    minR = Math.min(minR, rOf(L ? b.l : b.h));

    if (L ? b.l <= stop : b.h >= stop) {            // 1) stop (muhafazakâr)
      const r = acc + left * rOf(stop);
      return fin(r > 0 ? 'kazanç' : 'kayıp', r, stop, b.t);
    }
    if (rr2 && (L ? b.h >= t2 : b.l <= t2)) {       // 2) TP2
      return fin('kazanç', acc + left * rr2, t2, b.t);
    }
    if (!part && (L ? b.h >= t1 : b.l <= t1)) {     // 3) TP1
      if (frac >= 1) return fin('kazanç', rr1, t1, b.t);
      acc += frac * rr1;
      left = 1 - frac;
      part = true;
      if (CFG.beAfterTp1) stop = en;
    }
    if (b.t >= dl) {                                // 4) süre doldu
      const r = acc + left * rOf(b.c);
      return fin('zaman', r, b.c, b.t);
    }
  }

  // hâlâ açık
  return {
    status: filled ? 'takip' : 'bekliyor',
    max_r: maxR, min_r: minR, partial: part, last_px: lastPx,
    open_r: acc + left * rOf(lastPx),
    stop_now: stop,       // TP1 sonrası başabaşa çekildiyse burada görünür
  };
}

/* Açık sinyalleri Binance'ten mum çekip güncelle.
   onClose(sig, patch) kapanan her sinyal için çağrılır (sonuç kartı yayınlamak için). */
export async function resolveOpen(onClose) {
  let open;
  try { open = await db.openSignals(); }
  catch (e) { warn('resolveOpen: açık sinyaller okunamadı:', e.message); return []; }
  if (!open?.length) return [];

  const closed = [];
  await pool(open, 4, async (sig) => {
    const iv = sig.tf || '15m';
    const mins = TFM[iv] || 15;
    try {
      const rows = await api('/fapi/v1/klines', {
        symbol: sig.symbol,
        interval: iv,
        startTime: Date.parse(sig.created_at) - mins * 6e4,
        limit: Math.min(500, CFG.trackBars + CFG.limitWaitBars + 10),
      });
      const k = toK(rows);
      if (!k.length) return;
      const patch = stepTrack(sig, k, mins);
      await db.patchSignal(sig.key, patch);
      if (patch.closed_at) {
        closed.push({ ...sig, ...patch });
        log(`kapandı ${sig.symbol} ${sig.dir} -> ${patch.status} ${patch.r_net?.toFixed(2)}R`);
      }
    } catch (e) {
      warn(`takip ${sig.symbol}: ${e.message}`);
    }
  });

  if (onClose) {
    for (const c of closed) {
      try { await onClose(c); } catch (e) { warn('onClose', e.message); }
    }
  }
  return closed;
}

// ---- risk kapıları ----
export async function riskGate() {
  try {
    const open = await db.openSignals();
    const d0 = new Date(); d0.setUTCHours(0, 0, 0, 0);
    const today = await db.closedBetween(d0.toISOString(), new Date(Date.now() + 864e5).toISOString());
    const todayR = (today || []).filter(db.SAYILIR).reduce((a, x) => a + (db.netOf(x) || 0), 0);
    if (todayR <= CFG.dailyStopR) return { skip: 'gün limiti', openN: open?.length || 0, todayR };
    if ((open?.length || 0) >= CFG.maxOpen) return { skip: 'pozisyon dolu', openN: open.length, todayR };
    return { skip: null, openN: open?.length || 0, todayR };
  } catch (e) {
    warn('riskGate', e.message);
    return { skip: null, openN: 0, todayR: 0 };
  }
}

// ---- istatistik özeti (rapor motoru kullanır) ----
export function stats(rows) {
  const done = (rows || []).filter(db.SAYILIR);
  const R = done.map(db.netOf).filter((v) => Number.isFinite(v));
  const n = R.length;
  const tot = R.reduce((a, v) => a + v, 0);
  const avg = n ? tot / n : 0;
  const win = done.filter((x) => db.netOf(x) > 0).length;
  const loss = done.filter((x) => db.netOf(x) < 0).length;
  const flat = n - win - loss;
  const gross = done.reduce((a, x) => a + (x.r || 0), 0);
  const sd = n > 1 ? Math.sqrt(R.reduce((a, v) => a + (v - avg) ** 2, 0) / (n - 1)) : 0;
  const se = n ? sd / Math.sqrt(n) : 0;
  const wins = done.filter((x) => db.netOf(x) > 0).map(db.netOf);
  const losses = done.filter((x) => db.netOf(x) < 0).map((x) => Math.abs(db.netOf(x)));
  const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
  const pf = losses.length && avgLoss
    ? wins.reduce((a, b) => a + b, 0) / losses.reduce((a, b) => a + b, 0)
    : null;
  // en iyi / en kötü
  const sorted = done.slice().sort((a, b) => db.netOf(b) - db.netOf(a));
  // maksimum düşüş (sıralı R eğrisinde)
  let peak = 0, cum = 0, mdd = 0;
  done.slice().sort((a, b) => Date.parse(a.closed_at) - Date.parse(b.closed_at))
    .forEach((x) => { cum += db.netOf(x); peak = Math.max(peak, cum); mdd = Math.min(mdd, cum - peak); });
  // sınıf kırılımı
  const byGrade = {};
  done.forEach((x) => {
    const g = x.grade || '?';
    byGrade[g] = byGrade[g] || { n: 0, r: 0, win: 0 };
    byGrade[g].n++; byGrade[g].r += db.netOf(x);
    if (db.netOf(x) > 0) byGrade[g].win++;
  });
  const byDir = {};
  done.forEach((x) => {
    const d = x.dir === 'L' ? 'LONG' : 'SHORT';
    byDir[d] = byDir[d] || { n: 0, r: 0, win: 0 };
    byDir[d].n++; byDir[d].r += db.netOf(x);
    if (db.netOf(x) > 0) byDir[d].win++;
  });
  return {
    n, tot, avg, win, loss, flat, gross, sd, se, pf, avgWin, avgLoss, mdd,
    winPct: n ? (win / n) * 100 : 0,
    best: sorted[0] || null,
    worst: sorted[sorted.length - 1] || null,
    byGrade, byDir,
    tpHit: done.filter((x) => x.status === 'kazanç').length,
    stopHit: done.filter((x) => x.status === 'kayıp').length,
    timeOut: done.filter((x) => x.status === 'zaman').length,
    usd: tot * (CFG.acct * CFG.riskPct / 100),
  };
}
