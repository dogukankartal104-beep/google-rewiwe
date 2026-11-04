// Weekly v1k cards, the VIP welcome DM and the free preview.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekStats } from '../src/weekly.js';
import * as M from '../src/messages.js';
import { weekResultsSvg, renderPng } from '../src/chart.js';

const day = 864e5, from = Date.UTC(2026, 10, 2), to = from + 7 * day;
const row = (sym, offDays, net, vip = true, state = 'closed') => ({ symbol: sym + 'USDT', sig_at: new Date(from + offDays * day).toISOString(), features: { pub: vip ? { vip_at: 1 } : {} }, variants: { K1: net === null ? { state: 'open' } : { state, net } } });

test('week stats: only VIP-published signals of that week, wins and losses both counted, open ones listed', () => {
  const rows = [row('AAA', 0.5, 12.4), row('BBB', 1, -52.3), row('CCC', 3, 8), row('DDD', 6.9, null), row('EEE', 2, 99, false), row('FFF', 8, 5), row('GGG', -1, 7)];
  const s = weekStats(rows, from, to);
  assert.equal(s.n, 4); assert.equal(s.won, 2); assert.equal(s.lost, 1); assert.equal(s.open, 1); assert.equal(s.closed, 3);
  assert.deepEqual(s.items.map((x) => x.sym), ['AAA', 'BBB', 'CCC', 'DDD']);
  assert.equal(s.worst.sym, 'BBB'); assert.equal(s.best.sym, 'AAA');
  assert.ok(Math.abs(s.sum - (12.4 - 52.3 + 8)) < 1e-9);
  assert.equal(weekStats([], from, to).n, 0);
});

test('VIP weekly text lists every signal including the loser; free preview has coin names and no numbers or results', () => {
  const st = weekStats([row('AAA', 0.5, 12.4), row('BBB', 1, -52.3), row('CCC', 3, 8)], from, to);
  const vip = M.v1kWeekVip(st, '2 Nov – 8 Nov');
  assert.match(vip, /AAA\s+\+12\.4%/); assert.match(vip, /BBB\s+-52\.3%/); assert.match(vip, /wins and losses/);
  assert.match(vip, /won <b>2<\/b> · lost <b>1<\/b>/);
  const free = M.v1kWeekFree(['AAAUSDT', 'BBBUSDT']);
  assert.match(free.text, /AAA, BBB/); assert.match(free.text, /shop window/);
  assert.ok(!/\d/.test(free.text.replace(/<[^>]+>/g, '')), 'no numbers at all in the free preview');
  assert.ok(!/\b(won|lost|wins?|loss(es)?|profit)\b|%/i.test(free.text), 'no results in the free preview');
  assert.ok(free.reply_markup);
  assert.match(M.v1kWeekFree([]).text, /quiet week/i);
  assert.match(M.v1kWeekVip(weekStats([], from, to), 'x'), /No signal passed the filters/);
});

test('weekly chart: one bar per signal, red and green, renders to a PNG', async () => {
  const svg = weekResultsSvg({ title: 'Weekly results', label: 'x', items: [{ sym: 'AAA', net: 12.4 }, { sym: 'BBB', net: -52.3 }, { sym: 'CCC', net: null }] });
  assert.match(svg, /\+12\.4%/); assert.match(svg, /-52\.3%/); assert.match(svg, />open</);
  assert.equal((svg.match(/rx="4"/g) || []).length, 2);
  const png = await renderPng(svg);
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]); assert.ok(png.length > 6000);
  assert.ok((await renderPng(weekResultsSvg({ title: 't', label: 'l', items: [] }))).length > 3000);
});

test('VIP welcome DM: first steps, the risk rules and the commands, in English and Turkish', () => {
  const en = M.vipWelcomeMsg('en'), tr = M.vipWelcomeMsg('tr');
  for (const t of [en, tr]) { assert.match(t, /1x/); assert.match(t, /5%|%5/); assert.match(t, /\/status/); assert.match(t, /\/how/); assert.ok(!/undefined|NaN/.test(t)); }
  assert.match(en, /Turn notifications on/); assert.match(en, /Never move it further away/); assert.match(en, /Not financial advice/);
  assert.match(tr, /bildirimlerini aç/); assert.match(tr, /Yatırım tavsiyesi değildir/);
  assert.ok(!/guarantee|we make you|profit guaranteed/i.test(en));
});
