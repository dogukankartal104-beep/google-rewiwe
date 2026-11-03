// Veri katmanı — PostgreSQL (Railway Postgres).
// Tek ayar: DATABASE_URL. Railway'de Postgres eklersen otomatik gelir.
// Tablolar açılışta bot tarafından kurulur — elle SQL çalıştırmak GEREKMEZ.
import pg from 'pg';
import { log, warn } from './util.js';

const URL = (process.env.DATABASE_URL || '').trim();

// Railway iç ağı (postgres.railway.internal) SSL istemez; dış/proxy adresleri ister.
const needsSsl = URL && !/railway\.internal|localhost|127\.0\.0\.1/.test(URL);

let pool = null;
if (URL) {
  pool = new pg.Pool({
    connectionString: URL,
    ssl: needsSsl ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });
  pool.on('error', (e) => warn('pg havuz hatası:', e.message));
}

export const dbReady = () => Boolean(pool);

export async function q(text, params = []) {
  if (!pool) throw new Error('DATABASE_URL ayarlı değil — Railway\'de Postgres ekle');
  const r = await pool.query(text, params);
  return r.rows;
}
const one = async (text, params) => (await q(text, params))[0] || null;

/* ============================================================
   ŞEMA — açılışta çalışır, tekrar çalıştırmak güvenlidir
   ============================================================ */
