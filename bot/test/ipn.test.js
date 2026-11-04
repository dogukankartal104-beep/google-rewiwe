// Payment-notification security and correctness. Uses fake dependencies, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { processIpn, amountOk, IpnIgnored, IpnTemporary } from '../src/ipn.js';
import { makeLimiter, makeFailGuard, makeThrottle } from '../src/ratelimit.js';
import { planByName, plansFor, publicPlans, isHiddenPlan } from '../src/vip.js';
import { ENV } from '../src/config.js';
import { startServer } from '../src/server.js';

/* ---------------------------- fakes ---------------------------- */
let n = 0;
const nextOrder = () => `tg${1000 + ++n}-1mo-t${n}`;

function world({ pay = {}, rec = {}, sigOk = true, getPayment = null, grantFails = false } = {}) {
  const orderId = rec.order_id || nextOrder();
  const row = {
    order_id: orderId, telegram_id: 1000 + n, plan: '1mo', amount: 49, currency: 'usd',
    days: 30, credited: false, ...rec,
  };
  const state = { grants: [], alerts: [], dms: [], claims: 0, unclaims: 0, patches: [] };
  const deps = {
    np: {
      verifySig: () => (sigOk ? { ok: true } : { ok: false, reason: 'imza uyuşmadı' }),
      getPayment: getPayment || (async () => ({
        payment_status: 'finished', order_id: orderId, price_amount: 49, price_currency: 'usd',
        pay_currency: 'usdttrc20', actually_paid: 49, ...pay,
      })),
      DONE: new Set(['finished', 'confirmed']),
      BAD: new Set(['failed', 'refunded', 'expired']),
      statusTr: (s) => s,
      tgFromOrderId: (o) => Number(/^tg(\d+)-/.exec(o)?.[1]) || null,
    },
    db: {
      payByOrder: async (o) => (o === row.order_id ? { ...row } : null),
      payPatch: async (o, p) => { state.patches.push(p); },
      // atomic by construction: a synchronous check-and-set, exactly like the SQL UPDATE ... WHERE credited=false
      payClaim: async (o) => { if (row.credited) return null; row.credited = true; state.claims++; return { ...row }; },
      payUnclaim: async () => { row.credited = false; state.unclaims++; },
      getUserLang: async () => 'en',
    },
    vip: {
      grant: async (tg, plan, opts) => {
        await new Promise((r) => setTimeout(r, 5));   // widen the race window
        if (grantFails) throw new Error('telegram exploded');
        state.grants.push({ tg, plan, ...opts });
      },
      notifyAdmins: async (t) => { state.alerts.push(t); },
    },
    tg: { send: async (id, t) => { state.dms.push({ id, t }); } },
  };
  return { orderId, row, state, deps };
}
const body = (extra = {}) => JSON.stringify({ payment_id: 777, ...extra });
const run = (w, raw = body(), opts) => processIpn(raw, 'sig', w.deps, opts);

/* ======================= HAPPY PATH ======================= */
test('a finished payment grants VIP exactly once, using our own record', async () => {
  const w = world();
  const r = await run(w);
  assert.equal(r.granted, true);
  assert.equal(w.state.grants.length, 1);
  assert.equal(w.state.grants[0].plan, '1mo');
  assert.equal(w.state.grants[0].amount, 49);
});

test('"confirmed" also grants (access should not wait for the payout)', async () => {
  const w = world({ pay: { payment_status: 'confirmed' } });
  assert.equal((await run(w)).granted, true);
});

/* ======================= DOUBLE-GRANT RACE ======================= */
test('FIVE simultaneous notifications for one payment grant only once', async () => {
  // NOWPayments sends several notifications per payment (and retries). The old
  // read-then-write check let concurrent ones all pass and grant repeatedly.
  const w = world();
  const results = await Promise.all([run(w), run(w), run(w), run(w), run(w)]);
  assert.equal(w.state.grants.length, 1, 'must grant exactly once');
  assert.equal(results.filter((r) => r.granted).length, 1);
  assert.equal(w.state.claims, 1);
});

test('negative control: a NON-atomic claim really does double-grant (so the race test has teeth)', async () => {
  // This is the logic the code had before: read "credited", then write it later.
  const w = world();
  w.deps.db.payClaim = async () => {
    const seen = w.row.credited;                    // read
    await new Promise((r) => setTimeout(r, 2));     // ...another request slips in here...
    if (seen) return null;
    w.row.credited = true;                          // write
    return { ...w.row };
  };
  await Promise.all([run(w), run(w), run(w)]);
  assert.ok(w.state.grants.length > 1, `the old logic granted ${w.state.grants.length} times`);
});

