// Backtest infrastructure: archive parsing, trade simulation rules, statistics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { unzipFirst, parseKlines, parseMetrics, parseFunding } from '../bt/archive.js';
import { simulate, portfolio, DEFAULTS } from '../bt/engine.js';
import { bootstrapLB, benjaminiHochberg, equityTest, summarize } from '../bt/stats.js';
import { btEval, atr, CFG } from '../bt/hudcore.js';

function makeZip(name, text) {
  const raw = Buffer.from(text), def = zlib.deflateRawSync(raw);
  const nm = Buffer.from(name);
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(def.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(def.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(nm.length, 28); cd.writeUInt32LE(0, 42);
  const body = Buffer.concat([lh, nm, def]);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(cd.length + nm.length, 12); eocd.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, cd, nm, eocd]);
}

test('zip reader inflates a single-file archive', () => {
  assert.equal(unzipFirst(makeZip('a.csv', 'hello,world\n1,2\n')).toString(), 'hello,world\n1,2\n');
});

test('kline csv: header skipped, microsecond timestamps normalised', () => {
  const k = parseKlines('open_time,open,high,low,close,volume,close_time,quote_volume,count,tbv,tbq,ignore\n1735689600000,1,2,0.5,1.5,10,0,15,3,4,6,0\n1735690500000000,1.5,2,1,1.8,5,0,9,2,2,4,0\n');
  assert.equal(k.length, 2);
  assert.equal(k[0].t, 1735689600000); assert.equal(k[1].t, 1735690500000);
  assert.equal(k[0].tb, 4); assert.equal(k[0].q, 15);
});

test('metrics and funding csv parse', () => {
  const m = parseMetrics('create_time,symbol,sum_open_interest,sum_open_interest_value,a,b,c,d\n2025-01-01 00:05:00,X,100.5,2000,1,1,1,1\n');
  assert.equal(m[0].t, Date.UTC(2025, 0, 1, 0, 5)); assert.equal(m[0].v, 100.5);
  const f = parseFunding('calc_time,funding_interval_hours,last_funding_rate\n1735689600000,8,0.0001\n');
  assert.equal(f[0].r, 0.0001);
});

const BAR = 9e5;
const mk = (rows) => rows.map((r, n) => ({ t: n * BAR, o: r[0], h: r[1], l: r[2], c: r[3], v: 1, q: 1, tb: 0 }));
const P = { ...DEFAULTS };

test('limit short: not filled within 8 candles is cancelled and counted', () => {
  const k = mk(Array.from({ length: 20 }, () => [100, 100.5, 99, 100]));
  const r = simulate(k, 0, 'S', 101, 105, 97, P);
  assert.equal(r.filled, false);
});

test('stop wins when stop and target are in the same candle', () => {
  const k = mk([[100, 100, 100, 100], [100, 101.5, 100, 101], [101, 106, 96, 100], ...Array(40).fill([100, 100, 100, 100])]);
  const r = simulate(k, 0, 'S', 101, 105, 97, P);       // fills on candle 1, stop+target both inside candle 2
  assert.equal(r.exit, 'stop');
  assert.ok(r.gross < 0);
});

test('target on the fill candle only counts if the candle closed beyond it', () => {
  const closedAbove = mk([[100, 100, 100, 100], [100, 101.5, 96, 99], ...Array(40).fill([99, 99.5, 98.5, 99])]);
  assert.notEqual(simulate(closedAbove, 0, 'S', 101, 105, 97, P).exit, 'tp');
  const closedBeyond = mk([[100, 100, 100, 100], [100, 101.5, 96, 96.5], ...Array(40).fill([96.5, 97, 96, 96.5])]);
  assert.equal(simulate(closedBeyond, 0, 'S', 101, 105, 97, P).exit, 'tp');
});

test('costs: 20 bp round trip, 20 bp more on a stop; funding added for shorts when positive', () => {
  const k = mk([[100, 100, 100, 100], [100, 101.5, 100, 101], [101, 103, 100, 102], [102, 106, 101, 105], ...Array(40).fill([100, 100, 100, 100])]);
  const r = simulate(k, 0, 'S', 101, 105, 97, P, [{ t: 2 * BAR, r: 0.0001 }]);
  assert.equal(r.exit, 'stop');
  assert.ok(Math.abs(r.cost - 0.40) < 1e-9);
  assert.ok(Math.abs(r.fund - 0.01) < 1e-9);
  assert.ok(Math.abs(r.net - (r.gross - 0.40 + 0.01)) < 1e-9);
});

test('time exit after 32 candles from the fill candle', () => {
  const k = mk([[100, 100, 100, 100], [100, 101.2, 100, 101], ...Array(60).fill([101, 101.4, 100.6, 101])]);
  const r = simulate(k, 0, 'S', 101, 105, 97, P);
  assert.equal(r.exit, 'time');
  assert.equal(r.tEnd, (1 + 31) * BAR + BAR);
});

