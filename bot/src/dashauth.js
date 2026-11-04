// Dashboard authentication. The master key (DASHBOARD_KEY) is typed once into a login form, or arrives
// as a short-lived single-use token in the Telegram link. Either way the browser then holds only a signed,
// HttpOnly, SameSite=Strict cookie: the key itself never sits in a URL, history, referrer or access log.
// Everything is signed with a secret derived from the key, so changing DASHBOARD_KEY logs everyone out.
import crypto from 'node:crypto';

const SESSION_MS = 12 * 3600e3;
const LOGIN_MS = 5 * 60e3;

const secretOf = (key) => crypto.createHash('sha256').update('dash-auth:' + key).digest();
const sign = (key, text) => crypto.createHmac('sha256', secretOf(key)).update(text).digest('base64url');
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export function makeSession(key, now = Date.now()) {
  const body = `s.${now + SESSION_MS}`;
  return `${body}.${sign(key, body)}`;
}
export function checkSession(key, token, now = Date.now()) {
  if (!key || !token) return false;
  const p = String(token).split('.');
  if (p.length !== 3 || p[0] !== 's') return false;
  const body = `${p[0]}.${p[1]}`;
  return safeEq(p[2], sign(key, body)) && Number(p[1]) > now;
}

const USED = new Map();                       // login-token nonce -> expiry (single use)
export function makeLoginToken(key, now = Date.now()) {
  const body = `l.${now + LOGIN_MS}.${crypto.randomBytes(9).toString('base64url')}`;
  return `${body}.${sign(key, body)}`;
}
export function checkLoginToken(key, token, now = Date.now(), { consume = false } = {}) {
  if (!key || !token) return false;
  const p = String(token).split('.');
  if (p.length !== 4 || p[0] !== 'l') return false;
  const body = p.slice(0, 3).join('.');
  if (!safeEq(p[3], sign(key, body)) || !(Number(p[1]) > now)) return false;
  for (const [n, exp] of USED) if (exp < now) USED.delete(n);
  if (USED.has(p[2])) return false;
  if (consume) USED.set(p[2], Number(p[1]));
  return true;
}

export const parseCookies = (header) => Object.fromEntries(
  String(header || '').split(';').map((c) => c.trim()).filter(Boolean).map((c) => {
    const i = c.indexOf('=');
    return i < 0 ? [c, ''] : [c.slice(0, i), c.slice(i + 1)];
  }));

export const sessionCookie = (token) =>
  `dash=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`;
export const clearCookie = () => 'dash=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0';

export const loginPage = (msg = '', token = '') => `
<h3 style="margin:0 0 14px">Dashboard</h3>
${msg ? `<p style="color:#ff6b6b;margin:0 0 12px">${msg}</p>` : ''}
<form method="post" action="/dash/login" autocomplete="off" style="display:grid;gap:10px;min-width:260px">
${token
    ? `<input type="hidden" name="t" value="${token.replace(/[^\w.\-]/g, '')}"><button style="padding:12px;border-radius:8px;border:0;background:#2dd4bf;font-weight:700">Open dashboard</button>`
    : `<input type="password" name="key" placeholder="access key" required autofocus style="padding:12px;border-radius:8px;border:1px solid #334;background:#111821;color:#dbe5f0">
<button style="padding:12px;border-radius:8px;border:0;background:#2dd4bf;font-weight:700">Sign in</button>`}
</form>`;
