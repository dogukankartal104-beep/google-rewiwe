// Paywall, renewal and branding tests. No network needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENV, botLink } from '../src/config.js';
import * as M from '../src/messages.js';
import { shouldRemoveJoiner, reminderStageFor } from '../src/vip.js';
import * as B from '../src/brand.js';
import { startServer } from '../src/server.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
// Works for sync and async callbacks: the environment is restored only after an async fn settles.
const withEnv = (patch, fn) => {
  const saved = {};
  for (const k of Object.keys(patch)) { saved[k] = ENV[k]; ENV[k] = patch[k]; }
  const restore = () => { for (const k of Object.keys(saved)) ENV[k] = saved[k]; };
  let out;
  try { out = fn(); } catch (e) { restore(); throw e; }
  if (out && typeof out.then === 'function') return out.finally(restore);
  restore();
  return out;
};

/* ======================= THE PAYWALL HAS NO STATIC LINK ======================= */
test('no source file reads a static VIP invite link', () => {
  // A shared invite link in a public button lets anyone skip the payment.
  // This test fails if one is ever wired back in.
  for (const f of fs.readdirSync(SRC).filter((x) => x.endsWith('.js'))) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    assert.ok(!/ENV\.vipInviteLink/.test(code), `${f} uses ENV.vipInviteLink`);
    assert.ok(!/VIP_INVITE_LINK/.test(code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')),
      `${f} reads VIP_INVITE_LINK`);
  }
  assert.equal('vipInviteLink' in ENV, false, 'ENV must not expose vipInviteLink');
});

test('vipUrl never produces an invite link', () => {
  const cases = [
    { publicUrl: 'https://x.up.railway.app', botUsername: 'my_bot' },
    { publicUrl: '', botUsername: 'my_bot' },
    { publicUrl: '', botUsername: '' },
  ];
  for (const c of cases) {
    withEnv(c, () => {
      for (const src of ['showcase', 'daily', 'pinned', 'edu']) {
        const u = M.vipUrl(src, 'K1');
        assert.ok(!/t\.me\/\+/.test(u), `invite link leaked: ${u}`);
        assert.ok(!/joinchat/.test(u), `invite link leaked: ${u}`);
      }
    });
  }
});

test('vipUrl routes: tracked redirect, then bot deep link, then the free channel', () => {
  withEnv({ publicUrl: 'https://x.up.railway.app', botUsername: 'my_bot' }, () => {
    const u = new URL(M.vipUrl('showcase', 'K1'));
    assert.equal(u.pathname, '/go/vip');
    assert.equal(u.searchParams.get('s'), 'showcase');
  });
  withEnv({ publicUrl: '', botUsername: 'my_bot' }, () => {
    assert.equal(M.vipUrl('daily'), 'https://t.me/my_bot?start=vip_daily');
  });
  withEnv({ publicUrl: '', botUsername: '', freeLink: 'https://t.me/free_chan' }, () => {
    assert.equal(M.vipUrl('daily'), 'https://t.me/free_chan');
  });
});

test('botLink sanitises the start payload', () => {
  withEnv({ botUsername: 'my_bot' }, () => {
    assert.equal(botLink('vip_daily'), 'https://t.me/my_bot?start=vip_daily');
    assert.equal(botLink('vip daily!?&x=1'), 'https://t.me/my_bot?start=vipdailyx1');
    assert.equal(botLink(''), 'https://t.me/my_bot');
    assert.equal(botLink('a'.repeat(200)).split('=')[1].length, 60);
  });
  withEnv({ botUsername: '' }, () => assert.equal(botLink('vip_x'), null));
});

test('/go/vip lands in the bot, never on an invite link', async () => {
  const port = 39000 + Math.floor(Math.random() * 500);
  await withEnv({ port, botUsername: 'my_bot', dashKey: '' }, async () => {
    const srv = startServer();
    try {
      await new Promise((r) => setTimeout(r, 200));
      const r = await fetch(`http://127.0.0.1:${port}/go/vip?s=showcase`, { redirect: 'manual' });
      assert.equal(r.status, 302);
      const loc = r.headers.get('location');
      assert.equal(loc, 'https://t.me/my_bot?start=vip_showcase');
      assert.ok(!/t\.me\/\+/.test(loc));
    } finally { srv.close(); }
  });
});

test('/go/vip with an unknown bot username shows a page instead of leaking a link', async () => {
  const port = 39600 + Math.floor(Math.random() * 300);
  await withEnv({ port, botUsername: '', dashKey: '' }, async () => {
    const srv = startServer();
    try {
      await new Promise((r) => setTimeout(r, 200));
      const r = await fetch(`http://127.0.0.1:${port}/go/vip?s=x`, { redirect: 'manual' });
      assert.equal(r.status, 503);
      assert.ok(!r.headers.get('location'));
    } finally { srv.close(); }
  });
});

