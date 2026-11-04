// Images: chart and news-card SVG, rendering, and the safe fallbacks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrap, xml, priceText, candleChartSvg, newsCardSvg, renderPng } from '../src/chart.js';
import * as tg from '../src/telegram.js';
import { ENV } from '../src/config.js';

const cs = Array.from({ length: 60 }, (_, i) => ({ t: i * 9e5, o: 100 + i * 0.1, c: 100.4 + i * 0.1, h: 101 + i * 0.1, l: 99.5 + i * 0.1 }));

test('wrap: respects the width, cuts long text with an ellipsis, never loses short text', () => {
  assert.deepEqual(wrap('a short title', 40, 3), ['a short title']);
  const l = wrap('word '.repeat(60), 30, 3);
  assert.equal(l.length, 3); assert.ok(l.every((x) => x.length <= 30)); assert.match(l[2], /…$/);
  assert.ok(wrap('x'.repeat(200), 20, 2).every((x) => x.length <= 20));
});

test('xml escaping and price formatting', () => {
  assert.equal(xml('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;');
  assert.equal(priceText(1234.567), '1234.6'); assert.equal(priceText(0.00001234), '0.0000123'); assert.equal(priceText(NaN), '—');
});

test('candle chart svg: header, levels, badge, brand and the risk line are all present and escaped', () => {
  const svg = candleChartSvg({ symbol: 'A&BUSDT', candles: cs, tag: 'SHORT', lines: [{ price: 101, label: 'ENTRY' }, { price: 150, label: 'STOP', color: '#ef5350' }], badge: { big: '+3.4%', small: 'IN PROFIT' } });
  assert.match(svg, /A&amp;BUSDT/); assert.match(svg, /ENTRY 101\.00/); assert.match(svg, /STOP 150\.00/); assert.match(svg, /\+3\.4%/); assert.match(svg, /Crypto Pump Radar/);
  assert.equal((svg.match(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" fill="#(26a69a|ef5350)"\/>/g) || []).length, 60, 'one body per candle');
  assert.ok(!/NaN|undefined/.test(svg));
});

test('news card: tag, wrapped headline, source; very long headlines stay inside five lines', () => {
  const svg = newsCardSvg({ title: 'Headline <b> with & symbols '.repeat(12), tag: 'SECURITY', source: 'Decrypt', when: 'just now' });
  assert.match(svg, /SECURITY/); assert.match(svg, /Decrypt · just now/); assert.ok(!/<b>/.test(svg.replace(/<\/?(svg|rect|text|line|defs|linearGradient|stop|tspan)[^>]*>/g, '')));
  assert.ok((svg.match(/font-weight="bold" fill="#f1f3f6"/g) || []).length <= 5);
});

test('rendering produces a real PNG with the bundled font (no system fonts needed)', async () => {
  const png = await renderPng(candleChartSvg({ symbol: 'FOOUSDT', candles: cs, lines: [{ price: 101, label: 'ENTRY' }] }));
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(png.length > 8000, 'text and candles were drawn');
  const card = await renderPng(newsCardSvg({ title: 'ABD seçimleri sonrası ralli', tag: 'MACRO', source: 'x' }));
  assert.ok(card.length > 8000);
});

test('sendCard: without an image it is a plain text post; in DRY_RUN nothing is sent to a channel', async () => {
  const saved = ENV.dryRun; ENV.dryRun = true;
  try {
    const a = await tg.sendCard('-1001234567890', null, 'hello');
    assert.equal(a.dry, true);
    const b = await tg.sendCard('-1001234567890', Buffer.from('png'), 'hello');
    assert.equal(b.dry, true);
  } finally { ENV.dryRun = saved; }
});
