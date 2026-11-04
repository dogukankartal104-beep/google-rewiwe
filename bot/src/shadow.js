// Shadow (forward paper) trading of candidate engines. NOTHING in this file ever posts to a channel.
// Engine "v1k": extreme pump short (docs/v1k-motor-protokol.md). Six variants (K0..K5) are recorded side by side so the
// scorecard can show which parts of the rule really help. Every signal also stores a rich feature snapshot for later research.
import { ENV } from './config.js';
import * as db from './db.js';
import { api, klines } from './binance.js';
import { MARKET } from './scanner.js';
import { log, warn } from './util.js';
import * as tg from './telegram.js';
import * as M from './messages.js';
import { profitChartPng, levelChartPng, CHART_COLORS } from './chart.js';
import { notifyAdmins } from './vip.js';
import { engineEntry, FILTER_OI15, VARIANTS } from '../bt/v1/engine.js';
import { mtfFeatures } from '../bt/v1/mtf.js';

const M15 = 9e5, MIN = 6e4, HOUR = 36e5, DAY = 864e5;
export const ENGINE = 'v1k';
const GATE_N = 30;

/* ------------------------------------------------------------------ pure parts (unit-tested) */

/* k15: closed 15m candles ending with the signal candle (at least 97), btc15: same for BTCUSDT.
   Returns the rule's measurements or null when the data is not usable. */