test('portfolio: one per coin, at most two open at once', () => {
  const s = (c, tS, tEnd) => ({ s: c, tS, tEnd, filled: true });
  const t = portfolio([s('A', 0, 100), s('A', 10, 20), s('B', 5, 50), s('C', 6, 40), s('D', 120, 130)]);
  assert.deepEqual(t.map((x) => x.s), ['A', 'B', 'D']);
});

test('btEval never reads candles after index i (no look-ahead)', async () => {
  // Build a pump-like series, run btEval at i on the full array and on the array cut at i: results must match.
  const k = []; let px = 100;
  for (let n = 0; n < 400; n++) {
    const up = n > 300 && n < 330 ? 1.012 : n >= 330 ? 0.9985 : 1 + Math.sin(n / 7) * 0.002;
    const o = px; px = px * up; k.push({ t: n * BAR, o, h: Math.max(o, px) * 1.003, l: Math.min(o, px) * 0.997, c: px, v: 100, tb: 40 });
  }
  const A = atr(k, 14); let cu = 0; const cvd = k.map((x) => { cu += 2 * x.tb - x.v; return cu; });
  const oi = async (ts) => ({ t: ts, v: 1000 - (ts / BAR) * 0.5 });
  for (const i of [340, 350, 360]) {
    const full = await btEval(k, A, cvd, i, oi, 'S');
    const cut = await btEval(k.slice(0, i + 1), A.slice(0, i + 1), cvd.slice(0, i + 1), i, oi, 'S');
    assert.deepEqual(full, cut);
  }
});

test('stats: bootstrap lower bound is below the mean; BH keeps small p only', () => {
  const trades = Array.from({ length: 200 }, (_, n) => ({ tS: n * 864e5 / 4, net: n % 3 === 0 ? -1 : 0.8 }));
  const s = summarize(trades);
  assert.ok(s.lb90 < s.mean);
  assert.deepEqual(benjaminiHochberg([0.001, 0.2, 0.9], 0.10), [true, false, false]);
  assert.ok(bootstrapLB(trades) > -5);
});

test('equity test: positive trades compound, max 2 open enforced', () => {
  const t = [
    { filled: true, tFill: 0, tEnd: 10, net: 5 }, { filled: true, tFill: 1, tEnd: 10, net: 5 },
    { filled: true, tFill: 2, tEnd: 10, net: 5 }, { filled: true, tFill: 20, tEnd: 30, net: -5 },
  ];
  const r = equityTest(t, { frac: 0.1, lev: 2, maxOpen: 2 });
  assert.equal(r.skipped, 1);
  assert.ok(r.final > 0.99 && r.final < 1.03);
});

test('HUD config is the original one, limit style', () => {
  assert.equal(CFG.stopMode, 0); assert.equal(CFG.minPumpPct, 15); assert.equal(CFG.rrTarget, 1); assert.equal(CFG.maxStopPct, 6);
});

import { spearman, ranks, learn, scoreOf, select, dedupePerCoin } from '../bt/lab.js';

test('spearman: perfect, inverse and unrelated', () => {
  const x = Array.from({ length: 50 }, (_, i) => i);
  assert.ok(spearman(x, x) > 0.999);
  assert.ok(spearman(x, x.map((v) => -v)) < -0.999);
  assert.ok(Math.abs(spearman(x, x.map((v) => (v * 37) % 11))) < 0.4);
  assert.deepEqual(ranks([5, 5, 1]), [2.5, 2.5, 1]);
});

test('lab: a planted feature is found, a noise feature is not, and selection obeys 2 per day', () => {
  const r = rng2(3); const sigs = [];
  for (let n = 0; n < 1200; n++) {
    const volX = r() * 5, noise = r();
    sigs.push({ s: 'C' + n, tS: Date.UTC(2025, n % 9, 1 + (n % 27), 3), tEnd: Date.UTC(2025, n % 9, 1 + (n % 27), 9), filled: true,
      volX, atrPct: noise, net: (volX - 2.5) + (r() - 0.5) * 2 });
  }
  const { chosen } = learn(sigs, 2);
  assert.equal(chosen[0].f, 'volX');
  assert.ok(!chosen.slice(0, 1).some((c) => c.f === 'atrPct'));
  const sel = select(sigs, chosen, 0.5, { perDay: 2 });
  const perDay = new Map(); sel.forEach((x) => perDay.set(Math.floor(x.tS / 864e5), (perDay.get(Math.floor(x.tS / 864e5)) || 0) + 1));
  assert.ok([...perDay.values()].every((c) => c <= 2));
  assert.ok(sel.reduce((a, x) => a + x.net, 0) / sel.length > sigs.reduce((a, x) => a + x.net, 0) / sigs.length);
});
function rng2(seed) { let a = seed; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }
