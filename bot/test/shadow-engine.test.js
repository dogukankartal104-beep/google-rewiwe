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

import { publishGuard, shouldPause } from '../src/shadow.js';
import * as M from '../src/messages.js';

test('publish guard: kill switch, pause, filter and the daily cap each stop a signal', () => {
  const base = { F: true, enabled: true, paused: false, publishedToday: 0 };
  assert.equal(publishGuard(base).ok, true);
  assert.equal(publishGuard({ ...base, enabled: false }).ok, false);
  assert.equal(publishGuard({ ...base, paused: true }).ok, false);
  assert.equal(publishGuard({ ...base, F: false }).ok, false);
  assert.equal(publishGuard({ ...base, F: null }).ok, false, 'unknown open-interest data is never published');
  assert.equal(publishGuard({ ...base, publishedToday: 2 }).ok, false);
});

test('auto-pause: ten published signals summing to -30 points or worse', () => {
  assert.equal(shouldPause(Array(9).fill(-10)), false, 'needs ten results');
  assert.equal(shouldPause([...Array(10).fill(-3)]), true);
  assert.equal(shouldPause([...Array(10).fill(2)]), false);
});

test('v1k messages: risk note, no invented performance, results show losses too', () => {
  const row = { symbol: 'FOOUSDT', sig_at: '2026-11-04T13:00:00Z', key: 'v1k|FOOUSDT|1', features: { px: 1.2345, chg24: 80, r15: 6, btc24: -2, oi15: 3.2 }, variants: { K1: { state: 'closed', net: -52.3, exit: 'stop' } } };
  const sig = M.v1kSignal(row);
  assert.match(sig, /EXPERIMENTAL/); assert.match(sig, /1x leverage only, at most 5%/); assert.match(sig, /no proven track record/);
  assert.ok(!/win rate|guaranteed|profitable|expected return/i.test(sig));
  assert.match(sig, /1\.8518/, 'stop is +50% of the entry');
  const st = M.v1kStats([{ ...row, features: { ...row.features, pub: { vip_at: 1 } } }]);
  assert.deepEqual([st.n, st.wins], [1, 0]);
  const res = M.v1kResult(row, st, { forFree: true });
  assert.match(res.text, /Stopped out/); assert.match(res.text, /-52\.3%/); assert.match(res.text, /unproven/);
  assert.ok(res.reply_markup);
});
