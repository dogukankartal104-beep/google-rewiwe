// Supabase (PostgREST) üzerinden veri katmanı. Ek bağımlılık yok, fetch ile.
import { ENV } from './config.js';
import { warn } from './util.js';

const base = () => ENV.sbUrl.replace(/\/+$/, '') + '/rest/v1';
const H = (extra = {}) => ({
  apikey: ENV.sbKey,
  Authorization: 'Bearer ' + ENV.sbKey,
  'Content-Type': 'application/json',
  ...extra,
});

export const dbReady = () => Boolean(ENV.sbUrl && ENV.sbKey);

async function req(method, path, body, headers = {}) {
  if (!dbReady()) throw new Error('Supabase ayarlı değil (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
  const r = await fetch(base() + path, {
    method,
    headers: H(headers),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`db ${method} ${path} -> ${r.status} ${txt.slice(0, 300)}`);
  if (!txt) return null;
  try { return JSON.parse(txt); } catch { return txt; }
}

export const select = (table, query = '') => req('GET', `/${table}${query ? '?' + query : ''}`);

export const insert = (table, rows, { upsert = false, onConflict = '' } = {}) =>
  req('POST',
    `/${table}${onConflict ? '?on_conflict=' + onConflict : ''}`,
    Array.isArray(rows) ? rows : [rows],
    { Prefer: `return=representation${upsert ? ',resolution=merge-duplicates' : ''}` });

export const update = (table, query, patch) =>
  req('PATCH', `/${table}?${query}`, patch, { Prefer: 'return=representation' });

export const remove = (table, query) => req('DELETE', `/${table}?${query}`);

// ---------------- state ----------------
export async function getState(key, dflt = null) {
  try {
    const r = await select('bot_state', `key=eq.${encodeURIComponent(key)}&select=value`);
    return r?.[0] ? r[0].value : dflt;
  } catch (e) { warn('getState', e.message); return dflt; }
}
export async function setState(key, value) {
  try {
    await insert('bot_state', { key, value, updated_at: new Date().toISOString() },
      { upsert: true, onConflict: 'key' });
  } catch (e) { warn('setState', e.message); }
}

// ---------------- sinyaller ----------------
export const AKTIF = (x) => x.status === 'takip' || x.status === 'bekliyor';
export const SAYILIR = (x) =>
  x.r_net !== null && x.r_net !== undefined && x.status !== 'atlandı' && x.status !== 'dolmadı';
export const netOf = (x) => (x.r_net !== null && x.r_net !== undefined ? x.r_net : x.r);

export const insertSignal = (row) =>
  insert('signals', row, { upsert: true, onConflict: 'key' });

export const openSignals = () =>
  select('signals', 'status=in.(takip,bekliyor)&order=created_at.desc&limit=200');

export const patchSignal = (key, patch) =>
  update('signals', `key=eq.${encodeURIComponent(key)}`, patch);

// Aynı coin+yön için son sinyal (soğuma kontrolü)
export const lastSignalFor = (symbol, dir) =>
  select('signals',
    `symbol=eq.${symbol}&dir=eq.${dir}&order=created_at.desc&limit=1`);

// Free kanala gönderilmeyi bekleyenler
export const freePending = (beforeIso) =>
  select('signals',
    `free_posted_at=is.null&created_at=lte.${encodeURIComponent(beforeIso)}&order=created_at.asc&limit=20`);

// Bir dönemdeki kapanmış sinyaller
export const closedBetween = (fromIso, toIso) =>
  select('signals',
    `status=in.(kazanç,kayıp,zaman)&closed_at=gte.${encodeURIComponent(fromIso)}` +
    `&closed_at=lt.${encodeURIComponent(toIso)}&order=closed_at.asc&limit=1000`);

export const signalsBetween = (fromIso, toIso) =>
  select('signals',
    `created_at=gte.${encodeURIComponent(fromIso)}&created_at=lt.${encodeURIComponent(toIso)}` +
    `&order=created_at.asc&limit=1000`);

// ---------------- VIP ----------------
export const vipGet = (tgId) =>
  select('vip_members', `telegram_id=eq.${tgId}&limit=1`).then((r) => r?.[0] || null);

export const vipUpsert = (row) =>
  insert('vip_members', row, { upsert: true, onConflict: 'telegram_id' });

export const vipPatch = (tgId, patch) =>
  update('vip_members', `telegram_id=eq.${tgId}`, patch);

export const vipActive = () =>
  select('vip_members', 'status=eq.aktif&order=expires_at.asc&limit=1000');

export const vipExpiring = (untilIso) =>
  select('vip_members',
    `status=eq.aktif&expires_at=lte.${encodeURIComponent(untilIso)}&order=expires_at.asc&limit=200`);

// ---------------- ödemeler ----------------
export const payInsert = (row) => insert('payments', row, { upsert: true, onConflict: 'order_id' });
export const payByOrder = (orderId) =>
  select('payments', `order_id=eq.${encodeURIComponent(orderId)}&limit=1`).then((r) => r?.[0] || null);
export const payPatch = (orderId, patch) =>
  update('payments', `order_id=eq.${encodeURIComponent(orderId)}`,
    { ...patch, updated_at: new Date().toISOString() });

// ---------------- gönderiler ----------------
export async function postOnce(kind, channel, periodKey, messageId) {
  try {
    await insert('posts', { kind, channel, period_key: periodKey, message_id: messageId },
      { upsert: false });
    return true;
  } catch (e) {
    if (/duplicate|unique/i.test(e.message)) return false;
    throw e;
  }
}
export const postExists = (kind, channel, periodKey) =>
  select('posts',
    `kind=eq.${kind}&channel=eq.${channel}&period_key=eq.${encodeURIComponent(periodKey)}&limit=1`)
    .then((r) => Boolean(r?.length));

// ---------------- kullanıcılar ----------------
export const userSeen = (u) =>
  insert('bot_users', {
    telegram_id: u.id, username: u.username || null,
    first_name: u.first_name || null, last_seen: new Date().toISOString(),
  }, { upsert: true, onConflict: 'telegram_id' }).catch(() => {});

export async function ping() {
  await select('bot_state', 'select=key&limit=1');
  return true;
}

/* ============================================================
   002: dashboard / eğitim / tıklama
   ============================================================ */

// ---------------- kanal istatistiği ----------------
export const statsSnapshot = (day, channel, members) =>
  insert('channel_stats', { day, channel, members },
    { upsert: true, onConflict: 'day,channel' });

export const statsHistory = (days = 30) =>
  select('channel_stats',
    `order=day.desc&limit=${days * 2}`);

// ---------------- tıklama ----------------
export const clickAdd = (row) => insert('click_events', row).catch(() => null);

export const clicksSince = (iso) =>
  select('click_events',
    `created_at=gte.${encodeURIComponent(iso)}&select=id,kind,source,signal_key,created_at` +
    `&order=created_at.desc&limit=2000`);

// ---------------- eğitim ----------------
export const eduPosted = (channel) =>
  select('edu_log', `channel=eq.${channel}&select=lesson_id,posted_at&order=posted_at.desc&limit=500`);

export const eduAdd = (lessonId, channel, messageId) =>
  insert('edu_log', { lesson_id: lessonId, channel, message_id: messageId });

export const eduLast = (channel) =>
  select('edu_log', `channel=eq.${channel}&order=posted_at.desc&limit=1`)
    .then((r) => r?.[0] || null);

// ---------------- free vitrin kotası ----------------
// Bir TR gününde free kanala kaç sinyal gönderildi
export const freePostedBetween = (fromIso, toIso) =>
  select('signals',
    `free_posted_at=gte.${encodeURIComponent(fromIso)}` +
    `&free_posted_at=lt.${encodeURIComponent(toIso)}` +
    `&free_skipped=is.false&select=key,symbol,free_posted_at,free_kind&limit=100`);

// Free'ye gönderilmeyi bekleyen adaylar (atlanmış olanlar hariç)
export const freeCandidates = (beforeIso) =>
  select('signals',
    `free_posted_at=is.null&free_skipped=is.false` +
    `&created_at=lte.${encodeURIComponent(beforeIso)}` +
    `&order=created_at.asc&limit=40`);

export const payRecent = (limit = 20) =>
  select('payments', `order=created_at.desc&limit=${limit}`);

export const paySince = (iso) =>
  select('payments',
    `created_at=gte.${encodeURIComponent(iso)}&order=created_at.desc&limit=500`);

export const vipJoinedSince = (iso) =>
  select('vip_members',
    `last_payment_at=gte.${encodeURIComponent(iso)}&order=last_payment_at.desc&limit=200`);

export const signalsRecent = (limit = 25) =>
  select('signals', `order=created_at.desc&limit=${limit}`);

export const usersCount = () =>
  select('bot_users', 'select=telegram_id&limit=10000').then((r) => (r || []).length);