test('a repeated notification after the grant does nothing', async () => {
  const w = world();
  await run(w);
  const again = await run(w);
  assert.equal(again.note, 'already credited');
  assert.equal(w.state.grants.length, 1);
});

test('if the grant itself fails the claim is given back so the retry can succeed', async () => {
  const w = world({ grantFails: true });
  await assert.rejects(() => run(w), /telegram exploded/);
  assert.equal(w.state.unclaims, 1);
  assert.equal(w.row.credited, false);
  w.deps.vip.grant = async (tg, plan, opts) => { w.state.grants.push({ tg, plan, ...opts }); };
  assert.equal((await run(w)).granted, true);
  assert.equal(w.state.grants.length, 1);
});

/* ======================= TRUST: THE BODY IS NOT TRUSTED ======================= */
test('order, plan and amount come from our records and the API, never from the request body', async () => {
  const mine = world({ rec: { plan: '1mo', amount: 49 } });
  const forged = JSON.stringify({
    payment_id: 777, order_id: 'someone-elses-order', plan: '12mo', amount: 0.01,
    payment_status: 'finished', price_amount: 999999,
  });
  const r = await run(mine, forged);
  assert.equal(r.granted, true);
  assert.equal(mine.state.grants[0].plan, '1mo', 'plan is from our database, not the body');
  assert.equal(mine.state.grants[0].amount, 49);
});

test('a forged "finished" body is worthless: the API says the payment is still waiting', async () => {
  const w = world({ pay: { payment_status: 'waiting' } });
  const r = await run(w, JSON.stringify({ payment_id: 777, payment_status: 'finished' }));
  assert.equal(w.state.grants.length, 0);
  assert.match(r.note, /pending/);
});

/* ======================= AMOUNT / CURRENCY ======================= */
test('amountOk: covers, short and wrong currency', () => {
  assert.equal(amountOk({ price_amount: 49, price_currency: 'usd' }, { amount: 49, currency: 'usd' }).ok, true);
  assert.equal(amountOk({ price_amount: 49.005, price_currency: 'USD' }, { amount: 49, currency: 'usd' }).ok, true);
  assert.equal(amountOk({ price_amount: 10, price_currency: 'usd' }, { amount: 49, currency: 'usd' }).ok, false);
  assert.equal(amountOk({ price_amount: 49, price_currency: 'eur' }, { amount: 49, currency: 'usd' }).ok, false);
  assert.equal(amountOk({}, { amount: 49, currency: 'usd' }).ok, true, 'nothing to compare');
});

test('a payment that does not cover the invoice is NOT granted and the admins are told', async () => {
  const w = world({ pay: { price_amount: 10 } });
  const r = await run(w);
  assert.equal(r.note, 'amount mismatch');
  assert.equal(w.state.grants.length, 0);
  assert.equal(w.row.credited, false, 'must not even claim it');
  assert.ok(w.state.alerts.some((a) => /does not cover/.test(a)));
});

/* ======================= UNDERPAID / FAILED / REVERSED ======================= */
test('partially paid: no access, the user is told, the admins decide', async () => {
  const w = world({ pay: { payment_status: 'partially_paid', actually_paid: 20 } });
  const r = await run(w);
  assert.equal(r.note, 'partially paid');
  assert.equal(w.state.grants.length, 0);
  assert.equal(w.state.dms.length, 1);
  assert.ok(w.state.alerts.some((a) => /UNDERPAID/.test(a)));
});

test('expired before payment: the user is told to retry and nobody is alerted', async () => {
  const w = world({ pay: { payment_status: 'expired' } });
  await run(w);
  assert.equal(w.state.grants.length, 0);
  assert.equal(w.state.dms.length, 1);
  assert.equal(w.state.alerts.length, 0);
});

test('reversed AFTER access was granted: admins are alerted, the user is not messaged', async () => {
  const w = world({ pay: { payment_status: 'refunded' }, rec: { credited: true } });
  await run(w);
  assert.ok(w.state.alerts.some((a) => /already granted/.test(a)));
  assert.equal(w.state.dms.length, 0);
});

/* ======================= HOSTILE INPUT ======================= */
test('junk bodies are ignored quietly and never alert anyone', async () => {
  const w = world();
  for (const raw of ['', 'not json', '[]', '{}', '{"payment_id":null}', 'a'.repeat(5000)]) {
    await assert.rejects(() => run(w, raw), (e) => e instanceof IpnIgnored, `should ignore: ${raw.slice(0, 20)}`);
  }
  assert.equal(w.state.alerts.length, 0);
  assert.equal(w.state.grants.length, 0);
});

test('an unknown payment id (NOWPayments answers 404) is ignored without alerts', async () => {
  const w = world({ getPayment: async () => { throw new Error('nowpayments GET /payment/777 -> 404 {"message":"not found"}'); } });
  await assert.rejects(() => run(w), (e) => e instanceof IpnIgnored);
  assert.equal(w.state.alerts.length, 0);
});

