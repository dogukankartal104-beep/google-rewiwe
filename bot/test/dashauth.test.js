// Dashboard login: signed cookie sessions, single-use Telegram tokens, no key in URLs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENV } from '../src/config.js';
import { startServer } from '../src/server.js';
import * as A from '../src/dashauth.js';

const KEY = 'a-long-random-master-key-for-tests-123456';

test('session cookie: valid, expired, tampered, wrong key', () => {
  const now = 1_000_000;
  const s = A.makeSession(KEY, now);
  assert.ok(A.checkSession(KEY, s, now + 1000));
  assert.ok(!A.checkSession(KEY, s, now + 13 * 3600e3), 'expires after 12h');
  const [t, exp, sig] = s.split('.');
  assert.ok(!A.checkSession(KEY, `${t}.${Number(exp) + 99999999}.${sig}`, now), 'cannot extend expiry');
  assert.ok(!A.checkSession('another-key', s, now), 'rotating the key logs everyone out');
  assert.ok(!A.checkSession(KEY, '', now));
  assert.ok(!A.checkSession(KEY, 'garbage', now));
});

test('login token: 5 minutes, single use, bound to the key', () => {
  const now = 2_000_000;
  const t = A.makeLoginToken(KEY, now);
  assert.ok(A.checkLoginToken(KEY, t, now + 1000), 'checking does not consume');
  assert.ok(A.checkLoginToken(KEY, t, now + 2000, { consume: true }));
  assert.ok(!A.checkLoginToken(KEY, t, now + 3000), 'second use is refused');
  const t2 = A.makeLoginToken(KEY, now);
  assert.ok(!A.checkLoginToken(KEY, t2, now + 6 * 60e3), 'expired');
  assert.ok(!A.checkLoginToken('another-key', A.makeLoginToken(KEY, now), now));
  assert.ok(!A.checkLoginToken(KEY, A.makeSession(KEY, now), now), 'a session is not a login token');
});

test('cookie is HttpOnly, Secure and SameSite=Strict', () => {
  const c = A.sessionCookie('x');
  assert.match(c, /HttpOnly/); assert.match(c, /Secure/); assert.match(c, /SameSite=Strict/);
});

const withDash = async (fn) => {
  const port = 40100 + Math.floor(Math.random() * 400);
  const saved = { port: ENV.port, dashKey: ENV.dashKey };
  ENV.port = port; ENV.dashKey = KEY;
  const srv = startServer();
  try { await new Promise((r) => setTimeout(r, 200)); await fn(`http://127.0.0.1:${port}`); }
  finally { srv.close(); ENV.port = saved.port; ENV.dashKey = saved.dashKey; }
};
const post = (base, path, body, headers = {}) => fetch(base + path, {
  method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body,
});

test('the key in a query string no longer opens anything', async () => {
  await withDash(async (b) => {
    const r = await fetch(`${b}/dash?key=${KEY}`);
    const body = await r.text();
    assert.ok(!/Dashboard<\/title>[\s\S]*notlar/.test(body) && !body.includes('id="tpay"'));
    assert.ok(body.includes('name="key"'), 'shows the login form');
    assert.equal((await fetch(`${b}/api/dash?key=${KEY}`)).status, 401);
  });
});

test('wrong key is refused; right key sets a hardened cookie that opens the page', async () => {
  await withDash(async (b) => {
    assert.equal((await post(b, '/dash/login', 'key=nope')).status, 403);
    const ok = await post(b, '/dash/login', 'key=' + KEY);
    assert.equal(ok.status, 302);
    const cookie = ok.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
    const page = await fetch(b + '/dash', { headers: { cookie: cookie.split(';')[0] } });
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.ok(!(await page.text()).includes(KEY));
  });
});

test('a forged cookie does not open the API', async () => {
  await withDash(async (b) => {
    const r = await fetch(b + '/api/dash', { headers: { cookie: 'dash=s.99999999999999.AAAA' } });
    assert.equal(r.status, 401);
  });
});

test('telegram token: opening the link only shows a button, the POST signs in once', async () => {
  await withDash(async (b) => {
    const tok = A.makeLoginToken(KEY);
    const view = await fetch(`${b}/dash?t=${tok}`);   // a link-preview bot would do exactly this
    assert.match(await view.text(), /Open dashboard/);
    const again = await fetch(`${b}/dash?t=${tok}`);
    assert.match(await again.text(), /Open dashboard/, 'viewing did not burn the token');
    const ok = await post(b, '/dash/login', 't=' + encodeURIComponent(tok));
    assert.equal(ok.status, 302);
    assert.ok(ok.headers.get('set-cookie'));
    assert.equal((await post(b, '/dash/login', 't=' + encodeURIComponent(tok))).status, 403, 'single use');
  });
});

test('ten wrong tries lock the client out', async () => {
  await withDash(async (b) => {
    for (let i = 0; i < 10; i++) await post(b, '/dash/login', 'key=bad' + i);
    assert.equal((await post(b, '/dash/login', 'key=' + KEY)).status, 429, 'even the right key is refused while locked');
  });
});
