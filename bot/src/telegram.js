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

/* Hedef bir kanal/grup mu, yoksa özel sohbet mi?
   Kanal ve grup id'leri negatiftir veya @kullaniciadi biçimindedir;
   özel sohbetin id'si pozitif bir sayıdır. */
export function isChannel(chatId) {
  const s = String(chatId);
  return s.startsWith('@') || s.startsWith('-');
}

/* Kanal gönderimleri sıraya alınır; art arda atarken Telegram'ı kızdırmayalım.

   DRY_RUN NOTU: DRY_RUN yalnızca KANAL yayınlarını durdurur. Özel sohbetteki
   komut cevapları (/start, /id, /kanallar, /panel ...) her zaman gider —
   yoksa kurulum yapılamaz, çünkü kanal id'lerini bota sorarak öğreniyorsun. */
export async function send(chatId, text, opts = {}) {
  if (!chatId) throw new Error('chat id yok');
  if (ENV.dryRun && isChannel(chatId)) {
    log(`[DRY_RUN] -> ${chatId}\n${text}\n---`);
    return { message_id: 0, dry: true };
  }
  const gap = MIN_GAP - (Date.now() - lastSend);
  if (gap > 0) await sleep(gap);
  lastSend = Date.now();
  // Paid content: stop members forwarding or saving it into free groups.
  const protect = ENV.vipProtect && ENV.vipChat && String(chatId) === String(ENV.vipChat);
  return call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(protect ? { protect_content: true } : {}),
    ...opts,
  });
}

/* Photo + text. The text becomes the caption when it fits (Telegram allows 1024 characters), otherwise it follows as a
   normal message. Any failure falls back to the plain text post, so an image problem can never stop a post. */
export async function sendCard(chatId, png, text, opts = {}) {
  if (!png) return send(chatId, text, opts);
  if (!chatId) throw new Error('chat id yok');
  if (ENV.dryRun && isChannel(chatId)) { log(`[DRY_RUN] -> ${chatId} [image ${png.length} bytes]\n${text}\n---`); return { message_id: 0, dry: true }; }
  const caption = text.length <= 1000;
  try {
    const gap = MIN_GAP - (Date.now() - lastSend);
    if (gap > 0) await sleep(gap);
    lastSend = Date.now();
    const fd = new FormData();
    fd.append('chat_id', String(chatId));
    fd.append('photo', new Blob([png], { type: 'image/png' }), 'card.png');
    if (caption) { fd.append('caption', text); fd.append('parse_mode', 'HTML'); if (opts.reply_markup) fd.append('reply_markup', JSON.stringify(opts.reply_markup)); }
    if (ENV.vipProtect && ENV.vipChat && String(chatId) === String(ENV.vipChat)) fd.append('protect_content', 'true');
    const r = await fetch(`${API()}/sendPhoto`, { method: 'POST', body: fd, signal: AbortSignal.timeout(30000) });
    const j = await r.json().catch(() => null);
    if (!j?.ok) throw new Error(j?.description || `HTTP ${r.status}`);
    if (caption) return j.result;
    return send(chatId, text, opts);                       // long text: photo first, then the text with its buttons
  } catch (e) {
    warn(`sendPhoto failed, posting text only: ${e.message}`);
    return send(chatId, text, opts);
  }
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

/* ---- chat / bot profile management ---- */
export const setTitle = (chatId, title) => call('setChatTitle', { chat_id: chatId, title });
export const setDescription = (chatId, description) =>
  call('setChatDescription', { chat_id: chatId, description });

// generates a NEW primary invite link and revokes the previous primary one
export const exportPrimaryInvite = (chatId) => call('exportChatInviteLink', { chat_id: chatId });

export const getChat = (chatId) => call('getChat', { chat_id: chatId });

export const setBotDescription = (description, languageCode) =>
  call('setMyDescription', { description, ...(languageCode ? { language_code: languageCode } : {}) });
export const setBotShortDescription = (short, languageCode) =>
  call('setMyShortDescription', { short_description: short, ...(languageCode ? { language_code: languageCode } : {}) });
export const setBotCommands = (commands, languageCode) =>
  call('setMyCommands', { commands, ...(languageCode ? { language_code: languageCode } : {}) });

// multipart upload (setChatPhoto needs a real file, JSON cannot carry it)
export async function setPhoto(chatId, buffer, filename = 'photo.png') {
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append('photo', new Blob([buffer], { type: 'image/png' }), filename);
  const r = await fetch(`${API()}/setChatPhoto`, { method: 'POST', body: fd, signal: AbortSignal.timeout(40000) });
  const j = await r.json().catch(() => null);
  if (!j?.ok) throw new Error(`setChatPhoto: ${j?.description || 'HTTP ' + r.status}`);
  return j.result;
}

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
