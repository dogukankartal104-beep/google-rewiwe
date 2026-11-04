// Shadow engine "v1p": rolling 1-minute trigger, then a pullback from the high confirms the entry (docs/v1k-teyit-protokol.md).
// Forward paper trading ONLY. It never posts anywhere: the backtest showed it does not add to v1k (the two move together),
// so it is recorded to see whether that holds live. Four variants: P1/P2 (pullback 1.5% / 3%), each with and without the oi15 filter.
import { ENV } from './config.js';
import * as db from './db.js';
import { api, klines } from './binance.js';
import { MARKET } from './scanner.js';
import { log, warn } from './util.js';
import { engineEntry, LIVE_FILTER_OI15 as FILTER_OI15 } from '../bt/v1/engine.js';
import { oiSeries, snapshot, scorecardText } from './shadow.js';
import * as tg from './telegram.js';
import * as M from './messages.js';
import { levelChartPng, CHART_COLORS } from './chart.js';
import { notifyAdmins } from './vip.js';

const MIN = 6e4, HOUR = 36e5, DAY = 864e5;
export const ENGINE = 'v1p';
export const P_VARIANTS = { P1: { p: 0.015, F: false }, P2: { p: 0.03, F: false }, P1F: { p: 0.015, F: true }, P2F: { p: 0.03, F: true } };

/* ------------------------------------------------------------------ pure parts (unit-tested) */

/* k: closed 1m candles (at least 1441), i: index of the candle that just closed, btc: closed 1m candles of BTCUSDT on the same clock. */
export function rollingTrigger(k, i, btc) {
  if (i < 1440 || i >= k.length) return null;
  const c = k[i], t = c.t;
  if (k[i - 15].t !== t - 15 * MIN || k[i - 1440].t !== t - 1440 * MIN) return null;           // gaps: no answer rather than a wrong one
  if (!(c.v > 0) || c.h === c.l) return null;
  const bi = btc.findIndex((x) => x.t === t);
  if (bi < 1440 || btc[bi - 1440].t !== t - 1440 * MIN) return null;
  let vol24 = 0; for (let j = i - 1439; j <= i; j++) vol24 += k[j].q;
  return { r15: (c.c / k[i - 15].c - 1) * 100, chg24: (c.c / k[i - 1440].c - 1) * 100, btc24: (btc[bi].c / btc[bi - 1440].c - 1) * 100, vol24, px: c.c };
}
export const rollingFires = (m) => Boolean(m) && m.r15 >= 4 && m.chg24 >= 50 && m.btc24 <= -1 && m.vol24 >= 1e6;

/* k[0] is the trigger candle. First close within 30 minutes that is at least p below the highest high since the trigger.
   Returns the index of the entry candle (the next one), 'pending' while the window is still running, or -1 when it never happened. */
export function pullbackEntry(k, p) {
  let H = k[0].h;
  for (let j = 1; j <= 30; j++) {
    if (j >= k.length) return 'pending';
    H = Math.max(H, k[j].h);
    if (k[j].v > 0 && k[j].c <= H * (1 - p)) return j + 1 < k.length ? j + 1 : 'pending';
  }
  return -1;
}

/* ------------------------------------------------------------------ live recording */
async function closed1m(symbol, limit = 1500) {
  const k = await klines(symbol, '1m', limit);
  return k.filter((x) => x.t + MIN <= Date.now());
}

async function detect() {
  const cands = MARKET.tick.filter((x) => x.c >= 40 && x.v >= 1e6).sort((a, c) => c.c - a.c).slice(0, 25);
  if (!cands.length) return;
  const btc = await closed1m('BTCUSDT');
  for (const t of cands) {
    try {
      const k = await closed1m(t.s);
      if (k.length < 1445) continue;
      let fired = null;
      for (let i = k.length - 1; i >= Math.max(1440, k.length - 8); i--) {            // the last few closed minutes (ticks can be minutes apart)
        const m = rollingTrigger(k, i, btc);
        if (rollingFires(m)) { fired = { i, m }; break; }
      }
      if (!fired) continue;
      const tSig = k[fired.i].t + MIN;
      const rec = (await db.q('select sig_at from shadow_engine where engine=$1 and symbol=$2 order by sig_at desc limit 1', [ENGINE, t.s]))[0];
      if (rec && tSig - Date.parse(rec.sig_at) < 4 * HOUR) continue;                  // 4 hour cooldown per coin
      const feat = await snapshot(t.s, { r15: fired.m.r15, chg24: fired.m.chg24, btc24: fired.m.btc24, vol96: fired.m.vol24, px: fired.m.px }, tSig);
      const variants = {}; for (const [v, c] of Object.entries(P_VARIANTS)) variants[v] = { state: c.F && feat.F !== true ? 'filtered' : 'open' };
      await db.q('insert into shadow_engine (key, engine, symbol, sig_at, features, variants) values ($1,$2,$3,$4,$5,$6) on conflict (key) do nothing',
        [`${ENGINE}|${t.s}|${tSig}`, ENGINE, t.s, new Date(tSig).toISOString(), feat, variants]);
      log(`shadow v1p trigger ${t.s}: 15m ${fired.m.r15.toFixed(1)}% · 24h ${fired.m.chg24.toFixed(0)}% · BTC24 ${fired.m.btc24.toFixed(1)}% · oi15 ${feat.oi15 === null ? '—' : feat.oi15.toFixed(1)}%`);
    } catch (e) { warn(`shadow v1p ${t.s}: ${e.message}`); }
  }
}

