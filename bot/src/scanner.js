// Tarayıcı: aday coinleri bulur, analiz eder, onay geçenleri sinyale çevirir.
import { CFG, ENV, gradeAtLeast } from './config.js';
import {
  loadTickers, loadExchangeInfo, btcChg15, btcShock, dvol, regime,
  loadDepth, rvol, beta, fundingHist, PREC,
} from './binance.js';
import { analyze } from './analyze.js';
import { decide, decideLong, VERDICT_LIVE, VERDICT_WATCH } from './decide.js';
import { planOf, costR } from './plan.js';
import { sectorOf } from './sector.js';
import { collectTape } from './tape.js';
import { pool, log, warn, err, fmt, pct, decFor, seans } from './util.js';
import * as db from './db.js';
import { riskGate } from './tracker.js';

// Piyasa bağlamı — tarama turları arasında paylaşılır
export const MARKET = {
  tick: [], btc15: null, shock: null, dvol: null, reg: null,
  breadth: null, lastScan: 0, scanned: 0, watchlist: [], ready: false,
};

export async function warmup() {
  const n = await loadExchangeInfo();
  log(`exchangeInfo yüklendi: ${n} sembol`);
  await refreshMarket();
  MARKET.ready = true;
}

export async function refreshMarket() {
  const [tick, btc15, shock, dv, reg] = await Promise.all([
    loadTickers().catch((e) => { warn('ticker:', e.message); return MARKET.tick; }),
    btcChg15(), btcShock(), dvol(), regime(),
  ]);
  MARKET.tick = tick || [];
  MARKET.btc15 = btc15;
  MARKET.shock = shock;
  if (dv) MARKET.dvol = dv;
  if (reg) MARKET.reg = reg;
  const up = MARKET.tick.filter((x) => x.c >= 5).length;
  const dn = MARKET.tick.filter((x) => x.c <= -5).length;
  const n = MARKET.tick.length || 1;
  MARKET.breadth = {
    up, dn, n,
    note: up / n > 0.25 ? 'RİSK-ON · short fade tehlikeli'
      : dn / n > 0.25 ? 'RİSK-OFF · long fade tehlikeli'
      : 'nötr',
  };
  return MARKET;
}

function baseCtx() {
  return {
    market: MARKET.breadth,
    dvol: MARKET.dvol,
    shock: MARKET.shock,
    macro: null,       // makro takvim bağlanırsa buraya
  };
}

// Aynı coin+yön için zaten açık sinyal var mı / soğuma süresi geçti mi
async function cooling(symbol, dir) {
  try {
    const r = await db.lastSignalFor(symbol, dir);
    const last = r?.[0];
    if (!last) return false;
    if (db.AKTIF(last)) return true;                       // zaten takipte
    if (last.closed_at && Date.now() - Date.parse(last.closed_at) < CFG.reSignalMin * 6e4) return true;
    if (!last.closed_at && Date.now() - Date.parse(last.created_at) < CFG.reSignalMin * 6e4) return true;
    return false;
  } catch (e) {
    warn('cooling kontrolu:', e.message);
    return false;
  }
}

/* Bir adayı derinlemesine değerlendir: emir defteri, sektör, RVOL, beta ve
   (açıksa) canlı tape ile zenginleştirip kararı yeniden hesapla. */
async function deepCheck(m, dir, btc15) {
  const ctx = baseCtx();
  const [dp, sect, rv, bt, fh] = await Promise.all([
    loadDepth(m.sym, m.lastAtr, m.last.c),
    sectorOf(m.sym),
    rvol(m.sym),
    beta(m.k.map((x) => x.c), m.tf),
    fundingHist(m.sym, 8),
  ]);
  ctx.depth = dp;
  ctx.rvolV = rv;
  ctx.betaV = bt;
  ctx.fundHist = fh;
  m.sect = sect;

  if (ENV.wsConfirm) {
    const tape = await collectTape(m.sym, ENV.wsConfirmSec);
    if (tape) ctx.tape = tape;
  }

  const d = dir === 'S' ? decide(m, btc15, ctx) : decideLong(m, btc15, ctx);
  return { d, ctx };
}

function buildRow(m, dir, d, P) {
  const isS = dir === 'S';
  const D = decFor(P.en, m.sym, PREC);
  const leg = isS ? m.pumpPct : -m.DN.leg;
  const oi = isS ? m.oiChg : m.DN.oiChg;
  const ratio = isS ? m.ratio : m.DN.ratio;
  const retr = isS ? -m.pull : m.DN.bounce;
  const sweep = isS ? !!m.sweep : !!m.DN.sweep;
  const why = [
    (isS ? 'imp ' : 'dump ') + pct(leg),
    'OI ' + pct(oi),
    ratio === null ? 'f/OI —' : 'f/OI ' + fmt(ratio, 1) + '×',
    (isS ? 'tepeden ' : 'dipten ') + pct(retr),
  ].join(' · ');
  const trg = d.TR.filter((x) => x[2]).map((x) => x[0]).join(', ') || 'tetik yok';

  return {
    key: `${m.sym}${dir}${Date.now()}`,
    symbol: m.sym, dir, tf: m.tf,
    grade: d.grade, type: d.type, verdict: d.vd, qual: d.qual,
    entry: P.en, stop: P.st, tp1: P.t1, tp2: P.t2, tp1_label: P.t1ad,
    rr: P.rr, risk_pct: P.riskPct, qty: P.qty, decimals: D,
    ex_n: d.exN, tr_n: d.trN,
    teyit_ps: d.X.ps, teyit_av: d.X.av,
    why, trg,
    leg, oi_chg: oi, oi_ratio: ratio, sweep,
    atr_pct: m.atrPct, vol_ratio: m.volRatio,
    bars_stop: P.barsStop, bars_tp: P.barsTp,
    cost_r: costR(P.en, P.st),
    session: seans(),
    status: 'takip',
    created_at: new Date().toISOString(),
  };
}

