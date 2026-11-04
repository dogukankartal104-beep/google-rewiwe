// Shadow engine: rule check, variant statistics and the scorecard. No network, no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { v1kCheck, v1kTriggers, variantStats, scorecardText } from '../src/shadow.js';
import { VARIANTS, FILTER_OI15 } from '../bt/v1/engine.js';

const M15 = 9e5;
const series = (n, f, t0 = 1e12) => Array.from({ length: n }, (_, i) => { const c = f(i); return { t: t0 + i * M15, o: c, h: c * 1.01, l: c * 0.99, c, v: 10, q: 1e5, tb: 5, tq: 5e4 }; });

test('v1k rule: pump ≥ +4% in the last 15m, 24h ≥ +50%, BTC 24h ≤ -1%, volume ≥ 1M', () => {
  const k = series(110, (i) => (i < 109 ? 100 + i * 0.5 : 165));          // last candle jumps
  const btcDown = series(110, (i) => 100 - i * 0.02);
  const m = v1kCheck(k, btcDown);
  assert.ok(m && m.r15 > 4 && m.chg24 > 50 && m.btc24 < -1 && m.vol96 >= 9e6);
  assert.equal(v1kTriggers(m), true);
  assert.equal(v1kTriggers(v1kCheck(k, series(110, (i) => 100 + i * 0.02))), false, 'BTC not weak');
  assert.equal(v1kTriggers(v1kCheck(series(110, (i) => (i < 109 ? 100 : 103)), btcDown)), false, 'no pump');
});

test('v1k rule: gaps or misaligned BTC candles give null instead of a wrong answer', () => {
  const k = series(110, (i) => 100 + i);
  const gap = k.map((x, i) => (i > 50 ? { ...x, t: x.t + M15 } : x));
  assert.equal(v1kCheck(gap, series(110, () => 100)), null);
  assert.equal(v1kCheck(k, series(110, () => 100, 2e12)), null);
});

test('variants: the six cells and the filter threshold are as registered in the protocol', () => {
  assert.deepEqual(Object.keys(VARIANTS), ['K0', 'K1', 'K2', 'K3', 'K4', 'K5']);
  assert.equal(VARIANTS.K4.F && VARIANTS.K4.E1 && VARIANTS.K4.O1, true);
  assert.equal(VARIANTS.K5.F, false);
  assert.equal(FILTER_OI15, 6.01);
});

const row = (nets, filtered = false) => ({ variants: Object.fromEntries(Object.keys(VARIANTS).map((v) => [v, filtered && VARIANTS[v].F ? { state: 'filtered' } : { state: 'closed', net: nets, te: Math.random() * 1e9 }])) });
test('scorecard statistics: mean, median, win, drawdown, open and skipped counts', () => {
  const rows = [row(5), row(-50), row(10), row(8), { variants: { K0: { state: 'open' }, K1: { state: 'skip' } } }];
  const s = variantStats(rows, 'K0');
  assert.equal(s.n, 4); assert.equal(s.open, 1); assert.ok(Math.abs(s.mean - (5 - 50 + 10 + 8) / 4) < 1e-9);
  assert.equal(s.median, 6.5); assert.equal(s.win, 75); assert.equal(s.worst, -50); assert.ok(s.dd <= -40);
  assert.equal(variantStats(rows, 'K1').skipped, 1);
  const f = variantStats([row(1, true), row(2, true)], 'K1');
  assert.equal(f.n, 0); assert.equal(f.skipped, 2);
});

test('scorecard text states that nothing was sent and applies the 30-signal gate', () => {
  const rows = Array.from({ length: 31 }, (_, i) => row(i % 4 === 0 ? -10 : 6));
  const t = scorecardText(rows);
  assert.match(t, /kanala hiçbir şey gönderilmedi/);
  assert.match(t, /K0 taban/);
  assert.match(t, /K1: TUTTU/);
  assert.match(scorecardText([row(1)]), /tutmadı \(n=1\/30\)/);
});

