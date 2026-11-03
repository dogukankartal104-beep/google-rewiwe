// VIP membership lifecycle: grant access, remind, remove on expiry, win back.
//
// PAYWALL RULE: the only way into the VIP channel is a single-use invite link
// that this bot creates for a specific paying member. There is no static link
// anywhere, and anyone who joins without an active membership is removed.
import { ENV } from './config.js';
import * as db from './db.js';
import * as tg from './telegram.js';
import * as M from './messages.js';
import { log, warn, trDateTime } from './util.js';

export const planByName = (name) =>
  ENV.plans.find((p) => p.name.toLowerCase() === String(name).toLowerCase()) || null;

/* Create a fresh single-use invite for one member. The previous link we issued
   to that member (if any) is revoked so only one link is ever live per person. */
export async function issueInvite(tgId, { previous = null } = {}) {
  if (!ENV.vipChat) throw new Error('VIP_CHANNEL_ID is not set');
  const inv = await tg.createInvite(ENV.vipChat, {
    name: `vip-${tgId}`,
    expireSec: 3 * 86400,
    limit: 1,
  });
  if (!inv?.invite_link) throw new Error('Telegram returned no invite link');
  if (previous && previous !== inv.invite_link) {
    tg.revokeInvite(ENV.vipChat, previous).catch(() => {});
  }
  return inv.invite_link;
}

/* After a confirmed payment: grant access.
   If the member is still active, the new period is added on top of what is left. */
export async function grant(tgId, plan, { amount = 0, orderId = null } = {}) {
  const p = typeof plan === 'string' ? planByName(plan) : plan;
  if (!p) throw new Error('plan not found: ' + plan);

  const existing = await db.vipGet(tgId).catch(() => null);
  const now = Date.now();
  const base = existing && existing.status === 'aktif' && Date.parse(existing.expires_at) > now
    ? Date.parse(existing.expires_at)
    : now;
  const expires = base + p.days * 864e5;

  // NO fallback to a shared link — if this fails the member can run /join,
  // and the admins are told. Handing out a static link would open the paywall.
  let link = null;
  try {
    link = await issueInvite(tgId, { previous: existing?.invite_link });
  } catch (e) {
    warn(`invite link could not be created (${tgId}): ${e.message}`);
    await notifyAdmins(`⚠️ Payment confirmed but the invite link failed for <code>${tgId}</code>: ${tg.esc(e.message)}\nThe member can send /join to retry.`);
  }

  await db.vipUpsert({
    telegram_id: tgId,
    status: 'aktif',
    plan: p.name,
    started_at: existing?.started_at || new Date().toISOString(),
    expires_at: new Date(expires).toISOString(),
    total_paid: (existing?.total_paid || 0) + (amount || 0),
    last_payment_at: new Date().toISOString(),
    invite_link: link,
    reminded_at: null,
    remind_stage: 0,
    winback_at: null,
    kicked_at: null,
  });

  try {
    const lang = await db.getUserLang(tgId);
    await tg.send(tgId, M.grantMsg(p.name, expires, link, lang));
  } catch (e) {
    warn(`grant DM could not be sent (${tgId}): ${e.message}`);
  }

  log(`VIP granted: ${tgId} · ${p.name} · until ${trDateTime(expires)}${orderId ? ' · ' + orderId : ''}`);
  await notifyAdmins(`💰 New VIP: <code>${tgId}</code> · ${p.name} · $${amount} · until ${trDateTime(expires)}`);
  return { expires, link, plan: p };
}

/* Which reminder (if any) is due?
   stage 1 = within 7 days, stage 2 = within 1 day. A reminder is never repeated,
   and a member who first shows up inside the last day only gets stage 2. */
export function reminderStageFor(msLeft, currentStage = 0) {
  if (msLeft <= 0) return null;
  if (msLeft <= 864e5) return currentStage < 2 ? 2 : null;
  if (msLeft <= 7 * 864e5) return currentStage < 1 ? 1 : null;
  return null;
}

/* Should someone who just joined the VIP channel be removed?
   Pure function so the rule can be tested without Telegram. Removal only
   happens for a genuine new join by a non-bot, non-admin who has no active
   membership and was not added by an admin. */
