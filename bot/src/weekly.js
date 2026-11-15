// Weekly v1k cards: the VIP results card (every VIP signal of the week, wins and losses) and the free "this week in VIP" preview
// (coin names only, no results). Runs once a week; each post is recorded so it can never repeat.
import { ENV } from './config.js';
import * as db from './db.js';
import * as tg from './telegram.js';
import * as M from './messages.js';
import { weekResultsPng, profitChartPng } from './chart.js';
import { shadowRows } from './shadow.js';
import { weekKey } from './publisher.js';
import { trDate, trDayStart, trShort, log, warn } from './util.js';

/* Pure: the signals that went to VIP in [from, to) and their results. */
export function weekStats(rows, from, to) {
  const items = rows
    .filter((r) => r.features?.pub?.vip_at && Date.parse(r.sig_at) >= from && Date.parse(r.sig_at) < to)
    .sort((a, b) => Date.parse(a.sig_at) - Date.parse(b.sig_at))
    .map((r) => ({ sym: r.symbol.replace(/USDT$/, ''), symbol: r.symbol, px: r.features?.px ?? null, te: r.variants?.K1?.te ?? null, net: r.variants?.K1?.state === 'closed' ? r.variants.K1.net : null }));
  const closed = items.filter((x) => x.net !== null);
  const sum = closed.reduce((a, x) => a + x.net, 0);
  const byNet = [...closed].sort((a, b) => a.net - b.net);
  return {
    items, n: items.length, closed: closed.length, open: items.length - closed.length,
    won: closed.filter((x) => x.net > 0).length, lost: closed.filter((x) => x.net <= 0).length,
    sum, mean: closed.length ? sum / closed.length : null, best: byNet[byNet.length - 1] || null, worst: byNet[0] || null,
  };
}

export async function publishV1kWeekly() {
  if (!ENV.v1kVip || !ENV.postVip) return;
  const now = Date.now(), d = trDate(now);
  const thisMon = trDayStart(now) - ((d.getUTCDay() + 6) % 7) * 864e5;
  const from = thisMon - 7 * 864e5, to = thisMon;
  const key = 'v1k-' + weekKey(from + 864e5);
  const label = `${trShort(from)} – ${trShort(to - 864e5)}`;
  const st = weekStats(await shadowRows(), from, to);
  const kuru = (m) => Boolean(m && m.dry);

  if (ENV.vipChat && !(await db.postExists('v1kweek', 'vip', key))) {
    try {
      const png = st.n ? await weekResultsPng({ title: 'Weekly results · VIP signals', label, items: st.items }) : null;
      const msg = await tg.sendCard(ENV.vipChat, png, M.v1kWeekVip(st, label));
      if (!kuru(msg)) await db.postOnce('v1kweek', 'vip', key, msg?.message_id ?? null);
      log(`VIP weekly v1k card posted (${key})`);
    } catch (e) { warn('VIP weekly v1k:', e.message); }
  }
  if (ENV.postFree && ENV.freeChat && !(await db.postExists('v1kweek', 'free', key))) {
    try {
      const m = M.v1kWeekFree([...new Set(st.items.map((x) => x.sym + 'USDT'))]);
      const msg = await tg.send(ENV.freeChat, m.text, { reply_markup: m.reply_markup });
      if (!kuru(msg)) await db.postOnce('v1kweek', 'free', key, msg?.message_id ?? null);
      log(`free weekly v1k preview posted (${key})`);
    } catch (e) { warn('free weekly v1k:', e.message); }
  }
  // free: the best closed trade of the week (only when there was a winner)
  const b = st.best;
  if (ENV.postFree && ENV.freeChat && b && b.net > 0 && b.px && !(await db.postExists('v1kbest', 'free', key))) {
    try {
      const m = M.v1kBestWeek(b, label);
      const png = await profitChartPng({ symbol: b.symbol, tf: '15m', dir: 'S', entry: b.px, now: b.px * (1 - b.net / 100), nowLabel: 'EXIT', profitText: `+${b.net.toFixed(1)}%`, small: 'SHORT · BEST OF THE WEEK', endTime: b.te, foot: 'Closed trade. Not financial advice.' });
      const msg = await tg.sendCard(ENV.freeChat, png, m.text, { reply_markup: m.reply_markup });
      if (!kuru(msg)) await db.postOnce('v1kbest', 'free', key, msg?.message_id ?? null);
      log(`free best-of-week posted (${key}): ${b.symbol}`);
    } catch (e) { warn('free best-of-week:', e.message); }
  }
}

/* Pinned "how it works" posts, once per version (bump PIN_V to re-post). No system details: only what members get. */
const PIN_V = 'v1';
let pinsDone = false;
export async function publishPinned() {
  if (pinsDone) return;
  const jobs = [['free', ENV.postFree && ENV.freeChat, () => M.pinnedFree()], ['vip', ENV.postVip && ENV.vipChat, () => M.pinnedVip()]];
  for (const [ch, chat, build] of jobs) {
    if (!chat || (await db.postExists('pinned', ch, PIN_V))) continue;
    try {
      const m = build();
      const msg = await tg.send(chat, m.text, m.reply_markup ? { reply_markup: m.reply_markup } : {});
      if (msg && !msg.dry) { await db.postOnce('pinned', ch, PIN_V, msg.message_id ?? null); if (msg.message_id) await tg.pin(chat, msg.message_id); log(`pinned post (${ch}) published`); }
    } catch (e) { warn('pinned ' + ch + ':', e.message); }
  }
  pinsDone = true;
}