export function v1kCheck(k15, btc15) {
  const n = k15.length, b = btc15.length;
  if (n < 97 || b < 97) return null;
  const i = n - 1, c = k15[i], prev = k15[i - 1], d = k15[i - 96], bc = btc15[b - 1], bd = btc15[b - 97];
  if (c.t - d.t !== 96 * M15 || c.t - prev.t !== M15 || bc.t !== c.t || bc.t - bd.t !== 96 * M15) return null;
  if (!(c.v > 0) || c.h === c.l) return null;
  let vol96 = 0; for (let j = i - 95; j <= i; j++) vol96 += k15[j].q;
  return { r15: (c.c / prev.c - 1) * 100, chg24: (c.c / d.c - 1) * 100, btc24: (bc.c / bd.c - 1) * 100, vol96, px: c.c };
}
export const v1kTriggers = (m) => Boolean(m) && m.r15 >= 4 && m.chg24 >= 50 && m.btc24 <= -1 && m.vol96 >= 1e6;

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; };
export function variantStats(rows, v) {
  const closed = rows.filter((r) => r.variants?.[v]?.state === 'closed').sort((a, b) => (a.variants[v].te || 0) - (b.variants[v].te || 0));
  const nets = closed.map((r) => r.variants[v].net);
  let cum = 0, peak = 0, dd = 0; nets.forEach((x) => { cum += x; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak); });
  const mean = nets.length ? nets.reduce((a, b) => a + b, 0) / nets.length : NaN;
  return {
    n: nets.length, mean, median: median(nets), win: nets.length ? nets.filter((x) => x > 0).length / nets.length * 100 : NaN,
    worst: nets.length ? Math.min(...nets) : NaN, dd, total: cum,
    open: rows.filter((r) => ['open', 'pending'].includes(r.variants?.[v]?.state)).length,
    skipped: rows.filter((r) => ['skip', 'filtered'].includes(r.variants?.[v]?.state)).length,
  };
}
const f2 = (v, d = 2) => (Number.isFinite(v) ? (+v).toFixed(d) : '—');
export function scorecardText(rows, { title = 'V1K GÖLGE KARNE', variants = VARIANTS, legend = null, gateVariants = ['K1', 'K2', 'K4'] } = {}) {
  const lines = [`<b>${title}</b> · ${rows.length} sinyal (kanala hiçbir şey gönderilmedi)`, ''];
  lines.push('<pre>' + 'var    n   ort% ortanca  kaz%  enkötü  düşüş  açık/atl' + '\n' + Object.keys(variants).map((v) => {
    const s = variantStats(rows, v);
    return `${v.padEnd(4)} ${String(s.n).padStart(3)} ${f2(s.mean).padStart(6)} ${f2(s.median).padStart(8)} ${f2(s.win, 0).padStart(4)} ${f2(s.worst, 1).padStart(8)} ${f2(s.dd, 1).padStart(10)}   ${s.open}/${s.skipped}`;
  }).join('\n') + '</pre>');
  lines.push(legend || 'K0 taban · K1 filtre (son 15 dk OI artışı ≤ %' + FILTER_OI15 + ') · K2 K1+OI çıkışı · K3 K1+ilk kırmızı mumda giriş · K4 hepsi · K5 giriş+çıkış, filtresiz');
  const gate = gateVariants.map((v) => { const s = variantStats(rows, v); return `${v}: ${s.n >= GATE_N && s.mean > 0 && s.median > 0 ? 'TUTTU' : `tutmadı (n=${s.n}/${GATE_N})`}`; });
  lines.push('', `Yayına geçiş şartı (n ≥ ${GATE_N}, ortalama > 0, ortanca > 0): ${gate.join(' · ')}`, 'Yayın kararı sende; şart tutsa bile otomatik yayın yoktur.');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ live recording */

export async function oiSeries(symbol, limit = 500) {
  const [oi, gl, tk] = await Promise.all([
    api('/futures/data/openInterestHist', { symbol, period: '5m', limit }),
    api('/futures/data/globalLongShortAccountRatio', { symbol, period: '5m', limit }).catch(() => []),
    api('/futures/data/takerlongshortRatio', { symbol, period: '5m', limit }).catch(() => []),
  ]);
  const glm = new Map(gl.map((x) => [+x.timestamp, +x.longShortRatio])), tkm = new Map(tk.map((x) => [+x.timestamp, +x.buySellRatio]));
  let lastGl = NaN, lastTk = NaN;
  return oi.map((x) => { const t = +x.timestamp; if (glm.has(t)) lastGl = glm.get(t); if (tkm.has(t)) lastTk = tkm.get(t); return { t, u: +x.sumOpenInterestValue, gl: lastGl, tk: lastTk }; });
}

export async function snapshot(sym, m, b) {
  const [m1, k15, recs, prem, btc1h] = await Promise.all([
    klines(sym, '1m', 400, { endTime: b - 1 }), klines(sym, '15m', 270, { endTime: b - 1 }), oiSeries(sym, 60).catch(() => []),
    api('/fapi/v1/premiumIndex', { symbol: sym }).catch(() => null), klines('BTCUSDT', '1h', 175, { endTime: b - 1 }).catch(() => []),
  ]);
  const sumq = (arr) => { let q = 0, tq = 0; arr.forEach((x) => { q += x.q; tq += x.tq; }); return { q, cvd: q > 0 ? (2 * tq - q) / q : 0 }; };
  const c15 = sumq(m1.slice(-15)), c60 = sumq(m1.slice(-60)), cprev = sumq(m1.slice(-60, -15));
  let pq = 0; for (let j = 1; j <= 8; j++) pq += sumq(m1.slice(-15 - 15 * j, -15 * j)).q;
  const last = recs.length - 1, at = (n) => (last - n >= 0 ? recs[last - n] : null);
  const ch = (a, c) => (a && c && c.u > 0 ? (a.u / c.u - 1) * 100 : null);
  const tkv = recs.slice(-12).map((x) => x.tk).filter(Number.isFinite);
  const oi15 = ch(at(0), at(3)), oi1h = ch(at(0), at(12));
  const btcRange = (() => { const kk = btc1h.slice(-24); return kk.length ? (Math.max(...kk.map((x) => x.h)) - Math.min(...kk.map((x) => x.l))) / kk[kk.length - 1].c * 100 : null; })();
  const btc7d = btc1h.length >= 169 ? (btc1h[btc1h.length - 1].c / btc1h[btc1h.length - 169].c - 1) * 100 : null;
  return {
    ...m, oi15, oi1h, takerAvg: tkv.length ? tkv.reduce((a, c) => a + c, 0) / tkv.length : null, glr: at(0)?.gl ?? null,
    fund: prem ? +prem.lastFundingRate * 100 : null, cvd15: c15.cvd, cvd60: c60.cvd, cvdDelta: c15.cvd - cprev.cvd, volRatio: pq > 0 ? c15.q / (pq / 8) : null,
    btc7d, btcRange, density: MARKET.tick.filter((x) => x.c >= 15).length,
    F: oi15 === null ? null : oi15 <= FILTER_OI15, mtf: mtfFeatures(m1, k15, b),
  };
}

let lastBoundaryMem = 0;
const heartbeat = { at: 0, boundary: 0, candidates: 0, checked: 0, fired: 0, late: false };   // shown in /v1k status so a quiet day can be told from a broken detector
async function detect() {
  const b = Math.floor(Date.now() / M15) * M15;
  const last = lastBoundaryMem || await db.getState('shadow:v1k:last', 0);
  if (b <= last) return;
  lastBoundaryMem = b; await db.setState('shadow:v1k:last', b);
  if (Date.now() - b > 12 * 60e3) { log('shadow: 15m boundary missed (late start), skipping'); heartbeat.late = true; return; }
  const cands = MARKET.tick.filter((x) => x.c >= 40 && x.v >= 1e6).sort((a, c) => c.c - a.c).slice(0, 40);
  Object.assign(heartbeat, { at: Date.now(), boundary: b, candidates: cands.length, checked: 0, fired: 0, late: false });
  if (!cands.length) return;
  const btc = (await klines('BTCUSDT', '15m', 110, { endTime: b - 1 })).filter((x) => x.t + M15 <= b);
  for (const t of cands) {
    try {
      const k = (await klines(t.s, '15m', 110, { endTime: b - 1 })).filter((x) => x.t + M15 <= b);
      if (!k.length || k[k.length - 1].t !== b - M15) continue;
      const m = v1kCheck(k, btc);
      heartbeat.checked++;
      if (!v1kTriggers(m)) continue;
      const rec = (await db.q('select sig_at from shadow_engine where engine=$1 and symbol=$2 order by sig_at desc limit 1', [ENGINE, t.s]))[0];
      if (rec && b - Date.parse(rec.sig_at) < 4 * HOUR) continue;                  // 4 hour cooldown per coin
      const feat = await snapshot(t.s, m, b);
      const variants = {}; Object.keys(VARIANTS).forEach((v) => { variants[v] = { state: VARIANTS[v].F && feat.F !== true ? 'filtered' : 'open' }; });
      await db.q(`insert into shadow_engine (key, engine, symbol, sig_at, features, variants) values ($1,$2,$3,$4,$5,$6) on conflict (key) do nothing`,
        [`${ENGINE}|${t.s}|${b}`, ENGINE, t.s, new Date(b).toISOString(), feat, variants]);
      publishNew(`${ENGINE}|${t.s}|${b}`).catch((e) => warn(`v1k publish ${t.s}: ${e.message}`));
      heartbeat.fired++;
      log(`shadow v1k signal ${t.s}: 15m ${m.r15.toFixed(1)}% · 24h ${m.chg24.toFixed(0)}% · BTC24 ${m.btc24.toFixed(1)}% · oi15 ${feat.oi15 === null ? '—' : feat.oi15.toFixed(1)}% · filter ${feat.F}`);
    } catch (e) { warn(`shadow v1k ${t.s}: ${e.message}`); }
  }
}

const lastTry = new Map();
async function resolveRow(row) {
  const tSig = Date.parse(row.sig_at);
  let k = await klines(row.symbol, '1m', 1500, { startTime: tSig });
  if (k.length && k[k.length - 1].t + MIN > Date.now()) k = k.slice(0, -1);        // drop the forming candle
  if (k.length < 20 || k[0].t !== tSig) return;
  for (let j = 1; j < k.length; j++) if (k[j].t - k[j - 1].t !== MIN) { k = k.slice(0, j); break; }   // use the contiguous part only
  const [recs, fr] = await Promise.all([oiSeries(row.symbol, 500).catch(() => []), api('/fapi/v1/fundingRate', { symbol: row.symbol, startTime: tSig, limit: 20 }).catch(() => [])]);
  const funding = fr.map((x) => ({ t: +x.fundingTime, r: +x.fundingRate }));
  const vol = row.features?.vol96 || 0;
  const variants = { ...row.variants };
  for (const [name, c] of Object.entries(VARIANTS)) {
    const cur = variants[name];
    if (!['open', 'pending'].includes(cur?.state)) continue;
    const r = engineEntry({ k, i0: 0, tSig, funding, recs, vol, useE1: c.E1, useO1: c.O1 });
    if (r.ok) variants[name] = { state: 'closed', net: +r.net.toFixed(4), exit: r.exit, te: r.te, tEntry: r.tEntry };
    else if (r.skip) variants[name] = { state: 'skip', why: r.why };
    else variants[name] = { state: 'open' };
  }
  const allDone = Object.values(variants).every((v) => ['closed', 'skip', 'filtered', 'void'].includes(v.state));
  if (!allDone && Date.now() > tSig + 26 * HOUR) for (const v of Object.keys(variants)) if (['open', 'pending'].includes(variants[v].state)) variants[v] = { state: 'void', why: 'data incomplete after 26h' };
  const done = Object.values(variants).every((v) => ['closed', 'skip', 'filtered', 'void'].includes(v.state));
  await db.q('update shadow_engine set variants=$2, status=$3, closed_at=$4 where id=$1', [row.id, variants, done ? 'closed' : 'open', done ? new Date().toISOString() : null]);
  if (done) log(`shadow v1k closed ${row.symbol}: ` + Object.entries(variants).map(([n, v]) => `${n} ${v.state === 'closed' ? v.net.toFixed(2) + '%' : v.state}`).join(' · '));
}

async function resolveOpen() {
  const rows = await db.q("select * from shadow_engine where engine=$1 and status='open' order by sig_at asc limit 30", [ENGINE]);
  let n = 0;
  for (const r of rows) {
    if (Date.now() - (lastTry.get(r.id) || 0) < 4 * 60e3) continue;
    lastTry.set(r.id, Date.now());
    try { await resolveRow(r); } catch (e) { warn(`shadow resolve ${r.symbol}: ${e.message}`); }
    if (++n >= 6) break;
  }
}

export async function shadowTick() {
  if (!ENV.shadowOn || !db.dbReady()) return;
  try { await detect(); } catch (e) { warn('shadow detect:', e.message); }
  try { await resolveOpen(); } catch (e) { warn('shadow resolve:', e.message); }
  try { await publishResults(); } catch (e) { warn('v1k results:', e.message); }
}

export async function shadowRows() {
  return db.q('select * from shadow_engine where engine=$1 order by sig_at asc limit 5000', [ENGINE]);
}
export async function shadowScorecard() { return scorecardText(await shadowRows()); }


/* ------------------------------------------------------------------ publishing: FREE showcase only (variant K1)
   Free channel = shop window: a filtered signal is shown only after it has been open for a while and is in profit
   (V1K_FREE_MIN_PROFIT). The FINAL result of every showcased position is posted, wins and losses, and every post says that
   only selected positions are shown. VIP receives nothing from v1k unless V1K_VIP=true. The auto-pause looks at ALL filtered
   signals (not only the showcased ones), so it cannot be fooled by the selection.
   DRY_RUN never records as published; /v1k off is the kill switch. */
const PAUSE_LAST = 10, PAUSE_SUM = -30;
/* Free channel: a closed trade is shown only when it ended in profit, at most perDay a day, at least 24h after the signal.
   Losing trades are never shown in free (the channel says so: "selected winning trades"); VIP gets every signal and every result. */
export function winnerDecision({ enabled, paused, F, k1, ageMs, shownToday, perDay }) {
  if (!enabled) return { act: 'wait', why: 'publishing off' };
  if (paused) return { act: 'wait', why: 'paused' };
  if (F !== true) return { act: 'skip', why: 'filter not passed' };
  if (k1?.state !== 'closed') return { act: 'wait', why: 'still open' };
  if (!(k1.net > 0)) return { act: 'skip', why: 'not a winner' };
  if (ageMs < DAY) return { act: 'wait', why: 'free is 24h behind VIP' };
  if (shownToday >= perDay) return { act: 'wait', why: 'daily cap' };
  return { act: 'post' };
}
export const shouldPause = (closedNets) => closedNets.length >= PAUSE_LAST && closedNets.slice(-PAUSE_LAST).reduce((a, b) => a + b, 0) <= PAUSE_SUM;

const setPub = (id, patch) => db.q(`update shadow_engine set features = jsonb_set(features, '{pub}', coalesce(features->'pub','{}'::jsonb) || $2::jsonb) where id=$1`, [id, JSON.stringify(patch)]);
async function publishEnabled() { return ENV.v1kPublish && !(await db.getState('v1k:off', false)); }

/* The VIP engine (V1K_VIP=true): every signal that passes the filter goes to VIP the moment it is recorded, with a chart.
   Guards: kill switch, auto-pause, at most V1K_VIP_PER_DAY a day, unknown open-interest data is never published.
   DRY_RUN never records as published. Results of every VIP signal, wins and losses, are posted to VIP when it closes. */
async function publishNew(key) {
  if (!ENV.v1kVip || !(await publishEnabled()) || (await db.getState('v1k:paused', false))) return;
  const row = (await db.q('select * from shadow_engine where key=$1', [key]))[0];
  if (!row || row.features?.F !== true || row.features?.pub?.vip_at || !ENV.postVip || !ENV.vipChat) return;
  const day0 = new Date(); day0.setUTCHours(0, 0, 0, 0);
  const today = (await db.q("select count(*)::int as n from shadow_engine where engine=$1 and (features->'pub'->>'vip_at')::bigint >= $2", [ENGINE, day0.getTime()]))[0]?.n || 0;
  if (today >= ENV.v1kVipPerDay) { log(`v1k VIP daily cap reached, not published: ${row.symbol}`); return; }
  const px = row.features.px;
  const png = await levelChartPng({ symbol: row.symbol, tag: 'SHORT SIGNAL', lines: [{ price: px, label: 'ENTRY', color: CHART_COLORS.blue }, { price: px * 1.5, label: 'STOP', color: CHART_COLORS.dn }], badge: { big: 'SHORT', small: 'exit in 24h · 1x only · max 5%', color: CHART_COLORS.dn }, foot: 'Not financial advice. Leveraged trading can lose your entire capital.' });
  const msg = await tg.sendCard(ENV.vipChat, png, M.v1kSignal(row));
  if (msg && !msg.dry) { await setPub(row.id, { vip_at: Date.now(), vip_msg: msg.message_id || null }); log(`v1k signal published to VIP: ${row.symbol}`); }
}

async function publishResults() {
  const enabled = await publishEnabled(), paused = await db.getState('v1k:paused', false);
  const rows = await shadowRows();
  const day0 = new Date(); day0.setUTCHours(0, 0, 0, 0);
  let shownToday = rows.filter((r) => (r.features?.pub?.free_at || 0) >= day0.getTime()).length;
  for (const r of rows) {
    const pub = r.features?.pub || {}, k1 = r.variants?.K1;
    // VIP: the final result of every VIP signal, wins and losses, as a reply to the signal
    if (pub.vip_at && !pub.vip_res && k1?.state === 'closed' && ENV.postVip && ENV.vipChat) {
      const m = M.v1kResult(r);
      const msg = await tg.send(ENV.vipChat, m.text, pub.vip_msg ? { reply_parameters: { message_id: pub.vip_msg, allow_sending_without_reply: true } } : {});
      if (msg && !msg.dry) await setPub(r.id, { vip_res: Date.now() });
    }
    if (!ENV.postFree || !ENV.freeChat || pub.free_at || pub.skip) continue;
    const d = winnerDecision({ enabled, paused, F: r.features?.F, k1, ageMs: Date.now() - Date.parse(r.sig_at), shownToday, perDay: ENV.freePerDay });
    if (d.act === 'skip') { await setPub(r.id, { skip: d.why }); continue; }
    if (d.act !== 'post') continue;
    const m = M.v1kWinner(r);
    const px = r.features.px, exitPx = px * (1 - k1.net / 100);
    const png = await profitChartPng({ symbol: r.symbol, tf: '15m', dir: 'S', entry: px, now: exitPx, nowLabel: 'EXIT', profitText: `+${k1.net.toFixed(1)}%`, small: 'SHORT · CLOSED IN PROFIT', endTime: k1.te, foot: 'Selected winning trade. Not every trade wins. Not financial advice.' });
    const msg = await tg.sendCard(ENV.freeChat, png, m.text, { reply_markup: m.reply_markup });
    if (msg && !msg.dry) { await setPub(r.id, { free_at: Date.now(), free_net: k1.net }); shownToday++; log(`v1k winner → free: ${r.symbol} (+${k1.net.toFixed(1)}%)`); }
  }
  const nets = rows.filter((x) => x.features?.F === true && x.variants?.K1?.state === 'closed').sort((a, b) => a.variants.K1.te - b.variants.K1.te).map((x) => x.variants.K1.net);
  if (shouldPause(nets) && !paused) {
    await db.setState('v1k:paused', true);
    await notifyAdmins(`⏸ v1k publishing paused automatically: the last ${PAUSE_LAST} filtered signals (all of them, not only the shown ones) sum to ${nets.slice(-PAUSE_LAST).reduce((a, b) => a + b, 0).toFixed(1)} points. Review /karne, then /v1k resume.`);
  }
}

export async function v1kControl(arg) {
  const a = String(arg || 'status').toLowerCase();
  if (a === 'off') { await db.setState('v1k:off', true); return '⏹ v1k showcase is OFF (recording continues).'; }
  if (a === 'on') { await db.setState('v1k:off', false); return `▶️ v1k showcase is ON${ENV.v1kPublish ? '' : ' (but V1K_PUBLISH=false in Railway, so it stays off)'}.`; }
  if (a === 'resume') { await db.setState('v1k:paused', false); return '▶️ v1k auto-pause cleared.'; }
  const rows = await shadowRows();
  const shown = rows.filter((r) => r.features?.pub?.free_at);
  const hb = heartbeat.at ? `last 15m check ${new Date(heartbeat.at).toISOString().slice(11, 16)} UTC: ${heartbeat.candidates} coin(s) up 40%+ in 24h, ${heartbeat.checked} checked, ${heartbeat.fired} fired` : 'no 15m check yet since the last restart (the first one runs at the next quarter hour)';
  return `${hb}\n` + `v1k free (closed winners only): ${(await publishEnabled()) ? 'ON' : 'OFF'} · VIP engine (instant signals): ${ENV.v1kVip ? 'ON' : 'off'}, at most ${ENV.v1kVipPerDay}/day · FADE publishing: ${ENV.fadePublish ? 'ON' : 'off'} · auto-pause: ${(await db.getState('v1k:paused', false)) ? 'PAUSED' : 'clear'} · DRY_RUN: ${ENV.dryRun ? 'ON (nothing is sent to channels)' : 'off'}\nRecorded ${rows.length}, shown in free (winners) ${shown.length}.\n/v1k on | off | resume · /karne (full record, every signal)`;
}
