// Engine lab: shadow trades are summarised separately from published ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketize, shadowReport } from '../src/tracker.js';

const t = (grade, r, extra = {}) => ({ grade, r_net: r, status: r > 0 ? 'kazanç' : 'kayıp', dir: 'S', session: 'Asia', type: 'fade', ...extra });

test('bucketize groups by key and ignores unfinished or skipped rows', () => {
  const rows = [t('A', 1), t('A', -1), t('B', 2), { grade: 'B', status: 'takip', r_net: null }, t('C', 1, { status: 'atlandı' })];
  const b = bucketize(rows, (x) => x.grade);
  assert.equal(b.A.n, 2);
  assert.equal(b.A.win, 1);
  assert.equal(b.B.n, 1);
  assert.equal(b.C, undefined);
});

test('shadowReport warns on small samples and separates published from shadow', () => {
  const real = [t('A', 1.5)];
  const shadow = [t('C', -1, { skip_why: 'grade:C' }), t('B', 0.8, { skip_why: 'gate:pozisyon dolu' })];
  const txt = shadowReport(real, shadow);
  assert.match(txt, /ENGINE LAB/);
  assert.match(txt, /1 published, 2 shadow/);
  assert.match(txt, /noise/);
  assert.match(txt, /PUBLISHED/);
  assert.match(txt, /gate/);
  assert.match(txt, /grade/);
});

test('shadowReport with nothing yet does not crash', () => {
  assert.match(shadowReport([], []), /no finished trades yet/);
});

import { candidateMoments } from '../src/backtest.js';

test('candidateMoments picks big 24h moves, spaced, with room to track', () => {
  // 96 bars/day. Price flat at 100 then doubles at bar 150 and stays.
  const k = Array.from({ length: 300 }, (_, i) => ({ t: i * 9e5, c: i < 150 ? 100 : 130 }));
  const m = candidateMoments(k, { barsPerDay: 96, minChg: 8, step: 8, future: 32 });
  assert.ok(m.length > 0);
  assert.ok(m.every((x) => x.dir === 'S' && x.chg > 8));
  assert.ok(m.every((x) => x.i < 300 - 32 - 1), 'always leaves bars to track');
  const gaps = m.slice(1).map((x, i) => x.i - m[i].i);
  assert.ok(gaps.every((g) => g === 8));
});

test('candidateMoments flags dumps as long candidates', () => {
  const k = Array.from({ length: 300 }, (_, i) => ({ t: i * 9e5, c: i < 150 ? 100 : 80 }));
  const m = candidateMoments(k, { barsPerDay: 96, minChg: 8, step: 8, future: 32 });
  assert.ok(m.length && m.every((x) => x.dir === 'L'));
});
