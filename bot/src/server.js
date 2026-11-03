// HTTP server: NOWPayments IPN callback, tracked VIP redirect, dashboard, health check.
// No dependencies, plain node:http.
//
// This server is reachable by anyone on the internet, so every route assumes hostile input:
// bodies are size-capped, the public routes are rate-limited, the dashboard key is
// compared in constant time and brute-force-locked, and garbage requests never reach the admins.
import http from 'node:http';
import { ENV, botLink } from './config.js';
import * as db from './db.js';
import * as np from './payments.js';
import * as dash from './dashboard.js';
import { processIpn, IpnIgnored, IpnTemporary, alertAdmins } from './ipn.js';
import { makeLimiter, makeFailGuard, clientIp } from './ratelimit.js';
import { log, warn, err } from './util.js';

const MAX_BODY = 256 * 1024;

// Sent with every response. The dashboard URL carries its key, so the page must never leak it
// through the Referer header, and nothing here should be framed or sniffed.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

const readBody = (req) => new Promise((resolve, reject) => {
  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

const json = (res, code, obj) => {
  res.writeHead(code, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};
const html = (res, code, body) => {
  res.writeHead(code, { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Crypto Pump Radar</title><body style="font-family:system-ui;background:#0b0f14;color:#dbe5f0;display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:20px">
<div>${body}</div></body>`);
};

export function startServer() {
  const ipnPerIp = makeLimiter({ max: 60, windowMs: 60e3 });
  const ipnGlobal = makeLimiter({ max: 300, windowMs: 60e3 });
  const goPerIp = makeLimiter({ max: 120, windowMs: 60e3 });
  const dashGuard = makeFailGuard({ max: 10, windowMs: 5 * 60e3 });

  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const ip = clientIp(req);

    try {
      if (path === '/health' || path === '/') {
        return json(res, 200, { ok: true, bot: 'fade', ts: new Date().toISOString() });
      }

      /* ---- NOWPayments IPN ----
         The body is only used to learn a payment_id; see ipn.js for the model. */
      if (path === '/ipn/nowpayments') {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST required' });
        if (!ipnPerIp(ip) || !ipnGlobal('all')) return json(res, 429, { error: 'too many requests' });

        let raw;
        try { raw = await readBody(req); }
        catch { return json(res, 413, { error: 'body too large' }); }

        try {
          return json(res, 200, await processIpn(raw, req.headers[np.SIG_HEADER]));
        } catch (e) {
          // junk, probes, unknown payment ids: answer quietly, never alert anyone
          if (e instanceof IpnIgnored) return json(res, 200, { ok: false, note: e.message });
          // transient: a 5xx makes NOWPayments retry later
          if (e instanceof IpnTemporary) { warn('IPN (will be retried):', e.message); return json(res, 500, { ok: false }); }
          err('IPN error:', e.message);
          await alertAdmins('ipn-error', `❌ IPN processing error: ${e.message}`);
          return json(res, 500, { ok: false });
        }
      }

      /* ---- tracked VIP link ----
         Buttons in the free channel point here. The click is recorded and the visitor lands
         in the BOT — never on an invite link: the checkout is the only way into VIP.
         (Telegram does not expose post views, so button clicks are the metric.) */
      if (path === '/go/vip') {
        if (!goPerIp(ip)) return json(res, 429, { error: 'too many requests' });
        const source = String(url.searchParams.get('s') || 'unknown').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'unknown';
        const sigKey = (url.searchParams.get('k') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || null;
        db.clickAdd({
          kind: 'vip', source, signal_key: sigKey,
          ua: String(req.headers['user-agent'] || '').slice(0, 200),
        });
        const target = botLink('vip_' + source);
        if (!target) {
          return html(res, 503, '<h3>One moment…</h3><p>Open Telegram and send <b>/vip</b> to the bot.</p>');
        }
        res.writeHead(302, { ...SECURITY_HEADERS, Location: target, 'Cache-Control': 'no-store' });
        return res.end();
      }

      // ---- dashboard (owner only) ----
      if (path === '/dash' || path === '/api/dash') {
        if (!ENV.dashKey) return html(res, 404, '<h3>Dashboard is off</h3>');
        if (dashGuard.blocked(ip)) return json(res, 429, { error: 'too many attempts, try again later' });
        if (!dash.keyOk(url.searchParams.get('key'))) {
          dashGuard.fail(ip);
          return path === '/api/dash' ? json(res, 403, { error: 'forbidden' }) : html(res, 403, '<h3>No access</h3>');
        }
        dashGuard.reset(ip);

        if (path === '/dash') {
          res.writeHead(200, {
            ...SECURITY_HEADERS,
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Robots-Tag': 'noindex, nofollow',
          });
          return res.end(dash.dashHtml());
        }
        const data = await dash.aggregate();
        res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(data));
      }

      // pages NOWPayments sends the customer back to
      if (path === '/odeme-tamam') {
        return html(res, 200,
          '<h2>✅ Payment received</h2><p>Your VIP invite link arrives in Telegram within a few minutes.</p><p>You can close this page.</p>');
      }
      if (path === '/odeme-iptal') {
        return html(res, 200,
          '<h2>Payment cancelled</h2><p>To try again, send <b>/vip</b> to the bot in Telegram.</p>');
      }

      return json(res, 404, { error: 'not found' });
    } catch (e) {
      err('http:', e.message);
      return json(res, 500, { error: 'server error' });
    }
  });

  srv.listen(ENV.port, () => log(`HTTP server on port ${ENV.port}`));
  return srv;
}