/* ======================= REMOVING UNAUTHORISED JOINERS ======================= */
const base = {
  chatId: -1001, vipChatId: -1001, oldStatus: 'left', newStatus: 'member',
  userId: 555, actorId: 555, isBot: false, adminIds: ['999'], activeVip: false,
};

test('a joiner without an active membership is removed', () => {
  assert.equal(shouldRemoveJoiner(base), true);
});

test('an active member is never removed', () => {
  assert.equal(shouldRemoveJoiner({ ...base, activeVip: true }), false);
});

test('admins, bots and admin-added people are left alone', () => {
  assert.equal(shouldRemoveJoiner({ ...base, userId: 999, actorId: 999 }), false, 'admin joining');
  assert.equal(shouldRemoveJoiner({ ...base, isBot: true }), false, 'a bot');
  assert.equal(shouldRemoveJoiner({ ...base, actorId: 999 }), false, 'added by an admin');
  assert.equal(shouldRemoveJoiner({ ...base, actorId: 321 }), true, 'added by a non-admin');
});

test('only a fresh join counts — leaving, promotions and other chats do not', () => {
  assert.equal(shouldRemoveJoiner({ ...base, newStatus: 'left' }), false);
  assert.equal(shouldRemoveJoiner({ ...base, newStatus: 'kicked' }), false);
  assert.equal(shouldRemoveJoiner({ ...base, oldStatus: 'member', newStatus: 'administrator' }), false);
  assert.equal(shouldRemoveJoiner({ ...base, oldStatus: 'kicked' }), true, 'unbanned then joined again');
  assert.equal(shouldRemoveJoiner({ ...base, chatId: -2222 }), false, 'a different chat');
  assert.equal(shouldRemoveJoiner({ ...base, vipChatId: '' }), false, 'VIP chat not configured');
});

test('chat ids compare as strings (Telegram sends numbers, env holds a string)', () => {
  assert.equal(shouldRemoveJoiner({ ...base, chatId: -1001, vipChatId: '-1001' }), true);
});

/* ======================= RENEWAL REMINDERS ======================= */
const DAY = 864e5;

test('reminder stages: 7 days, then 1 day, never repeated', () => {
  assert.equal(reminderStageFor(10 * DAY, 0), null, 'too early');
  assert.equal(reminderStageFor(6 * DAY, 0), 1);
  assert.equal(reminderStageFor(6 * DAY, 1), null, 'stage 1 already sent');
  assert.equal(reminderStageFor(0.5 * DAY, 1), 2);
  assert.equal(reminderStageFor(0.5 * DAY, 2), null, 'stage 2 already sent');
});

test('someone who first appears in the last day only gets the final reminder', () => {
  assert.equal(reminderStageFor(0.5 * DAY, 0), 2);
});

test('an already expired membership gets no reminder', () => {
  assert.equal(reminderStageFor(0, 0), null);
  assert.equal(reminderStageFor(-DAY, 0), null);
});

/* ======================= MESSAGES ======================= */
test('grant message: with a link, and without one (no static fallback)', () => {
  const exp = Date.now() + 30 * DAY;
  const withLink = M.grantMsg('1mo', exp, 'https://t.me/+abc123', 'en');
  assert.match(withLink, /Join the VIP channel/);
  assert.match(withLink, /t\.me\/\+abc123/);
  assert.match(withLink, /\/join/);

  const noLink = M.grantMsg('1mo', exp, null, 'en');
  assert.ok(!/href=/.test(noLink), 'no link must be invented');
  assert.match(noLink, /\/join/);
  assert.ok(!/undefined|null/.test(noLink));
});