import { showcaseDecision, shouldPause } from '../src/shadow.js';
import * as M from '../src/messages.js';

const base = { enabled: true, paused: false, F: true, ageMs: 2 * 3600e3, profitPct: 5, shownToday: 0, perDay: 1, minProfit: 3, delayMs: 40 * 60e3, k1State: 'open' };
test('showcase: only filtered positions that are in profit, after the delay, within the daily cap', () => {
  assert.equal(showcaseDecision(base).act, 'post');
  assert.equal(showcaseDecision({ ...base, profitPct: 1 }).act, 'wait', 'not in profit enough yet');
  assert.equal(showcaseDecision({ ...base, profitPct: -8 }).act, 'wait', 'losing positions are never shown');
  assert.equal(showcaseDecision({ ...base, ageMs: 10 * 60e3 }).act, 'wait', 'too early');
  assert.equal(showcaseDecision({ ...base, shownToday: 1 }).act, 'wait', 'daily cap');
  assert.equal(showcaseDecision({ ...base, F: false }).act, 'skip');
  assert.equal(showcaseDecision({ ...base, F: null }).act, 'skip', 'unknown open-interest data is never shown');
  assert.equal(showcaseDecision({ ...base, ageMs: 7 * 3600e3 }).act, 'skip', 'window over');
  assert.equal(showcaseDecision({ ...base, k1State: 'closed' }).act, 'skip', 'already closed (stopped) before it was shown');
  assert.equal(showcaseDecision({ ...base, enabled: false }).act, 'wait', 'kill switch');
  assert.equal(showcaseDecision({ ...base, paused: true }).act, 'wait', 'auto-pause');
});

test('auto-pause: ten filtered signals summing to -30 points or worse', () => {
  assert.equal(shouldPause(Array(9).fill(-10)), false, 'needs ten results');
  assert.equal(shouldPause([...Array(10).fill(-3)]), true);
  assert.equal(shouldPause([...Array(10).fill(2)]), false);
});

test('v1k free messages: honest showcase note, risk line, result shows losses, no invented statistics', () => {
  const row = { symbol: 'FOOUSDT', sig_at: '2026-11-04T13:00:00Z', key: 'v1k|FOOUSDT|1', features: { px: 1.2345, chg24: 80, r15: 6, btc24: -2, oi15: 3.2 }, variants: { K1: { state: 'closed', net: -52.3, exit: 'stop' } } };
  const sc = M.v1kShowcase(row, 4.2);
  assert.match(sc.text, /POSITION IN PROFIT/); assert.match(sc.text, /Not every signal is shown/); assert.match(sc.text, /whatever it is/);
  assert.ok(sc.reply_markup);
  assert.ok(!/win rate|guaranteed|track record|expected return/i.test(sc.text));
  const res = M.v1kResult(row);
  assert.match(res.text, /Stopped out/); assert.match(res.text, /-52\.3%/); assert.match(res.text, /wins and losses/);
  assert.ok(!/track record|average/i.test(res.text), 'no cumulative statistics that only count shown trades');
  const vip = M.v1kSignal(row);
  assert.match(vip, /1x leverage only/);
});

import { ENV } from '../src/config.js';
import { publishSignal, publishPendingFree, publishDailyRecap, publishWeekly, publishMonthly, publishResult } from '../src/publisher.js';

test('FADE engine is recorded but not published; v1k is the VIP engine', async () => {
  assert.equal(ENV.fadePublish, false, 'FADE_PUBLISH defaults to off');
  assert.equal(ENV.v1kVipPerDay, 2);
  // with publishing off none of these may touch Telegram or the database (the test environment has neither)
  await publishSignal({ symbol: 'FOOUSDT', key: 'k' });
  assert.equal(await publishPendingFree(), 0);
  await publishDailyRecap(); await publishWeekly(); await publishMonthly();
  // a never-published signal produces no result post
  await publishResult({ symbol: 'FOOUSDT', key: 'k', vip_msg_id: null, free_posted_at: null });
});