export function shouldRemoveJoiner({
  chatId, vipChatId, oldStatus, newStatus, userId, actorId = null,
  isBot = false, adminIds = [], activeVip = false,
}) {
  if (!vipChatId || String(chatId) !== String(vipChatId)) return false;
  if (isBot) return false;
  const wasInside = ['member', 'administrator', 'creator', 'restricted'].includes(oldStatus || 'left');
  if (newStatus !== 'member' || wasInside) return false;     // not a fresh join
  if (adminIds.includes(String(userId))) return false;       // an admin joining
  if (actorId && String(actorId) !== String(userId) && adminIds.includes(String(actorId))) return false; // added by an admin
  return !activeVip;
}

/* Hourly: remove expired members, send renewal reminders, one win-back nudge. */
export async function sweep() {
  const out = { kicked: 0, reminded: 0, winback: 0 };
  if (!ENV.vipChat) return out;
  const renewKb = () => ({ reply_markup: M.planKeyboard(ENV.plans) });

  // 1) expired memberships
  let expired = [];
  try { expired = (await db.vipExpiring(new Date().toISOString())) || []; }
  catch (e) { warn('vip sweep read:', e.message); return out; }

  for (const v of expired) {
    try {
      await tg.kick(ENV.vipChat, v.telegram_id);
      await db.vipPatch(v.telegram_id, { status: 'süresi_doldu', kicked_at: new Date().toISOString() });
      const lang = await db.getUserLang(v.telegram_id);
      await tg.send(v.telegram_id, M.expiredMsg(lang), renewKb()).catch(() => {});
      out.kicked++;
      log(`VIP expired, removed: ${v.telegram_id}`);
    } catch (e) {
      warn(`removal failed (${v.telegram_id}): ${e.message}`);
      // not in the channel anymore — close the record so we do not retry forever
      if (/not found|not a member|PARTICIPANT_ID_INVALID/i.test(e.message)) {
        await db.vipPatch(v.telegram_id, { status: 'süresi_doldu', kicked_at: new Date().toISOString() }).catch(() => {});
      }
    }
  }

  // 2) renewal reminders (7 days, 1 day)
  try {
    const soon = (await db.vipExpiring(new Date(Date.now() + 7 * 864e5).toISOString())) || [];
    for (const v of soon) {
      const msLeft = Date.parse(v.expires_at) - Date.now();
      const stage = reminderStageFor(msLeft, v.remind_stage || 0);
      if (!stage) continue;
      const days = Math.max(1, Math.ceil(msLeft / 864e5));
      try {
        const lang = await db.getUserLang(v.telegram_id);
        await tg.send(v.telegram_id, M.expireSoonMsg(days, lang), renewKb());
        out.reminded++;
      } catch (e) {
        warn(`reminder could not be sent (${v.telegram_id}): ${e.message}`); // DMs may be closed
      }
      // record the stage either way so a closed DM is not retried every hour
      await db.vipPatch(v.telegram_id, { remind_stage: stage, reminded_at: new Date().toISOString() }).catch(() => {});
    }
  } catch (e) { warn('reminder scan:', e.message); }

  // 3) one win-back message, 3 days after the membership lapsed
  try {
    const due = (await db.vipWinbackDue(new Date(Date.now() - 3 * 864e5).toISOString())) || [];
    for (const v of due) {
      try {
        const lang = await db.getUserLang(v.telegram_id);
        await tg.send(v.telegram_id, M.winbackMsg(lang), renewKb());
        out.winback++;
      } catch (e) {
        warn(`win-back could not be sent (${v.telegram_id}): ${e.message}`);
      }
      await db.vipPatch(v.telegram_id, { winback_at: new Date().toISOString() }).catch(() => {});
    }
  } catch (e) { warn('win-back scan:', e.message); }

  return out;
}

export async function notifyAdmins(text) {
  for (const id of ENV.adminIds) {
    try { await tg.send(id, text); } catch { /* ignore */ }
  }
}

export async function isActive(tgId) {
  const v = await db.vipGet(tgId).catch(() => null);
  return Boolean(v && v.status === 'aktif' && Date.parse(v.expires_at) > Date.now());
}

export async function activeCount() {
  try { return ((await db.vipActive()) || []).length; }
  catch { return null; }
}