test('reminder, expiry and win-back messages are valid in both languages', () => {
  for (const lang of ['en', 'tr']) {
    const msgs = [M.expireSoonMsg(1, lang), M.expireSoonMsg(5, lang), M.expiredMsg(lang), M.winbackMsg(lang),
      M.joinMsg('https://t.me/+z', lang), M.joinNoAccessMsg(lang), M.joinFailedMsg(lang), M.unauthorizedJoinMsg(lang)];
    msgs.forEach((m) => {
      assert.ok(m.length > 20);
      assert.ok(!/undefined|NaN|\[object/.test(m), m);
    });
  }
  assert.match(M.expireSoonMsg(1, 'en'), /1 day\./);
  assert.match(M.expireSoonMsg(5, 'en'), /5 days\./);
  assert.match(M.expireSoonMsg(5, 'en'), /on top/, 'must say renewing early loses nothing');
});

test('vipActiveMsg shows the membership and points to /join', () => {
  const v = { status: 'aktif', plan: '3mo', expires_at: new Date(Date.now() + 40 * DAY).toISOString() };
  const m = M.vipActiveMsg(v, 'en');
  assert.match(m, /VIP membership active/);
  assert.match(m, /\/join/);
});

test('invoice message shows the returning-member discount only when there is one', () => {
  const plan = { name: '1mo', price: 41.65 };
  const none = M.invoiceMsg({ name: '1mo', price: 49 }, 'https://pay', 'en');
  assert.ok(!/<s>/.test(none));
  assert.match(none, /\$49/);
  const disc = M.invoiceMsg(plan, 'https://pay', 'en', { discountPct: 15, listPrice: 49 });
  assert.match(disc, /<s>\$49<\/s>/);
  assert.match(disc, /\$41\.65/);
  assert.match(disc, /15%/);
});

/* ======================= BRANDING ======================= */
test('branding text fits Telegram limits (checked with the longest possible username)', () => {
  withEnv({ botUsername: 'a'.repeat(32) }, () => {
    assert.ok(B.freeTitle().length <= B.LIMITS.title);
    assert.ok(B.vipTitle().length <= B.LIMITS.title);
    assert.ok(B.freeDescription().length <= B.LIMITS.chatDesc, `free desc ${B.freeDescription().length}`);
    assert.ok(B.vipDescription().length <= B.LIMITS.chatDesc, `vip desc ${B.vipDescription().length}`);
    for (const lang of ['en', 'tr']) {
      assert.ok(B.botDescription(lang).length <= B.LIMITS.botDesc, `bot desc ${lang}`);
      assert.ok(B.botShortDescription(lang).length <= B.LIMITS.botShort, `bot short ${lang}`);
      B.commandList(lang).forEach((c) => {
        assert.match(c.command, /^[a-z0-9_]{1,32}$/, c.command);
        assert.ok(c.description.length >= 3 && c.description.length <= B.LIMITS.cmdDesc);
      });
    }
    assert.ok(B.freePinned().text.length <= 4096);
    assert.ok(B.vipPinned().text.length <= 4096);
  });
});

test('channel branding is English and carries the risk disclaimer', () => {
  withEnv({ botUsername: 'my_bot' }, () => {
    const all = [B.freeDescription(), B.vipDescription(), B.freePinned().text, B.vipPinned().text].join('\n');
    assert.ok(!/[çğışöüÇĞİŞÖÜ]/.test(all), 'channel content must be English');
    assert.match(B.freePinned().text, /Not financial advice/);
    assert.match(B.vipPinned().text, /Not financial advice/);
    assert.match(B.freeDescription(), /Not financial advice/);
  });
});

test('the pinned free post sells VIP through the bot, not an invite link', () => {
  withEnv({ botUsername: 'my_bot', publicUrl: '' }, () => {
    const kb = B.freePinned().reply_markup.inline_keyboard[0][0];
    assert.match(kb.text, /VIP/);
    assert.equal(kb.url, 'https://t.me/my_bot?start=vip_pinned');
  });
});

test('branding makes no performance promises', () => {
  withEnv({ botUsername: 'my_bot' }, () => {
    const all = [B.freeDescription(), B.vipDescription(), B.freePinned().text, B.vipPinned().text,
      B.botDescription('en'), B.botShortDescription('en')].join('\n').toLowerCase();
    for (const bad of ['guaranteed', 'guarantee', '100%', 'risk-free', 'risk free', 'never lose', 'get rich', 'passive income']) {
      assert.ok(!all.includes(bad), `forbidden claim: ${bad}`);
    }
    assert.match(all, /losses/, 'should mention that losses are published');
  });
});

test('both logos exist and are real PNG files', () => {
  for (const f of ['free.png', 'vip.png']) {
    const buf = fs.readFileSync(path.join(SRC, '../assets', f));
    assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${f} is not a PNG`);
    assert.ok(buf.length > 5000 && buf.length < 10 * 1024 * 1024, `${f} size ${buf.length}`);
  }
});

test('branding does nothing in DRY_RUN', async () => {
  const r = await withEnv({ dryRun: true, botToken: 'x' }, () => B.applyBranding());
  assert.equal(r.skipped, 'DRY_RUN is on');
  assert.equal(r.steps.length, 0);
});

test('/start, /vip and /join are listed in the command menu and the help text', () => {
  const names = B.commandList('en').map((c) => c.command);
  for (const c of ['start', 'vip', 'join', 'status', 'how', 'language', 'id']) {
    assert.ok(names.includes(c), `menu is missing /${c}`);
  }
  assert.match(M.startMsg('A', 'en'), /\/join/);
  assert.match(M.startMsg('A', 'tr'), /\/join/);
});
