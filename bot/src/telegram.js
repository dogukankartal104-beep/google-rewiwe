// Telegram Bot API — bağımlılıksız, fetch ile. Rate limit'e saygılı.
import { ENV } from './config.js';
import { sleep, log, warn } from './util.js';

const API = () => `https://api.telegram.org/bot${ENV.botToken}`;

let lastSend = 0;
const MIN_GAP = 1200; // kanala saniyede 1'den fazla mesaj atma (Telegram limiti)

export async function call(method, payload = {}, { retries = 3 } = {}) {
  if (!ENV.botToken) throw new Error('TELEGRAM_BOT_TOKEN yok');
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(`${API()}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(method === 'getUpdates' ? 70000 : 25000),
      });
      const j = await r.json().catch(() => null);
      if (j?.ok) return j.result;
      const desc = j?.description || `HTTP ${r.status}`;
      // 429: Telegram kaç saniye beklememizi söylüyor
      if (r.status === 429) {
        const wait = (j?.parameters?.retry_after || 3) * 1000;
        warn(`telegram 429, ${wait / 1000}s bekleniyor (${method})`);
        await sleep(wait + 250);
        continue;
      }
      // kalıcı hatalar: tekrar denemenin anlamı yok
      if (/chat not found|bot was blocked|user is deactivated|not enough rights|message is not modified|message to edit not found/i.test(desc)) {
        throw new Error(`${method}: ${desc}`);
      }
      if (i === retries - 1) throw new Error(`${method}: ${desc}`);
      await sleep(900 * 2 ** i);
    } catch (e) {
      if (e.name === 'AbortError' && method === 'getUpdates') throw e;
      if (i === retries - 1) throw e;
      await sleep(900 * 2 ** i);
    }
  }
}

// Kanal gönderimleri sıraya alınır; art arda atarken Telegram'ı kızdırmayalım.
export async function send(chatId, text, opts = {}) {
  if (!chatId) throw new Error('chat id yok');
  if (ENV.dryRun) {
    log(`[DRY_RUN] -> ${chatId}\n${text}\n---`);
    return { message_id: 0, dry: true };
  }
  const gap = MIN_GAP - (Date.now() - lastSend);
  if (gap > 0) await sleep(gap);
  lastSend = Date.now();
  return call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...opts,
  });
}

export const edit = (chatId, messageId, text, opts = {}) =>
  call('editMessageText', {
    chat_id: chatId, message_id: messageId, text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...opts,
  });

export const pin = (chatId, messageId) =>
  call('pinChatMessage', { chat_id: chatId, message_id: messageId, disable_notification: true })
    .catch((e) => warn('pin:', e.message));

export const getMe = () => call('getMe');

// Tek kullanımlık, süreli VIP davet linki
export const createInvite = (chatId, { name = '', expireSec = 3 * 86400, limit = 1 } = {}) =>
  call('createChatInviteLink', {
    chat_id: chatId,
    name: name.slice(0, 32),
    expire_date: Math.floor((Date.now() + expireSec * 1000) / 1000),
    member_limit: limit,
  });

export const revokeInvite = (chatId, link) =>
  call('revokeChatInviteLink', { chat_id: chatId, invite_link: link }).catch(() => null);

// Kanaldan çıkar ve tekrar girebilsin diye yasağı hemen kaldır
export async function kick(chatId, userId) {
  await call('banChatMember', { chat_id: chatId, user_id: userId, revoke_messages: false });
  await sleep(400);
  await call('unbanChatMember', { chat_id: chatId, user_id: userId, only_if_banned: true })
    .catch(() => null);
}

export const member = (chatId, userId) =>
  call('getChatMember', { chat_id: chatId, user_id: userId }).catch(() => null);

export const memberCount = (chatId) =>
  call('getChatMemberCount', { chat_id: chatId }).catch(() => null);

// ---- long polling ----
export async function getUpdates(offset, timeout = 50) {
  try {
    return await call('getUpdates', {
      offset, timeout,
      allowed_updates: ['message', 'callback_query', 'chat_member', 'my_chat_member'],
    }, { retries: 1 });
  } catch (e) {
    if (e.name === 'AbortError') return [];
    warn('getUpdates:', e.message);
    await sleep(3000);
    return [];
  }
}

export const answerCb = (id, text = '') =>
  call('answerCallbackQuery', { callback_query_id: id, text }).catch(() => null);

export const isAdmin = (id) => ENV.adminIds.includes(String(id));

// HTML kaçışı — kullanıcı adı gibi dışarıdan gelen metinler için
export const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
