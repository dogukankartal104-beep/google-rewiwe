// Rate-limit handling and flaky news sources. fetch is stubbed, nothing touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { api, FAPI, CG } from '../src/binance.js';
import * as N from '../src/news.js';

const withFetch = async (stub, fn) => {
  const saved = globalThis.fetch;
  globalThis.fetch = stub;
  try { return await fn(); } finally { globalThis.fetch = saved; }
};
const ok = (body) => ({ ok: true, status: 200, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) });
const limited = (retryAfter = 0) => ({
  ok: false, status: 429, headers: new Headers(retryAfter ? { 'retry-after': String(retryAfter) } : {}),
  json: async () => ({}), text: async () => 'slow down',
});

test('a 429 from CoinGecko does not make the next Binance call wait', async () => {
  // Before, the pause was one global timer, so a CoinGecko 429 delayed every Binance request too.
  const hosts = [];
  await withFetch(async (url) => {
    const host = new URL(url).host;
    hosts.push(host);
    return host.includes('coingecko') ? limited() : ok({ fine: true });
  }, async () => {
    await assert.rejects(() => api('/search', { query: 'X' }, CG, 1), /rate limit/);
    const t0 = Date.now();
    const r = await api('/fapi/v1/ping', {}, FAPI, 1);
    const took = Date.now() - t0;
    assert.deepEqual(r, { fine: true });
    assert.ok(took < 1500, `the Binance call waited ${took}ms behind a CoinGecko pause`);
  });
  assert.ok(hosts.some((h) => h.includes('coingecko')) && hosts.some((h) => h.includes('binance')));
});

test('the pause is still honoured for the host that rate-limited us', async () => {
  let calls = 0;
  await withFetch(async () => (++calls === 1 ? limited(1) : ok({ later: true })), async () => {
    const t0 = Date.now();
    const r = await api('/fapi/v1/time', {}, FAPI, 3);
    assert.deepEqual(r, { later: true });
    assert.ok(Date.now() - t0 >= 900, 'should have waited out the Retry-After');
    assert.equal(calls, 2);
  });
});

test('a news source that failed is skipped for a while instead of retried every cycle', async () => {
  N._feedDown.clear();
  const hits = {};
  const RSS = '<rss><channel><item><title>Fed announces rate decision today</title><link>https://x/1</link></item></channel></rss>';
  await withFetch(async (url) => {
    const host = new URL(url).host;
    hits[host] = (hits[host] || 0) + 1;
    if (host.includes('dead')) return { ok: false, status: 522, text: async () => '' };
    return { ok: true, status: 200, text: async () => RSS };
  }, async () => {
    const saved = process.env.NEWS_FEEDS;
    process.env.NEWS_FEEDS = 'https://dead.example/rss,https://alive.example/rss';
    try {
      const first = await N.collect({ hours: 24 });
      const second = await N.collect({ hours: 24 });
      assert.ok(first.length >= 1 && second.length >= 1, 'the working source keeps delivering');
      assert.equal(hits['dead.example'], 1, 'the dead source was only tried once');
      assert.equal(hits['alive.example'], 2, 'the working source is asked every time');
    } finally {
      if (saved === undefined) delete process.env.NEWS_FEEDS; else process.env.NEWS_FEEDS = saved;
      N._feedDown.clear();
    }
  });
});

test('after the cooldown a failed source is tried again', async () => {
  N._feedDown.clear();
  N._feedDown.set('dead.example', Date.now() - 1);       // cooldown already over
  let tried = 0;
  await withFetch(async () => { tried++; return { ok: false, status: 522, text: async () => '' }; }, async () => {
    const saved = process.env.NEWS_FEEDS;
    process.env.NEWS_FEEDS = 'https://dead.example/rss';
    try { await N.collect({ hours: 24 }); } finally {
      if (saved === undefined) delete process.env.NEWS_FEEDS; else process.env.NEWS_FEEDS = saved;
    }
  });
  assert.equal(tried, 1);
  N._feedDown.clear();
});
