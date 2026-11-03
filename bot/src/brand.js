// Channel and bot branding: titles, descriptions, logos, pinned welcome posts,
// the bot's own profile text and command menu.
//
// Applied once per BRAND_VERSION (state stored in the database) so a redeploy
// does not keep rewriting channels. Bump BRAND_VERSION after editing any text
// below to roll it out; /brand forces a re-apply.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV, CFG, botLink } from './config.js';
import * as tg from './telegram.js';
import * as db from './db.js';
import * as M from './messages.js';
import { log, warn } from './util.js';

export const BRAND_VERSION = 1;

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets');
const RISK = 'Not financial advice. Leveraged trading can lose your entire capital.';

const bot = () => (ENV.botUsername ? `t.me/${ENV.botUsername}` : 't.me/');

/* ---------------- limits enforced by Telegram ----------------
   chat title ≤128 · chat description ≤255 · bot description ≤512 ·
   bot short description ≤120 · command description ≤256 */
export const LIMITS = { title: 128, chatDesc: 255, botDesc: 512, botShort: 120, cmdDesc: 256 };

export const freeTitle = () => ENV.brandFreeTitle;
export const vipTitle = () => ENV.brandVipTitle;

export const freeDescription = () =>
  'Daily market briefs, live-position updates, crypto news & trading education. ' +
  `Every signal with entry, stop, targets and size goes to VIP → ${bot()}. ` +
  'Losses published too. Not financial advice.';

export const vipDescription = () =>
  'VIP desk: every signal the second it fires — entry, stop, TP1/TP2 and position size. ' +
  'Daily watchlist, open-position tracking, weekly & monthly results, losses included. ' +
  `Renew / new link: ${bot()}. Not financial advice.`;

export const botDescription = (lang = 'en') => (lang === 'tr'
  ? 'Crypto Pump Radar ödeme ve üyelik botu.\n\n' +
    '• /vip — planlar ve ödeme (kripto)\n• /join — üyeler için taze VIP daveti\n' +
    '• /status — üyeliğin ne zaman bitiyor\n• /performance — net sonuçlar, kayıplar dahil\n' +
    '• /how — sistem işlemleri nasıl seçiyor\n\nYatırım tavsiyesi değildir.'
  : 'The checkout and control bot for Crypto Pump Radar.\n\n' +
    '• /vip — plans and payment (crypto)\n• /join — fresh VIP invite for members\n' +
    '• /status — when your membership ends\n• /performance — net results, losses included\n' +
    '• /how — how the system picks trades\n\nNot financial advice.');

export const botShortDescription = (lang = 'en') => (lang === 'tr'
  ? 'Crypto Pump Radar VIP ödeme ve üyelik botu — kripto ile öde, özel davetini al.'
  : 'VIP checkout & membership for Crypto Pump Radar — pay with crypto, get your private invite.');

export const commandList = (lang = 'en') => {
  const en = [
    ['start', 'What this bot does'],
    ['vip', 'VIP plans and payment (crypto)'],
    ['join', 'Get a fresh VIP invite link (members)'],
    ['status', 'When does my membership end'],
    ['performance', 'Net results of the last 30 days'],
    ['how', 'How the system picks trades'],
    ['language', 'Change language (EN / TR)'],
    ['id', 'Show my Telegram ID'],
  ];
  const tr = [
    ['start', 'Bu bot ne yapar'],
    ['vip', 'VIP planları ve ödeme (kripto)'],
    ['join', 'Taze VIP davet linki (üyeler)'],
    ['status', 'Üyeliğim ne zaman bitiyor'],
    ['performance', 'Son 30 günün net sonuçları'],
    ['how', 'Sistem işlemleri nasıl seçiyor'],
    ['language', 'Dil değiştir (EN / TR)'],
    ['id', 'Telegram numaram'],
  ];
  return (lang === 'tr' ? tr : en).map(([command, description]) => ({ command, description }));
};

/* ---------------- pinned posts ---------------- */
export function freePinned() {
  const text = [
    '📡 <b>Welcome to Crypto Pump Radar</b>',
    '',
    'We hunt the point where a pump or dump <b>runs out of fuel</b> — and we measure it instead of guessing.',
    'Open interest, taker flow, CVD, liquidity sweeps and order-book depth across 400+ pairs, 24/7.',
    '',
    '<b>What you get here, free</b>',
    '• A daily market brief and a closing recap',
    '• One live position a day — a trade that is currently in profit',
    '• Breaking crypto news, with context',
    '• A trading lesson every day',
    '• Weekly and monthly results — <b>losses included</b>',
    '',
    '<b>What VIP adds</b>',
    '• Every signal the second it fires: entry, stop, TP1/TP2, R:R',
    '• Position size for your account',
    '• A daily watchlist with levels, open-position tracking, partial-exit alerts',
    '',
    'Most days the system finds zero or one setup. That is the point — it does not force trades.',
    '',
    `<i>${RISK}</i>`,
  ].join('\n');
  return { text, reply_markup: { inline_keyboard: [[{ text: '⭐ Get VIP', url: M.vipUrl('pinned') }]] } };
}

