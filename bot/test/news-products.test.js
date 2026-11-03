// VIP vs free news products, de-duplication, HTML safety, and the macro-event veto.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as N from '../src/news.js';
import * as M from '../src/messages.js';
import * as MA from '../src/macro.js';
import { baseCtx } from '../src/scanner.js';
import { ENV } from '../src/config.js';

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const min = (m) => NOW - m * 60_000;

const story = (over = {}) => ({
  uid: 'u1', title: 'Binance suffers a major security breach, funds stolen', url: 'https://ex.com/a?x=1&y=2',
  source: 'Cointelegraph', at: min(10), lang: 'en', score: 90, tags: ['SECURITY'],
  why: 'Security incidents trigger a sudden flight of liquidity.', tip: N.TIPS.SECURITY, ...over,
});
const ctx = {
  btc15: -2.1, rejim: 'aşağı rejim', shock: 1.2,
  coins: [{ base: 'BNB', chg: -3.2, watch: true }],
  open: [{ symbol: 'WIFUSDT', dir: 'S', open_r: 1.35 }],
  macro: null,
};

/* ======================= VIP AND FREE GET DIFFERENT PRODUCTS ======================= */
test('VIP flash has the desk view; the free one does not', () => {
  const vip = M.newsFlash(story(), ctx, { forFree: false });
  const free = M.newsFlash(story(), { vipAgoMs: 25 * 60_000 }, { forFree: true });

  assert.match(vip.text, /Desk view/);
  assert.match(vip.text, /Market: BTC 15m -2\.10%/);
  assert.match(vip.text, /Named in the story: BNB -3\.20% \(24h\) · on our watchlist/);
  assert.match(vip.text, /Open book: WIF ▼ \+1\.35R/);
  assert.match(vip.text, /System stance/);
  assert.ok(vip.text.includes(N.TIPS.SECURITY.slice(0, 40)), 'the how-to-trade tip');
  assert.equal(vip.reply_markup, undefined, 'VIP members are already inside');

  assert.ok(!/Desk view\*?<\/b>/.test(free.text), 'free must not carry the desk view');
  assert.ok(!/Open book|System stance|Named in the story/.test(free.text), 'no live book details for free');
  assert.ok(!free.text.includes(N.TIPS.SECURITY.slice(0, 40)), 'the tip is a VIP perk');
  assert.match(free.text, /VIP members saw this 25m ago/);
  assert.ok(free.reply_markup?.inline_keyboard?.[0]?.[0]?.url, 'free story links to VIP');
});