test('a network failure while verifying is transient so NOWPayments retries', async () => {
  const w = world({ getPayment: async () => { throw new Error('fetch failed'); } });
  await assert.rejects(() => run(w), (e) => e instanceof IpnTemporary);
  assert.equal(w.state.grants.length, 0);
});

test('our API key being rejected alerts the admins (once) and is not swallowed', async () => {
  const w = world({ getPayment: async () => { throw new Error('nowpayments GET /payment/777 -> 401 {}'); } });
  await assert.rejects(() => run(w), /auth failed/);
  assert.ok(w.state.alerts.some((a) => /API key/.test(a)));
});

test('a real payment for an order we do not know alerts once, not on every repeat', async () => {
  const w = world();
  w.deps.db.payByOrder = async () => null;
  await run(w); await run(w); await run(w);
  assert.equal(w.state.alerts.filter((a) => /do not know/.test(a)).length, 1);
});

test('REQUIRE_SIG on: a bad signature is rejected before NOWPayments is even called', async () => {
  let called = false;
  const w = world({ sigOk: false, getPayment: async () => { called = true; return {}; } });
  await assert.rejects(() => run(w, body(), { requireSig: true }), (e) => e instanceof IpnIgnored);
  assert.equal(called, false);
});

test('REQUIRE_SIG off: a bad signature on a GENUINE payment still works, and flags the problem', async () => {
  // If our signature check is ever wrong, real customers must not be locked out.
  const w = world({ sigOk: false });
  const r = await run(w, body(), { requireSig: false });
  assert.equal(r.granted, true);
  assert.ok(w.state.alerts.some((a) => /signature did not verify/.test(a)));
});

/* ======================= RATE LIMITING ======================= */
test('limiter: allows up to max inside the window, then blocks, then recovers', () => {
  const allow = makeLimiter({ max: 3, windowMs: 1000 });
  const t = 1_000_000;
  assert.deepEqual([allow('a', t), allow('a', t + 1), allow('a', t + 2), allow('a', t + 3)], [true, true, true, false]);
  assert.equal(allow('b', t + 3), true, 'keys are independent');
  assert.equal(allow('a', t + 1500), true, 'window slid');
});

test('fail guard: blocks after max failures and a success clears it', () => {
  const g = makeFailGuard({ max: 3, windowMs: 1000 });
  const t = 5_000_000;
  g.fail('ip', t); g.fail('ip', t + 1);
  assert.equal(g.blocked('ip', t + 2), false);
  g.fail('ip', t + 2);
  assert.equal(g.blocked('ip', t + 3), true);
  assert.equal(g.blocked('ip', t + 2000), false, 'expires');
  g.fail('ip', t + 2001); g.fail('ip', t + 2002); g.fail('ip', t + 2003);
  g.reset('ip');
  assert.equal(g.blocked('ip', t + 2004), false);
});

test('throttle: the same alert is allowed once per window', () => {
  const th = makeThrottle(1000);
  assert.equal(th('k', 10), true);
  assert.equal(th('k', 500), false);
  assert.equal(th('other', 500), true);
  assert.equal(th('k', 1200), true);
});

/* ======================= PLANS ======================= */
test('legacy plan names still resolve (two invoices were created before the rename)', () => {
  assert.equal(planByName('1ay')?.name, '1mo');
  assert.equal(planByName('3ay')?.name, '3mo');
  assert.equal(planByName('12ay')?.name, '12mo');
  assert.equal(planByName('1MO')?.name, '1mo');
  assert.equal(planByName('nonsense'), null);
});

test('hidden "_" plans are visible and buyable by admins only', () => {
  const saved = [ENV.plans, ENV.adminIds];
  ENV.plans = [{ name: '1mo', price: 49, days: 30 }, { name: '_test', price: 2, days: 1 }];
  ENV.adminIds = ['42'];
  try {
    assert.equal(isHiddenPlan(ENV.plans[1]), true);
    assert.deepEqual(publicPlans().map((p) => p.name), ['1mo']);
    assert.deepEqual(plansFor(7).map((p) => p.name), ['1mo'], 'a normal user');
    assert.deepEqual(plansFor(42).map((p) => p.name), ['1mo', '_test'], 'an admin');
  } finally { [ENV.plans, ENV.adminIds] = saved; }
});

test('default plans are English-named', () => {
  assert.ok(ENV.plans.every((p) => /^\d+mo$/.test(p.name) || p.name.startsWith('_')), ENV.plans.map((p) => p.name).join());
});

