// Single-trade simulator and follower account used by the three-engine analysis.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTrade, COST } from '../bt/analiz/trade.js';
import { follower, cooldown, ci90 } from '../bt/analiz/analyses.js';

const M = 6e4;
const mk = (rows, t0 = 0) => rows.map((r, i) => ({ t: t0 + i * M, o: r[0], h: r[1], l: r[2], c: r[3], v: r[4] ?? 1 }));

test('short: stop is hit on the first candle that touches it, costs include the stop extra', () => {
  const k = mk([[100, 100, 100, 100], [100, 120, 99, 110], [110, 160, 105, 150], [150, 150, 150, 150]]);
  const r = runTrade({ k, dir: 'S', tEntryMs: 0, tExitMs: 10 * M, stopPct: 50 });
  assert.equal(r.exit, 'stop'); assert.equal(r.exitPx, 150);
  assert.ok(Math.abs(r.gross - (-50)) < 1e-9);
  assert.ok(Math.abs(r.cost - (COST.fee + COST.slip + COST.stopExtra)) < 1e-9);
});

test('time exit at the open of the first candle at or after the exit time; funding for a short is received', () => {
  const k = mk([[100, 101, 99, 100], [100, 101, 99, 100], [100, 101, 99, 100], [90, 91, 89, 90]]);
  const r = runTrade({ k, dir: 'S', tEntryMs: 0, tExitMs: 3 * M, stopPct: null, funding: [{ t: 2 * M, r: 0.001 }] });
  assert.equal(r.exit, 'time'); assert.equal(r.exitPx, 90);
  assert.ok(Math.abs(r.gross - 10) < 1e-9);
  assert.ok(Math.abs(r.fund - 0.1) < 1e-9);
  assert.ok(Math.abs(r.net - (10 - 0.15 + 0.1)) < 1e-9);
});

test('long with a -33% stop; zero-volume candles cannot trigger a stop', () => {
  const k = mk([[100, 100, 100, 100], [100, 100, 10, 100, 0], [100, 100, 60, 90], [90, 90, 60, 60]]);
  const r = runTrade({ k, dir: 'L', tEntryMs: 0, tExitMs: 4 * M, stopPct: 33 });
  assert.equal(r.exit, 'stop');
  assert.equal(r.tExit, 2 * M, 'the zero-volume dip at candle 1 was ignored, the real one at candle 2 stopped it');
  assert.ok(Math.abs(r.exitPx - 67) < 1e-9);
});

test('liquidation: a short at 2x is liquidated before a +50% stop; at 1x the stop comes first', () => {
  const k = mk([[100, 100, 100, 100], [100, 140, 100, 140], [140, 151, 140, 151]]);
  const r = runTrade({ k, dir: 'S', tEntryMs: 0, tExitMs: 5 * M, stopPct: 50 });
  assert.equal(r.liq[2], true); assert.equal(r.liq[1], false);
});

test('no entry candle close to the requested time means no trade', () => {
  const k = mk([[100, 100, 100, 100]], 3600e3);
  assert.equal(runTrade({ k, dir: 'S', tEntryMs: 0, tExitMs: 5 * M, stopPct: 5 }).ok, false);
});

test('follower: 5% margin, a liquidation loses the margin, caps are honoured, drawdown is measured', () => {
  const t = (i, net, liq = false) => ({ tEntry: i * 864e5, tExit: i * 864e5 + 36e5, net, liq: { 1: false, 2: liq } });
  const r1 = follower([t(1, 10), t(2, -20), t(3, 10)], { L: 1 });
  assert.ok(Math.abs(r1.final - 1000 * 1.005 * 0.99 * 1.005) < 1e-6);
  assert.ok(r1.dd < 0);
  const rl = follower([t(1, 10, true)], { L: 2 });
  assert.ok(Math.abs(rl.final - 950) < 1e-6 && rl.liqs === 1);
  const same = [0, 1, 2].map((i) => ({ tEntry: 1000 + i, tExit: 1e9, net: 1, liq: { 1: false } }));
  assert.equal(follower(same, { perDay: 2 }).taken, 2);
  assert.equal(follower(same, { maxOpen: 1 }).taken, 1);
});

test('cooldown keeps one signal per coin per 4 hours; bootstrap interval brackets the mean', () => {
  const s = (c, h) => ({ s: c, tSig: h * 36e5 });
  assert.deepEqual(cooldown([s('A', 0), s('A', 3), s('A', 5), s('B', 1)], 4).map((x) => x.s + x.tSig / 36e5), ['A0', 'B1', 'A5']);
  const items = Array.from({ length: 200 }, (_, i) => ({ tSig: i * 864e5, net: i % 2 ? 2 : 1 }));
  const [lo, hi] = ci90(items);
  assert.ok(lo < 1.5 && hi > 1.5);
});