test('the two versions share the story but not the extras', () => {
  const vip = M.newsFlash(story(), ctx).text;
  const free = M.newsFlash(story(), {}, { forFree: true }).text;
  for (const t of [vip, free]) {
    assert.match(t, /Binance suffers a major security breach/);
    assert.match(t, /Why it matters/);
    assert.match(t, /Not financial advice/);
    assert.ok(!/undefined|NaN|\[object/.test(t));
  }
  assert.ok(vip.length > free.length, 'VIP is the richer message');
});

test('label follows the age: BREAKING only when it really is', () => {
  assert.match(M.newsFlash(story({ at: Date.now() - 10 * 60_000 })).text, /BREAKING/);
  const old = M.newsFlash(story({ at: Date.now() - 3 * 3600_000 })).text;
  assert.ok(!/BREAKING/.test(old), 'a 3 hour old story is not breaking');
  assert.match(old, /NEWS/);
});

test('the system stance reflects a macro window and a BTC shock', () => {
  assert.match(M.newsFlash(story(), { ...ctx, macro: { lvl: 'kırmızı' } }).text, /inside a macro window — no new positions/);
  assert.match(M.newsFlash(story(), { ...ctx, shock: 3.4 }).text, /BTC is in shock — no new positions/);
  assert.match(M.newsFlash(story(), { ...ctx, macro: null }).text, /normal operation/);
});

test('every topic has a tip, and none of them predicts or promises anything', () => {
  for (const tag of ['SECURITY', 'INSOLVENCY', 'LIQUIDATION', 'REGULATION', 'ETF', 'MACRO', 'EXCHANGE', 'WHALE', 'NETWORK', 'FRAUD', 'MARKET']) {
    const tip = N.TIPS[tag];
    assert.ok(tip && tip.length > 30, `missing tip for ${tag}`);
    assert.ok(!/will (rise|fall|pump|dump|crash)|guarantee|certain|sure thing|buy now|sell now/i.test(tip), tip);
  }
  const s = N.scoreItem('Binance hacked, 200M USD stolen');
  assert.equal(s.tip, N.TIPS.SECURITY);
});

/* ======================= TELEGRAM HTML SAFETY ======================= */
test('headlines are HTML-escaped so a "<" cannot break the whole message', () => {
  const nasty = story({ title: 'BTC <$60k & ETH "crash" </b><script>', source: 'A&B <news>', url: 'https://x.com/?a="b"&c=<d>' });
  for (const forFree of [false, true]) {
    const { text } = M.newsFlash(nasty, ctx, { forFree });
    assert.ok(!/<script>|<\$60k|<news>|<d>/.test(text), 'raw angle brackets must not survive');
    assert.match(text, /BTC &lt;\$60k &amp; ETH "crash" &lt;\/b&gt;&lt;script&gt;/);
    assert.ok(!/href="[^"]*"[^>]*"/.test(text.replace(/href="[^"]*"/, '')), 'attribute quotes escaped');
    assert.match(text, /href="https:\/\/x\.com\/\?a=&quot;b&quot;&amp;c=&lt;d&gt;"/);
  }
  const dig = M.newsDigest([nasty], {}).text;
  assert.ok(!/<script>/.test(dig));
});

/* ======================= NO DUPLICATES ======================= */
test('similarity: paraphrases of one event match, different events do not', () => {
  assert.ok(N.similarity('Fed faiz kararını açıkladı', 'Fed, faiz kararını açıkladı: piyasalar sert hareketlendi') >= 0.5);
  assert.ok(N.similarity('Binance Kurucusu CZ, 6,3 Milyar Dolarlık Hack Sonrası İlk Kez Konuştu!',
    'Fed faiz kararını açıkladı, piyasalar hareketlendi') < 0.5);
  assert.equal(N.similarity('Short one', 'Short two'), 0, 'too short to compare');
});

test('isDuplicate: same id, similar headline, same topic cooldown', () => {
  const posted = { uid: 'old', title: 'Binance suffers a major security breach, funds stolen', tags: 'SECURITY', posted_at: new Date(NOW - 60 * 60_000).toISOString() };
  const ok = (it, opts) => N.isDuplicate(it, [posted], { now: NOW, cooldownMs: 6 * 3600e3, ...opts });

  assert.equal(ok({ uid: 'old', title: 'x', tags: ['MARKET'] }).dup, true, 'same id');
  assert.equal(ok({ uid: 'new', title: 'Binance suffers major security breach; funds were stolen', tags: ['MARKET'] }).dup, true, 'similar headline');
  assert.equal(ok({ uid: 'new', title: 'Exchange wallets drained overnight, investigators arrive', tags: ['SECURITY'] }).dup, true, 'same topic inside the cooldown');
  assert.equal(ok({ uid: 'new', title: 'Exchange wallets drained overnight, investigators arrive', tags: ['SECURITY'] },
    { now: NOW + 7 * 3600e3 }).dup, false, 'the cooldown expires');
  assert.equal(ok({ uid: 'new', title: 'Fed raises interest rates by a quarter point', tags: ['MACRO'] }).dup, false, 'a different story');
  assert.equal(N.isDuplicate({ uid: 'a', title: 'zzz yyy xxx www', tags: ['X'] }, [{ uid: 'a-f', title: 'q', tags: '', posted_at: new Date().toISOString() }]).dup, true, 'free copy counts');
});

test('pickFlash: skips stale and duplicate stories, takes the best fresh one', () => {
  const items = [
    story({ uid: 'stale', score: 95, at: NOW - 3 * 3600e3 }),
    story({ uid: 'dup', score: 90, at: min(5) }),
    story({ uid: 'good', score: 60, at: min(5), title: 'Fed announces rate decision today', tags: ['MACRO'] }),
    story({ uid: 'weak', score: 10, at: min(5), title: 'Quiet day for altcoins', tags: ['MARKET'] }),
  ];
  const recent = [{ uid: 'dup', title: items[1].title, tags: 'SECURITY', posted_at: new Date(NOW - 20 * 60_000).toISOString() }];
  const pick = N.pickFlash(items, recent, { minScore: 38, maxAgeMs: 90 * 60_000, cooldownMs: 6 * 3600e3, now: NOW });
  assert.equal(pick.uid, 'good');
  assert.equal(N.pickFlash([items[3]], [], { minScore: 38, maxAgeMs: 90 * 60_000, now: NOW }), null, 'below the threshold');
  assert.equal(N.pickFlash([items[0]], [], { minScore: 38, maxAgeMs: 90 * 60_000, now: NOW }), null, 'too old to be breaking');
});

test('the Binance saga: four differently worded headlines produce ONE post', () => {
  // the real headlines that all went out on the same afternoon
  const heads = [
    ['a', 'Binance Saldırısının Nasıl Yapıldığı Açıklandı! Resmi Açıklama Yapıldı'],
    ['b', 'Binance Kurucusu CZ, 6,3 Milyar Dolarlık Hack Sonrası İlk Kez Konuştu! ABD’ye Seslendi!'],
    ['c', 'Binance saldırısı sonrası Ethereum arzı borsalarda hızla geriledi'],
    ['d', 'Hack saldırısı Binance’in fonuna darbe vurdu: Bitcoin’lerin yarısı gitti!'],
  ].map(([uid, title]) => ({ uid, title, ...N.scoreItem(title, { lang: 'tr' }), at: min(10), url: '', source: 'x' }));

  const posted = [];
  for (const it of heads) {
    const pick = N.pickFlash([it], posted, { minScore: 38, maxAgeMs: 90 * 60_000, cooldownMs: 6 * 3600e3, now: NOW });
    if (pick) posted.push({ uid: pick.uid, title: pick.title, tags: pick.tags.join(','), posted_at: new Date(NOW).toISOString() });
  }
  assert.equal(posted.length, 1, `expected one post, got ${posted.length}`);
});

/* ======================= COINS NAMED IN A HEADLINE ======================= */
test('mentionedCoins: finds tradable coins, ignores non-coin acronyms', () => {
  const tick = [{ s: 'BNBUSDT', c: -3.2 }, { s: 'BTCUSDT', c: -1.1 }, { s: 'ETHUSDT', c: -2.4 }, { s: 'SECUSDT', c: 9 }, { s: 'CZUSDT', c: 1 }];
  const out = N.mentionedCoins('Binance hacked, Bitcoin and ETH fall, SEC and CZ comment', tick, new Set(['ETHUSDT']));
  const bases = out.map((c) => c.base).sort();
  assert.deepEqual(bases, ['BNB', 'BTC', 'ETH']);
  assert.equal(out.find((c) => c.base === 'ETH').watch, true);
  assert.equal(out.find((c) => c.base === 'BTC').watch, false);
  assert.deepEqual(N.mentionedCoins('Nothing relevant here', tick), []);
  assert.ok(N.mentionedCoins('BTC ETH BNB SOL XRP DOGE', [...tick, { s: 'SOLUSDT', c: 1 }, { s: 'XRPUSDT', c: 1 }], new Set(), 2).length <= 2, 'capped');
});

/* ======================= MACRO WINDOW ======================= */
test('NFP timing follows New York daylight saving (EST in winter, EDT in summer)', () => {
  // November 2026: first Friday is the 6th, New York is on EST (UTC-5) -> 13:30 UTC
  assert.equal(MA.firstFridayNfp(2026, 10).t, Date.UTC(2026, 10, 6, 13, 30));
  // August 2026: first Friday is the 7th, New York is on EDT (UTC-4) -> 12:30 UTC
  assert.equal(MA.firstFridayNfp(2026, 7).t, Date.UTC(2026, 7, 7, 12, 30));
  assert.equal(new Date(MA.firstFridayNfp(2026, 10).t).getUTCDay(), 5, 'it is a Friday');
});

test('macro window: yellow two hours ahead, red 30 minutes before to 15 after, then clear', () => {
  const t = Date.UTC(2026, 10, 12, 13, 30);
  const events = [{ n: 'CPI', t }];
  const at = (offsetMin) => MA.macroRisk(t + offsetMin * 60_000, { events });
  assert.equal(at(-300).lvl, 'yok');
  assert.equal(at(-100).lvl, 'sarı');
  assert.equal(at(-31).lvl, 'sarı');
  assert.equal(at(-29).lvl, 'kırmızı');
  assert.equal(at(0).lvl, 'kırmızı');
  assert.equal(at(14).lvl, 'kırmızı');
  assert.equal(at(16), null, 'after the window and nothing else queued');
});

test('MACRO_EVENTS adds your own dates', () => {
  const evs = MA.envEvents('2026-11-04T19:00:00Z|FOMC, 2026-11-12T13:30:00Z|CPI, garbage, |x');
  assert.equal(evs.length, 2);
  assert.equal(evs[0].n, 'FOMC');
  assert.equal(evs[1].t, Date.UTC(2026, 10, 12, 13, 30));
});

test('a fresh macro headline holds the veto for 30 minutes, then lets go', () => {
  MA._resetMacroNews();
  const t = Date.UTC(2026, 5, 15, 18, 0);               // a day with no scheduled event nearby
  const events = [];
  assert.equal(MA.macroRisk(t, { events }), null);
  MA.noteMacroNews(t);
  assert.equal(MA.macroRisk(t + 10 * 60_000, { events }).lvl, 'kırmızı');
  assert.equal(MA.macroRisk(t + 29 * 60_000, { events }).lvl, 'kırmızı');
  assert.equal(MA.macroRisk(t + 31 * 60_000, { events }), null);
  MA._resetMacroNews();
});

test('the scanner really passes the macro window to the decision engine (it was null before)', () => {
  const saved = process.env.MACRO_EVENTS;
  MA._resetMacroNews();
  process.env.MACRO_EVENTS = `${new Date(Date.now() + 10 * 60_000).toISOString()}|TEST`;
  try {
    const c = baseCtx();
    assert.ok(c.macro, 'macro must not be null');
    assert.equal(c.macro.lvl, 'kırmızı', 'an event 10 minutes away is inside the veto window');
  } finally {
    if (saved === undefined) delete process.env.MACRO_EVENTS; else process.env.MACRO_EVENTS = saved;
  }
});

/* ======================= SETTINGS ARE SANE ======================= */
test('free news is far stricter than VIP news', () => {
  assert.ok(ENV.newsFreeMinScore > ENV.newsMinScore, 'free only gets bigger stories');
  assert.ok(ENV.newsFreeMaxPerDay <= ENV.newsMaxPerDay, 'free gets fewer posts');
  assert.ok(ENV.newsFreeMaxPerDay <= 1, 'at most one a day on free');
  assert.ok(ENV.newsFreeDelayMin >= 10, 'free comes later than VIP');
  assert.ok(ENV.newsBreakingMin <= 120, 'breaking means recent');
});