const lastTry = new Map();
async function resolveRow(row) {
  const tSig = Date.parse(row.sig_at);
  let k = await klines(row.symbol, '1m', 1500, { startTime: tSig - MIN });
  if (k.length && k[k.length - 1].t + MIN > Date.now()) k = k.slice(0, -1);
  if (k.length < 3 || k[0].t !== tSig - MIN || k[1].t !== tSig) return;
  for (let j = 1; j < k.length; j++) if (k[j].t - k[j - 1].t !== MIN) { k = k.slice(0, j); break; }
  const [recs, fr] = await Promise.all([oiSeries(row.symbol, 60).catch(() => []), api('/fapi/v1/fundingRate', { symbol: row.symbol, startTime: tSig, limit: 20 }).catch(() => [])]);
  const funding = fr.map((x) => ({ t: +x.fundingTime, r: +x.fundingRate }));
  const variants = { ...row.variants };
  const e2 = pullbackEntry(k, P_VARIANTS.P2.p);
  if (typeof e2 === 'number' && e2 >= 0) await maybePublish(row, k, e2, tSig).catch((e) => warn(`v1p publish ${row.symbol}: ${e.message}`));
  for (const [name, c] of Object.entries(P_VARIANTS)) {
    if (!['open', 'pending'].includes(variants[name]?.state)) continue;
    const e = pullbackEntry(k, c.p);
    if (e === 'pending') { variants[name] = { state: 'open' }; continue; }
    if (e < 0) { variants[name] = { state: 'skip', why: 'no pullback within 30 minutes' }; continue; }
    const r = engineEntry({ k, i0: 1, tSig, funding, recs, vol: row.features?.vol96 || 0, entryIdx: e });
    if (r.ok) variants[name] = { state: 'closed', net: +r.net.toFixed(4), exit: r.exit, te: r.te, tEntry: r.tEntry };
    else if (r.skip) variants[name] = { state: 'skip', why: r.why };
    else variants[name] = { state: 'open' };
  }
  if (Date.now() > tSig + 26 * HOUR) for (const v of Object.keys(variants)) if (['open', 'pending'].includes(variants[v].state)) variants[v] = { state: 'void', why: 'data incomplete after 26h' };
  const done = Object.values(variants).every((v) => ['closed', 'skip', 'filtered', 'void'].includes(v.state));
  await db.q('update shadow_engine set variants=$2, status=$3, closed_at=$4 where id=$1', [row.id, variants, done ? 'closed' : 'open', done ? new Date().toISOString() : null]);
  if (done) log(`shadow v1p closed ${row.symbol}: ` + Object.entries(variants).map(([n, v]) => `${n} ${v.state === 'closed' ? v.net.toFixed(2) + '%' : v.state}`).join(' · '));
}

async function resolveOpen() {
  const rows = await db.q("select * from shadow_engine where engine=$1 and status='open' order by sig_at asc limit 30", [ENGINE]);
  let n = 0;
  for (const r of rows) {
    if (Date.now() - (lastTry.get(r.id) || 0) < 4 * 60e3) continue;
    lastTry.set(r.id, Date.now());
    try { await resolveRow(r); } catch (e) { warn(`shadow v1p resolve ${r.symbol}: ${e.message}`); }
    if (++n >= 6) break;
  }
}

/* ------------------------------------------------------------------ VIP publishing (variant P2, V1P_VIP=true)
   Rules: only while no v1k position is open (the two engines must not stack), at most V1P_VIP_PER_DAY a day, only if the pullback entry
   is fresh (it is a "now" signal), unknown open-interest data never published (P2 itself does not use the filter, but a signal needs data),
   the shared kill switch (/v1k off) and an own auto-pause (last 10 published sum <= -30 points). DRY_RUN never records as published. */