const SCHEMA = [
  `create table if not exists signals (
    id bigserial primary key,
    key text unique not null,
    symbol text not null,
    dir text not null,
    tf text not null,
    grade text, type text, verdict text, qual int,
    entry double precision not null,
    stop double precision not null,
    tp1 double precision, tp2 double precision, tp1_label text,
    rr double precision, risk_pct double precision, qty double precision,
    decimals int default 4,
    ex_n int, tr_n int, teyit_ps int, teyit_av int,
    why text, trg text,
    leg double precision, oi_chg double precision, oi_ratio double precision,
    sweep boolean, atr_pct double precision, vol_ratio double precision,
    bars_stop int, bars_tp int, cost_r double precision default 0, session text,
    status text not null default 'takip', skip_why text,
    max_r double precision default 0, min_r double precision default 0,
    open_r double precision default 0, last_px double precision,
    stop_now double precision,
    r double precision, r_net double precision, close_px double precision,
    closed_at timestamptz, partial boolean default false,
    vip_msg_id bigint, free_msg_id bigint, free_posted_at timestamptz,
    result_msg_id bigint,
    free_kind text, free_skipped boolean default false,
    free_skip_why text, free_open_r double precision,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists signals_status_idx on signals (status)`,
  `create index if not exists signals_created_idx on signals (created_at desc)`,
  `create index if not exists signals_symdir_idx on signals (symbol, dir, created_at desc)`,
  `create index if not exists signals_closed_idx on signals (closed_at desc)`,

  `create table if not exists vip_members (
    telegram_id bigint primary key,
    username text, first_name text,
    status text not null default 'aktif',
    plan text,
    started_at timestamptz not null default now(),
    expires_at timestamptz not null,
    total_paid double precision default 0,
    last_payment_at timestamptz,
    invite_link text, reminded_at timestamptz, kicked_at timestamptz, note text,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists vip_expires_idx on vip_members (status, expires_at)`,
  `alter table vip_members add column if not exists remind_stage int not null default 0`,
  `alter table vip_members add column if not exists winback_at timestamptz`,

  `create table if not exists payments (
    id bigserial primary key,
    order_id text unique not null,
    np_payment_id text, np_invoice_id text,
    telegram_id bigint, plan text, days int,
    amount double precision, currency text, pay_currency text,
    actually_paid double precision,
    status text not null default 'waiting',
    credited boolean not null default false,
    credited_at timestamptz,
    raw jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  `create index if not exists payments_np_idx on payments (np_payment_id)`,
  `create index if not exists payments_tg_idx on payments (telegram_id, created_at desc)`,

  `create table if not exists posts (
    id bigserial primary key,
    kind text not null, channel text not null, period_key text not null,
    message_id bigint, posted_at timestamptz not null default now(),
    unique (kind, channel, period_key)
  )`,

  `create table if not exists bot_state (
    key text primary key, value jsonb, updated_at timestamptz not null default now()
  )`,

  `create table if not exists bot_users (
    telegram_id bigint primary key, username text, first_name text,
    lang text not null default 'en',
    last_seen timestamptz not null default now(),
    created_at timestamptz not null default now()
  )`,
  `alter table bot_users add column if not exists lang text not null default 'en'`,

  `create table if not exists channel_stats (
    day date not null, channel text not null, members int,
    created_at timestamptz not null default now(),
    primary key (day, channel)
  )`,

  `create table if not exists click_events (
    id bigserial primary key,
    kind text not null, source text, signal_key text, ua text,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists click_created_idx on click_events (created_at desc)`,

  `create table if not exists edu_log (
    id bigserial primary key,
    lesson_id text not null, channel text not null, message_id bigint,
    posted_at timestamptz not null default now(),
    unique (lesson_id, channel)
  )`,

  // haber motoru: aynı haberi iki kez atmamak için
  `create table if not exists news_log (
    id bigserial primary key,
    uid text unique not null,
    title text, url text, source text,
    score int, tags text,
    channel text,
    message_id bigint,
    posted_at timestamptz not null default now()
  )`,
  `create index if not exists news_posted_idx on news_log (posted_at desc)`,
];

export async function migrate() {
  if (!pool) { warn('DATABASE_URL yok — veritabanı kurulmadı'); return false; }
  for (const sql of SCHEMA) {
    try { await q(sql); }
    catch (e) { warn('şema:', e.message.slice(0, 160)); }
  }
  log(`veritabanı hazır (${SCHEMA.length} tanım kontrol edildi)`);
  return true;
}

export async function ping() {
  await q('select 1');
  return true;
}

export async function close() {
  if (pool) await pool.end().catch(() => {});
}

/* ============================================================
   DURUM
   ============================================================ */
export async function getState(key, dflt = null) {
  try {
    const r = await one('select value from bot_state where key=$1', [key]);
    return r ? r.value : dflt;
  } catch (e) { warn('getState:', e.message); return dflt; }
}
export async function setState(key, value) {
  try {
    await q(`insert into bot_state (key,value,updated_at) values ($1,$2,now())
             on conflict (key) do update set value=excluded.value, updated_at=now()`,
      [key, JSON.stringify(value)]);
  } catch (e) { warn('setState:', e.message); }
}

/* ============================================================
   SİNYALLER
   ============================================================ */
export const AKTIF = (x) => x.status === 'takip' || x.status === 'bekliyor';
export const SAYILIR = (x) =>
  x.r_net !== null && x.r_net !== undefined && x.status !== 'atlandı' && x.status !== 'dolmadı';
export const netOf = (x) => (x.r_net !== null && x.r_net !== undefined ? x.r_net : x.r);

const SIG_COLS = [
  'key', 'symbol', 'dir', 'tf', 'grade', 'type', 'verdict', 'qual',
  'entry', 'stop', 'tp1', 'tp2', 'tp1_label', 'rr', 'risk_pct', 'qty', 'decimals',
  'ex_n', 'tr_n', 'teyit_ps', 'teyit_av', 'why', 'trg',
  'leg', 'oi_chg', 'oi_ratio', 'sweep', 'atr_pct', 'vol_ratio',
  'bars_stop', 'bars_tp', 'cost_r', 'session', 'status', 'skip_why', 'created_at',
];

export async function insertSignal(row) {
  const cols = SIG_COLS.filter((c) => row[c] !== undefined);
  const vals = cols.map((c) => row[c]);
  const ph = cols.map((_, i) => '$' + (i + 1)).join(',');
  const upd = cols.filter((c) => c !== 'key').map((c) => `${c}=excluded.${c}`).join(',');
  const r = await q(
    `insert into signals (${cols.join(',')}) values (${ph})
     on conflict (key) do update set ${upd} returning *`, vals);
  return r;
}

export const openSignals = () =>
  q(`select * from signals where status in ('takip','bekliyor')
     order by created_at desc limit 200`);

export async function patchSignal(key, patch) {
  const cols = Object.keys(patch).filter((c) => patch[c] !== undefined);
  if (!cols.length) return null;
  const sets = cols.map((c, i) => `${c}=$${i + 2}`).join(',');
  return q(`update signals set ${sets} where key=$1 returning *`,
    [key, ...cols.map((c) => patch[c])]);
}

export const lastSignalFor = (symbol, dir) =>
  q(`select * from signals where symbol=$1 and dir=$2 order by created_at desc limit 1`,
    [symbol, dir]);

export const closedBetween = (fromIso, toIso) =>
  q(`select * from signals where status in ('kazanç','kayıp','zaman')
     and closed_at >= $1 and closed_at < $2 order by closed_at asc limit 1000`,
    [fromIso, toIso]);

export const signalsBetween = (fromIso, toIso) =>
  q(`select * from signals where created_at >= $1 and created_at < $2
     order by created_at asc limit 1000`, [fromIso, toIso]);

export const freePostedBetween = (fromIso, toIso) =>
  q(`select key,symbol,free_posted_at,free_kind from signals
     where free_posted_at >= $1 and free_posted_at < $2
     and coalesce(free_skipped,false)=false limit 100`, [fromIso, toIso]);

export const freeCandidates = (beforeIso) =>
  q(`select * from signals where free_posted_at is null
     and coalesce(free_skipped,false)=false and created_at <= $1
     order by created_at asc limit 40`, [beforeIso]);

export const signalsRecent = (limit = 25) =>
  q(`select * from signals order by created_at desc limit $1`, [limit]);

/* ============================================================
   VIP
   ============================================================ */
export const vipGet = (tgId) =>
  one('select * from vip_members where telegram_id=$1', [tgId]);

export async function vipUpsert(row) {
  const cols = Object.keys(row).filter((c) => row[c] !== undefined);
  const ph = cols.map((_, i) => '$' + (i + 1)).join(',');
  const upd = cols.filter((c) => c !== 'telegram_id').map((c) => `${c}=excluded.${c}`).join(',');
  return q(`insert into vip_members (${cols.join(',')}) values (${ph})
            on conflict (telegram_id) do update set ${upd} returning *`,
    cols.map((c) => row[c]));
}

export async function vipPatch(tgId, patch) {
  const cols = Object.keys(patch).filter((c) => patch[c] !== undefined);
  if (!cols.length) return null;
  const sets = cols.map((c, i) => `${c}=$${i + 2}`).join(',');
  return q(`update vip_members set ${sets} where telegram_id=$1 returning *`,
    [tgId, ...cols.map((c) => patch[c])]);
}

export const vipActive = () =>
  q(`select * from vip_members where status='aktif' order by expires_at asc limit 1000`);

export const vipExpiring = (untilIso) =>
  q(`select * from vip_members where status='aktif' and expires_at <= $1
     order by expires_at asc limit 200`, [untilIso]);

// lapsed members who have not yet had their one win-back message
export const vipWinbackDue = (kickedBeforeIso) =>
  q(`select * from vip_members where status='süresi_doldu' and winback_at is null
     and kicked_at is not null and kicked_at <= $1 order by kicked_at asc limit 100`,
    [kickedBeforeIso]);

export const vipJoinedSince = (iso) =>
  q(`select * from vip_members where last_payment_at >= $1
     order by last_payment_at desc limit 200`, [iso]);

/* ============================================================
   ÖDEMELER
   ============================================================ */
export async function payInsert(row) {
  const cols = Object.keys(row).filter((c) => row[c] !== undefined);
  const vals = cols.map((c) => (c === 'raw' ? JSON.stringify(row[c]) : row[c]));
  const ph = cols.map((_, i) => '$' + (i + 1)).join(',');
  const upd = cols.filter((c) => c !== 'order_id').map((c) => `${c}=excluded.${c}`).join(',');
  return q(`insert into payments (${cols.join(',')}) values (${ph})
            on conflict (order_id) do update set ${upd} returning *`, vals);
}

export const payByOrder = (orderId) =>
  one('select * from payments where order_id=$1', [orderId]);

export async function payPatch(orderId, patch) {
  const cols = Object.keys(patch).filter((c) => patch[c] !== undefined);
  if (!cols.length) return null;
  const sets = cols.map((c, i) => `${c}=$${i + 2}`).join(',');
  const vals = cols.map((c) => (c === 'raw' ? JSON.stringify(patch[c]) : patch[c]));
  return q(`update payments set ${sets}, updated_at=now() where order_id=$1 returning *`,
    [orderId, ...vals]);
}

export const payRecent = (limit = 20) =>
  q('select * from payments order by created_at desc limit $1', [limit]);

export const paySince = (iso) =>
  q('select * from payments where created_at >= $1 order by created_at desc limit 500', [iso]);

/* ============================================================
   GÖNDERİ KAYDI
   ============================================================ */
export async function postOnce(kind, channel, periodKey, messageId) {
  const r = await q(
    `insert into posts (kind,channel,period_key,message_id) values ($1,$2,$3,$4)
     on conflict (kind,channel,period_key) do nothing returning id`,
    [kind, channel, periodKey, messageId ?? null]);
  return r.length > 0;
}

export const postExists = (kind, channel, periodKey) =>
  q(`select 1 from posts where kind=$1 and channel=$2 and period_key=$3 limit 1`,
    [kind, channel, periodKey]).then((r) => r.length > 0);

/* ============================================================
   KULLANICILAR
   ============================================================ */
export const userSeen = (u) =>
  q(`insert into bot_users (telegram_id,username,first_name,last_seen)
     values ($1,$2,$3,now())
     on conflict (telegram_id) do update set
       username=excluded.username, first_name=excluded.first_name, last_seen=now()`,
    [u.id, u.username || null, u.first_name || null]).catch(() => {});

/* Kullanıcının DM dili. Kanal içeriği her zaman İngilizce. */
export const getUserLang = (tgId) =>
  q('select lang from bot_users where telegram_id=$1', [tgId])
    .then((r) => r[0]?.lang || 'en')
    .catch(() => 'en');

export const setUserLang = (tgId, lang) =>
  q(`insert into bot_users (telegram_id, lang) values ($1,$2)
     on conflict (telegram_id) do update set lang=excluded.lang`, [tgId, lang])
    .catch(() => null);

export const usersCount = () =>
  q('select count(*)::int as n from bot_users').then((r) => r[0]?.n || 0);

/* ============================================================
   KANAL / TIKLAMA / EĞİTİM
   ============================================================ */
export const statsSnapshot = (day, channel, members) =>
  q(`insert into channel_stats (day,channel,members) values ($1,$2,$3)
     on conflict (day,channel) do update set members=excluded.members`,
    [day, channel, members]);

export const statsHistory = (days = 30) =>
  q(`select to_char(day,'YYYY-MM-DD') as day, channel, members
     from channel_stats order by day desc limit $1`, [days * 2]);

export const clickAdd = (row) =>
  q(`insert into click_events (kind,source,signal_key,ua) values ($1,$2,$3,$4)`,
    [row.kind, row.source || null, row.signal_key || null, row.ua || null]).catch(() => null);

export const clicksSince = (iso) =>
  q(`select id,kind,source,signal_key,created_at from click_events
     where created_at >= $1 order by created_at desc limit 2000`, [iso]);

export const eduPosted = (channel) =>
  q(`select lesson_id,posted_at from edu_log where channel=$1
     order by posted_at desc limit 500`, [channel]);

export const eduAdd = (lessonId, channel, messageId) =>
  q(`insert into edu_log (lesson_id,channel,message_id) values ($1,$2,$3)
     on conflict (lesson_id,channel) do nothing returning id`,
    [lessonId, channel, messageId ?? null]);

export const eduLast = (channel) =>
  one(`select * from edu_log where channel=$1 order by posted_at desc limit 1`, [channel]);

/* ============================================================
   HABER
   ============================================================ */
export const newsSeen = (uid) =>
  q('select 1 from news_log where uid=$1 limit 1', [uid]).then((r) => r.length > 0);

export const newsAdd = (row) =>
  q(`insert into news_log (uid,title,url,source,score,tags,channel,message_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (uid) do nothing returning id`,
    [row.uid, row.title, row.url, row.source, row.score, row.tags, row.channel, row.message_id ?? null]);

export const newsRecent = (limit = 30) =>
  q('select * from news_log order by posted_at desc limit $1', [limit]);

export const newsSince = (iso) =>
  q('select * from news_log where posted_at >= $1 order by posted_at desc limit 200', [iso]);