/* ======================= PAID CONTENT CANNOT BE FORWARDED ======================= */
test('VIP posts are sent with protect_content, free posts are not', async () => {
  const { send } = await import('../src/telegram.js');
  const saved = { f: globalThis.fetch, t: ENV.botToken, d: ENV.dryRun, v: ENV.vipChat, free: ENV.freeChat, p: ENV.vipProtect };
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  };
  Object.assign(ENV, { botToken: 'x', dryRun: false, vipChat: '-100111', freeChat: '-100222', vipProtect: true });
  try {
    await send('-100111', 'vip post');
    await send('-100222', 'free post');
    await send(123456, 'a dm');
    assert.equal(sent[0].protect_content, true, 'VIP must be protected');
    assert.equal(sent[1].protect_content, undefined, 'free must not be');
    assert.equal(sent[2].protect_content, undefined, 'DMs must not be');
    ENV.vipProtect = false;
    await send('-100111', 'vip post 2');
    assert.equal(sent[3].protect_content, undefined, 'switch off works');
  } finally {
    globalThis.fetch = saved.f;
    Object.assign(ENV, { botToken: saved.t, dryRun: saved.d, vipChat: saved.v, freeChat: saved.free, vipProtect: saved.p });
  }
});

/* ======================= HTTP LAYER ======================= */
const serve = async (patch, fn) => {
  const port = 38000 + Math.floor(Math.random() * 900);
  const saved = {};
  for (const k of Object.keys({ port, ...patch })) saved[k] = ENV[k];
  Object.assign(ENV, { port, ...patch });
  const srv = startServer();
  await new Promise((r) => setTimeout(r, 150));
  try { await fn(`http://127.0.0.1:${port}`); } finally { srv.close(); Object.assign(ENV, saved); }
};

test('every response carries the security headers', async () => {
  await serve({ dashKey: '' }, async (base) => {
    const r = await fetch(base + '/health');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  });
});

test('POSTing junk to /ipn answers 200 quietly; other methods are refused; huge bodies are cut off', async () => {
  await serve({ dashKey: '' }, async (base) => {
    const junk = await fetch(base + '/ipn/nowpayments', { method: 'POST', body: 'garbage' });
    assert.equal(junk.status, 200);
    assert.equal((await junk.json()).ok, false);
    assert.equal((await fetch(base + '/ipn/nowpayments')).status, 405);
    // an oversized body is cut off (413 or a dropped connection) and must not take the server down
    await fetch(base + '/ipn/nowpayments', { method: 'POST', body: 'x'.repeat(300 * 1024) }).catch(() => null);
    const after = await fetch(base + '/health');
    assert.equal(after.status, 200, 'server still healthy after an oversized body');
  });
});

test('/ipn is rate limited per client', async () => {
  await serve({ dashKey: '' }, async (base) => {
    let limited = 0;
    for (let i = 0; i < 80; i++) {
      const r = await fetch(base + '/ipn/nowpayments', { method: 'POST', body: '{}', headers: { 'x-forwarded-for': '9.9.9.9' } });
      if (r.status === 429) limited++;
    }
    assert.ok(limited >= 15, `expected the limiter to kick in, only ${limited} were limited`);
    const other = await fetch(base + '/ipn/nowpayments', { method: 'POST', body: '{}', headers: { 'x-forwarded-for': '8.8.8.8' } });
    assert.equal(other.status, 200, 'a different client is unaffected');
  });
});

test('dashboard: wrong keys lock the client out, even for the right key, until the window passes', async () => {
  const KEY = 'a-long-random-dashboard-key-0123456789';
  await serve({ dashKey: KEY }, async (base) => {
    const login = (key, ip) => fetch(`${base}/dash/login`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip }, body: 'key=' + key,
    });
    assert.equal((await login(KEY, '7.7.7.7')).status, 302, 'right key works');
    for (let i = 0; i < 10; i++) assert.equal((await login('wrong' + i, '7.7.7.7')).status, 403);
    assert.equal((await login('wrong-again', '7.7.7.7')).status, 429, 'locked out');
    assert.equal((await login(KEY, '7.7.7.7')).status, 429, 'even the right key, while locked');
    assert.equal((await login(KEY, '6.6.6.6')).status, 302, 'other clients fine');
  });
});

test('the dashboard page never embeds its key', async () => {
  const KEY = 'another-long-random-dashboard-key-9876543210';
  await serve({ dashKey: KEY }, async (base) => {
    const ok = await fetch(`${base}/dash/login`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '5.5.5.5' }, body: 'key=' + KEY,
    });
    const r = await fetch(`${base}/dash`, { headers: { 'x-forwarded-for': '5.5.5.5', cookie: ok.headers.get('set-cookie').split(';')[0] } });
    assert.equal(r.status, 200);
    assert.ok(!(await r.text()).includes(KEY));
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  });
});