export function v1pGuard({ enabled, paused, v1kOpen, publishedToday, cap, entryAgeMs }) {
  if (!enabled) return { ok: false, why: 'off' };
  if (paused) return { ok: false, why: 'paused' };
  if (v1kOpen) return { ok: false, why: 'a v1k position is open' };
  if (publishedToday >= cap) return { ok: false, why: 'daily cap' };
  if (!(entryAgeMs >= 0 && entryAgeMs <= 10 * MIN)) return { ok: false, why: 'entry is stale' };
  return { ok: true };
}
const setPub = (id, patch) => db.q(`update shadow_engine set features = jsonb_set(features, '{pub}', coalesce(features->'pub','{}'::jsonb) || $2::jsonb) where id=$1`, [id, JSON.stringify(patch)]);

async function maybePublish(row, k, entryIdx, tSig) {
  if (!ENV.v1pVip || !ENV.postVip || !ENV.vipChat || row.features?.pub?.vip_at) return;
  const day0 = new Date(); day0.setUTCHours(0, 0, 0, 0);
  const [open1, today] = await Promise.all([
    db.q("select 1 from shadow_engine where engine='v1k' and features->'pub'->>'vip_at' is not null and variants->'K1'->>'state'='open' limit 1"),
    db.q("select count(*)::int as n from shadow_engine where engine=$1 and (features->'pub'->>'vip_at')::bigint >= $2", [ENGINE, day0.getTime()]),
  ]);
  const g = v1pGuard({ enabled: !(await db.getState('v1k:off', false)), paused: await db.getState('v1p:paused', false), v1kOpen: open1.length > 0, publishedToday: today[0]?.n || 0, cap: ENV.v1pVipPerDay, entryAgeMs: Date.now() - k[entryIdx].t });
  if (!g.ok) { log(`v1p not published (${g.why}): ${row.symbol}`); return; }
  const entry = k[entryIdx].o, stop = row.features.px * 1.5;
  const png = await levelChartPng({ symbol: row.symbol, tag: 'SHORT SIGNAL', lines: [{ price: entry, label: 'ENTRY', color: CHART_COLORS.blue }, { price: stop, label: 'STOP', color: CHART_COLORS.dn }], badge: { big: 'SHORT', small: 'pullback entry · 1x only · max 5%', color: CHART_COLORS.dn }, foot: 'Not financial advice. Leveraged trading can lose your entire capital.' });
  const msg = await tg.sendCard(ENV.vipChat, png, M.v1pSignal(row, entry, stop, tSig + DAY));
  if (msg && !msg.dry) { await setPub(row.id, { vip_at: Date.now(), vip_msg: msg.message_id || null }); log(`v1p signal published to VIP: ${row.symbol}`); }
}

async function publishResults() {
  if (!ENV.v1pVip && !ENV.postVip) return;
  const rows = await db.q('select * from shadow_engine where engine=$1 order by sig_at asc limit 5000', [ENGINE]);
  for (const r of rows) {
    const pub = r.features?.pub || {}, v = r.variants?.P2;
    if (!pub.vip_at || pub.vip_res || v?.state !== 'closed' || !ENV.vipChat) continue;
    const msg = await tg.send(ENV.vipChat, M.v1kResult(r, 'P2').text, pub.vip_msg ? { reply_parameters: { message_id: pub.vip_msg, allow_sending_without_reply: true } } : {});
    if (msg && !msg.dry) await setPub(r.id, { vip_res: Date.now() });
  }
  const nets = rows.filter((r) => r.features?.pub?.vip_at && r.variants?.P2?.state === 'closed').sort((a, b) => a.variants.P2.te - b.variants.P2.te).map((r) => r.variants.P2.net);
  if (nets.length >= 10 && nets.slice(-10).reduce((a, b) => a + b, 0) <= -30 && !(await db.getState('v1p:paused', false))) {
    await db.setState('v1p:paused', true);
    await notifyAdmins(`⏸ v1p publishing paused automatically: the last 10 published v1p signals sum to ${nets.slice(-10).reduce((a, b) => a + b, 0).toFixed(1)} points. Review /karne p, then clear with /v1k resume.`);
  }
}

export async function shadow2Tick() {
  if (!ENV.shadowOn || !db.dbReady()) return;
  try { await detect(); } catch (e) { warn('shadow v1p detect:', e.message); }
  try { await resolveOpen(); } catch (e) { warn('shadow v1p resolve:', e.message); }
  try { await publishResults(); } catch (e) { warn('v1p results:', e.message); }
}

export async function shadow2Scorecard() {
  const rows = await db.q('select * from shadow_engine where engine=$1 order by sig_at asc limit 5000', [ENGINE]);
  return scorecardText(rows, { title: 'V1P GÖLGE KARNE (kayan tetik + geri çekilme)', variants: P_VARIANTS, gateVariants: ['P1', 'P2', 'P1F', 'P2F'],
    legend: `P1 tetikten sonra tepeden %1.5 geri çekilmede giriş · P2 %3 · P1F/P2F: + filtre (son 15 dk OI artışı ≤ %${FILTER_OI15}). Yayın yok: backtestte v1k'ya ek değer katmadı, canlıda doğrulanıyor.` });
}
