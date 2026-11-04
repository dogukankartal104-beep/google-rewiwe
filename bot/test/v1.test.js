// Take-profit ladder and early-exit machinery for the v1 tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateParts, earlyClose, checkEvents, firstTrigger, CELLS_EARLY, TP_CELLS } from '../bt/v1/sim.js';

const M = 6e4;
const mk = (rows) => rows.map((r, i) => ({ t: i * M, o: r[0], h: r[1], l: r[2], c: r[3], v: r[4] ?? 1 }));
const flat = (n, p = 100) => Array.from({ length: n }, () => [p, p, p, p]);

test('single TP at -15% fills and costs 0.15%', () => {
  const k = mk([[100, 100, 100, 100], [100, 101, 84, 86], ...flat(2000, 86)]);
  const r = simulateParts({ k, i0: 0, parts: [{ frac: 1, tp: 15 }] });
  assert.equal(r.exit, 'tp'); assert.ok(Math.abs(r.net - (15 - 0.15)) < 1e-9);
});

test('ladder: thirds fill at -5/-10/-20, weighted net, rest of costs per part', () => {
  const k = mk([[100, 100, 100, 100], [100, 100, 79, 80], ...flat(2000, 80)]);
  const r = simulateParts({ k, i0: 0, parts: TP_CELLS.M1a.parts });
  const gross = (5 + 10 + 20) / 3;
  assert.ok(Math.abs(r.net - (gross - 0.15)) < 1e-9);
  assert.equal(r.parts.length, 3);
});

test('stop wins when stop and TP are in the same candle; stop adds 0.2%', () => {
  const k = mk([[100, 100, 100, 100], [100, 160, 80, 100], ...flat(2000, 100)]);
  const r = simulateParts({ k, i0: 0, parts: [{ frac: 1, tp: 15 }] });
  assert.equal(r.exit, 'stop'); assert.ok(Math.abs(r.net - (-50 - 0.35)) < 1e-9);
});

test('break-even stop after TP1 applies from the NEXT candle', () => {
  // candle 1 hits TP1 (-5%) and also rises to the entry in the same candle: with (b) the stop is not active yet.
  const sameCandle = mk([[100, 100, 100, 100], [100, 101, 94, 99], [99, 101, 99, 100], ...flat(2000, 100)]);
  const b = simulateParts({ k: sameCandle, i0: 0, parts: TP_CELLS.M1b.parts, be: true });
  const sold = b.parts.filter((p) => p.exit === 'stop').length;
  assert.equal(sold, 2, 'the two remaining parts were stopped at the entry on candle 2, not on candle 1');
  const a = simulateParts({ k: sameCandle, i0: 0, parts: TP_CELLS.M1a.parts, be: false });
  assert.equal(a.parts.filter((p) => p.exit === 'stop').length, 0);
});

test('time exit after 24h; funding is received by a short', () => {
  const k = mk([[100, 100, 100, 100], ...flat(1500, 100)]);
  const r = simulateParts({ k, i0: 0, parts: [{ frac: 1, tp: null }], funding: [{ t: 8 * 3600e3, r: 0.0001 }] });
  assert.equal(r.exit, 'time'); assert.ok(Math.abs(r.net - (-0.15 + 0.01)) < 1e-9);
});

test('a path that ends before 24h is reported as not ok', () => {
  assert.equal(simulateParts({ k: mk(flat(100)), i0: 0, parts: [{ frac: 1, tp: null }] }).ok, false);
});

test('earlyClose uses the next candle open', () => {
  const k = mk([[100, 100, 100, 100], ...flat(5, 100), [130, 131, 129, 130]]);
  const r = earlyClose({ k, i0: 0, jx: 6 });
  assert.ok(Math.abs(r.net - (-30 - 0.15)) < 1e-9);
});

test('check events: price, OI change, trigger on the first 15m close that satisfies the cell', () => {
  // entry at minute 0 (aligned to a 15m boundary), price climbs 1%/15m, OI doubles after 45 minutes
  const rows = []; let p = 100;
  for (let i = 0; i < 400; i++) { p = i % 15 === 14 ? p * 1.01 : p; rows.push([p, p * 1.001, p * 0.999, p]); }
  const k = rows.map((r, i) => ({ t: 9e5 * 10 + i * M, o: r[0], h: r[1], l: r[2], c: r[3], v: 1 }));
  const recs = Array.from({ length: 100 }, (_, i) => ({ t: 9e5 * 10 + i * 3e5, u: i < 9 ? 1e6 : 2.3e6, gl: 1.5, tk: 1 }));
  const ce = checkEvents({ k, i0: 0, recs, baseExitT: k[0].t + 864e5, volume24: 1e7 });
  assert.ok(ce.ok && ce.ev.length > 5);
  const trig = firstTrigger(ce, (x) => x.dOI >= 100 && x.P >= 1.5, k, 0);
  assert.ok(trig && trig.dOI >= 100 && trig.P >= 1.5);
  assert.equal(firstTrigger(ce, () => false, k, 0), null);
  assert.ok(CELLS_EARLY.O1({ dOI: 61, P: 16 }) && !CELLS_EARLY.O1({ dOI: 61, P: 14 }));
});