/* Tek tarama turu.
   onSignal(row) — yeni sinyal kaydedildiğinde çağrılır (VIP'e yayın için). */
export async function scanOnce(onSignal) {
  const t0 = Date.now();
  await refreshMarket();
  const btc15 = MARKET.btc15;

  const dirSel = ENV.scanDir;
  const minChg = ENV.scanMinChg;
  const top = ENV.scanTop;
  const cands = [];
  if (dirSel !== 'L') {
    MARKET.tick.filter((x) => x.c >= minChg).sort((a, b) => b.c - a.c).slice(0, top)
      .forEach((x) => cands.push({ ...x, dir: 'S' }));
  }
  if (dirSel !== 'S') {
    MARKET.tick.filter((x) => x.c <= -minChg).sort((a, b) => a.c - b.c).slice(0, top)
      .forEach((x) => cands.push({ ...x, dir: 'L' }));
  }

  const watch = [];
  const fired = [];

  // 1) Hızlı tur: sadece mum/OI verisiyle ön eleme (defter/tape yok)
  const pass = [];
  await pool(cands, 4, async (t) => {
    if (await cooling(t.s, t.dir)) return;
    let m;
    try {
      m = await analyze(t.s, ENV.tf, { limit: 140, ticker24: t });
    } catch (e) {
      return; // yetersiz mum vb. — sessizce atla
    }
    const d = t.dir === 'S' ? decide(m, btc15, baseCtx()) : decideLong(m, btc15, baseCtx());
    if (VERDICT_LIVE.includes(d.vd)) {
      pass.push({ m, dir: t.dir, pre: d });
    } else if (VERDICT_WATCH.includes(d.vd)) {
      const P = planOf(m, t.dir);
      watch.push({
        symbol: m.sym, dir: t.dir, verdict: d.vd, grade: d.grade,
        ex_n: d.exN, tr_n: d.trN, trg: d.TR.filter((x) => x[2]).map((x) => x[0]).join(', '),
        entry: P.en, stop: P.st, decimals: decFor(P.en, m.sym, PREC), qual: d.qual,
      });
    }
  });

  MARKET.scanned = cands.length;
  MARKET.watchlist = watch
    .sort((a, b) => (b.verdict === 'TETİK BEKLE' ? 1 : 0) - (a.verdict === 'TETİK BEKLE' ? 1 : 0) || b.qual - a.qual);

  // 2) Derin tur: ön elemeyi geçenleri defter + tape ile teyit et
  for (const c of pass) {
    try {
      const gate = await riskGate();
      const { d } = await deepCheck(c.m, c.dir, btc15);

      if (!VERDICT_LIVE.includes(d.vd)) {
        log(`derin kontrolde düştü: ${c.m.sym} ${c.dir} -> ${d.vd}`);
        continue;
      }
      if (!gradeAtLeast(d.grade, ENV.minGradeVip)) {
        log(`sınıf yetersiz: ${c.m.sym} ${c.dir} ${d.grade} < ${ENV.minGradeVip}`);
        continue;
      }
      if (await cooling(c.m.sym, c.dir)) continue;

      const P = planOf(c.m, c.dir, null);
      const row = buildRow(c.m, c.dir, d, P);

      if (gate.skip) {
        row.status = 'atlandı';
        row.skip_why = gate.skip;
        await db.insertSignal(row).catch((e) => warn('atlanan kayıt:', e.message));
        log(`risk kapısı (${gate.skip}): ${c.m.sym} ${c.dir} kaydedildi ama yayınlanmadı`);
        continue;
      }

      const saved = await db.insertSignal(row);
      const rec = Array.isArray(saved) ? saved[0] : row;
      fired.push(rec);
      log(`SİNYAL ${row.symbol} ${row.dir} ${row.grade} · R:R ${fmt(row.rr, 2)} · ${row.trg}`);
      if (onSignal) await onSignal(rec);
    } catch (e) {
      err(`derin kontrol ${c.m.sym}: ${e.message}`);
    }
  }

  MARKET.lastScan = Date.now();
  log(`tarama bitti · ${cands.length} aday · ${pass.length} ön onay · ${fired.length} sinyal · ${watch.length} izlemede · ${((Date.now() - t0) / 1000).toFixed(0)}sn`);
  return { fired, watch, scanned: cands.length, ms: Date.now() - t0 };
}