export function vipPinned() {
  const text = [
    '⭐ <b>Welcome to VIP</b>',
    '',
    '<b>How to read a signal</b>',
    '• <b>Entry</b> — where the plan assumes you get in',
    '• <b>Stop</b> — where the idea is proven wrong. Get out there. Never move it further away.',
    '• <b>TP1 / TP2</b> — first and second target. At TP1 the plan takes half off and moves the stop to entry.',
    '• <b>R:R</b> — the reward compared with the risk',
    '• <b>Size</b> — dollars at risk divided by the stop distance. Scale it to your own account.',
    '',
    '<b>House rules the system follows</b>',
    `• ${CFG.riskPct}% risk per trade, at most ${CFG.maxOpen} open positions`,
    `• After a ${CFG.dailyStopR}R day it stops publishing new signals`,
    '• Every result is net of fees and slippage, and losses are published',
    '',
    '<b>Your membership</b>',
    `Everything runs through ${bot()}:`,
    '/status — when it ends · /join — a fresh invite link · /vip — renew',
    'Renewing early adds the new time on top of what you have left.',
    '',
    `<i>${RISK}</i>`,
  ].join('\n');
  const manage = botLink('vip_member');
  return {
    text,
    reply_markup: manage ? { inline_keyboard: [[{ text: 'Manage membership', url: manage }]] } : undefined,
  };
}

/* ---------------- applying it ---------------- */
const readAsset = (name) => {
  const f = path.join(ASSETS, name);
  return fs.existsSync(f) ? fs.readFileSync(f) : null;
};

// Telegram answers "not modified" when a value is already what we are setting — that is success
const harmless = (e) => /not modified|CHAT_NOT_MODIFIED|chat description is not modified/i.test(e?.message || '');

export async function applyBranding({ force = false } = {}) {
  const steps = [];
  const step = async (name, fn) => {
    try { const detail = await fn(); steps.push({ name, ok: true, detail: detail || '' }); }
    catch (e) {
      if (harmless(e)) steps.push({ name, ok: true, detail: 'already set' });
      else steps.push({ name, ok: false, detail: e.message });
    }
  };

  if (ENV.dryRun) return { skipped: 'DRY_RUN is on', steps };
  if (!ENV.botToken) return { skipped: 'no bot token', steps };

  const state = (await db.getState('brand', {})) || {};
  if (!force && state.version === BRAND_VERSION) return { skipped: 'already applied', steps };
  const next = { ...state, version: BRAND_VERSION, pins: { ...(state.pins || {}) }, photo: { ...(state.photo || {}) } };

  const chats = [
    ['free', ENV.freeChat, freeTitle(), freeDescription(), freePinned, 'free.png'],
    ['vip', ENV.vipChat, vipTitle(), vipDescription(), vipPinned, 'vip.png'],
  ];

  for (const [key, chatId, title, desc, pinned, logo] of chats) {
    if (!chatId) { steps.push({ name: `${key}: skipped`, ok: false, detail: 'channel id not set' }); continue; }

    await step(`${key}: title`, () => tg.setTitle(chatId, title));
    await step(`${key}: description`, () => tg.setDescription(chatId, desc));

    if (force || !state.photo?.[key]) {
      const buf = readAsset(logo);
      if (!buf) steps.push({ name: `${key}: logo`, ok: false, detail: `assets/${logo} missing` });
      else await step(`${key}: logo`, async () => { await tg.setPhoto(chatId, buf, logo); next.photo[key] = true; });
    }

    // pinned welcome: edit our earlier post if we have one, otherwise post and pin it
    await step(`${key}: pinned post`, async () => {
      const { text, reply_markup } = pinned();
      const prev = state.pins?.[key];
      if (prev) {
        try {
          await tg.edit(chatId, prev, text, reply_markup ? { reply_markup } : {});
          return 'updated';
        } catch (e) {
          if (harmless(e)) return 'already current';
          // the old post was deleted — fall through and post a new one
        }
      }
      const msg = await tg.send(chatId, text, reply_markup ? { reply_markup } : {});
      if (msg?.message_id) { await tg.pin(chatId, msg.message_id); next.pins[key] = msg.message_id; }
      return 'posted and pinned';
    });
  }

  // Paywall: generating a new primary invite link revokes the old one, so no
  // old public/static link can still let people into VIP without paying.
  if (ENV.vipChat && (force || !state.lockedAt)) {
    await step('vip: revoke old primary invite link', async () => {
      await tg.exportPrimaryInvite(ENV.vipChat);
      next.lockedAt = new Date().toISOString();
      return 'old link revoked';
    });
  }

  // the bot's own profile (English by default, Turkish for Turkish clients)
  await step('bot: description', async () => {
    await tg.setBotDescription(botDescription('en'));
    await tg.setBotDescription(botDescription('tr'), 'tr');
  });
  await step('bot: short description', async () => {
    await tg.setBotShortDescription(botShortDescription('en'));
    await tg.setBotShortDescription(botShortDescription('tr'), 'tr');
  });
  await step('bot: command menu', async () => {
    await tg.setBotCommands(commandList('en'));
    await tg.setBotCommands(commandList('tr'), 'tr');
  });

  next.appliedAt = new Date().toISOString();
  // only mark the version done when nothing failed, so a missing permission is retried after it is fixed
  const failed = steps.filter((s) => !s.ok);
  if (!failed.length) await db.setState('brand', next);
  else await db.setState('brand', { ...next, version: state.version || 0 });

  for (const s of steps) log(`branding · ${s.ok ? 'ok ' : 'FAIL'} · ${s.name}${s.detail ? ' · ' + s.detail : ''}`);
  return { steps, failed: failed.length };
}

export function reportText(result) {
  if (result.skipped) return `Branding skipped: ${result.skipped}`;
  const lines = result.steps.map((s) => `${s.ok ? '✅' : '❌'} ${s.name}${s.detail ? ' — ' + s.detail : ''}`);
  const tail = result.failed
    ? '\n\n⚠️ Some steps failed. Usually the bot is missing the <b>Change channel info</b> or <b>Pin messages</b> permission — grant it and send /brand.'
    : '\n\n🎉 All done.';
  return '<b>Channel branding</b>\n\n' + lines.join('\n') + tail;
}
