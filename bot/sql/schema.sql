-- ============================================================
-- FADE BOT — Supabase şeması
-- Supabase > SQL Editor'a yapıştır ve çalıştır.
-- ============================================================

-- ---------- SİNYALLER ----------
create table if not exists signals (
  id              bigserial primary key,
  key             text unique not null,          -- SYMBOL+DIR+timestamp
  symbol          text not null,
  dir             text not null check (dir in ('L','S')),
  tf              text not null,
  grade           text,
  type            text,
  verdict         text,
  qual            int,
  -- plan
  entry           double precision not null,
  stop            double precision not null,
  tp1             double precision,
  tp2             double precision,
  tp1_label       text,
  rr              double precision,
  risk_pct        double precision,
  qty             double precision,
  decimals        int default 4,
  -- onay detayı
  ex_n            int, tr_n int,
  teyit_ps        int, teyit_av int,
  why             text, trg text,
  leg             double precision,
  oi_chg          double precision,
  oi_ratio        double precision,
  sweep           boolean,
  atr_pct         double precision,
  vol_ratio       double precision,
  bars_stop       int, bars_tp int,
  cost_r          double precision default 0,
  session         text,
  -- takip / sonuç
  status          text not null default 'takip',  -- takip|bekliyor|kazanç|kayıp|zaman|dolmadı|atlandı
  skip_why        text,
  max_r           double precision default 0,
  min_r           double precision default 0,
  open_r          double precision default 0,
  last_px         double precision,
  stop_now        double precision,   -- TP1 sonrası başabaşa çekilen stop
  r               double precision,
  r_net           double precision,
  close_px        double precision,
  closed_at       timestamptz,
  partial         boolean default false,
  -- yayın
  vip_msg_id      bigint,
  free_msg_id     bigint,
  free_posted_at  timestamptz,
  result_msg_id   bigint,
  created_at      timestamptz not null default now()
);
create index if not exists signals_status_idx  on signals (status);
create index if not exists signals_created_idx on signals (created_at desc);
create index if not exists signals_symdir_idx  on signals (symbol, dir, created_at desc);
create index if not exists signals_freepend_idx on signals (free_posted_at, created_at)
  where free_posted_at is null;

-- ---------- VIP ÜYELER ----------
create table if not exists vip_members (
  telegram_id     bigint primary key,
  username        text,
  first_name      text,
  status          text not null default 'aktif',  -- aktif|süresi_doldu|çıkarıldı|iptal
  plan            text,
  started_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  total_paid      double precision default 0,
  last_payment_at timestamptz,
  invite_link     text,
  reminded_at     timestamptz,
  kicked_at       timestamptz,
  note            text,
  created_at      timestamptz not null default now()
);
create index if not exists vip_expires_idx on vip_members (status, expires_at);

-- ---------- ÖDEMELER ----------
create table if not exists payments (
  id              bigserial primary key,
  order_id        text unique not null,          -- bizim ürettiğimiz: tg<id>-<plan>-<ts>
  np_payment_id   text,
  np_invoice_id   text,
  telegram_id     bigint,
  plan            text,
  days            int,
  amount          double precision,
  currency        text,
  pay_currency    text,
  actually_paid   double precision,
  status          text not null default 'waiting',
  credited        boolean not null default false,
  credited_at     timestamptz,
  raw             jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists payments_np_idx    on payments (np_payment_id);
create index if not exists payments_tg_idx    on payments (telegram_id, created_at desc);

-- ---------- GÖNDERİ KAYDI (tekrar göndermeyi önler) ----------
create table if not exists posts (
  id            bigserial primary key,
  kind          text not null,                   -- daily|weekly|monthly
  channel       text not null,                   -- free|vip
  period_key    text not null,                   -- 2026-11-03 / 2026-W45 / 2026-11
  message_id    bigint,
  posted_at     timestamptz not null default now(),
  unique (kind, channel, period_key)
);

-- ---------- BOT DURUMU ----------
create table if not exists bot_state (
  key         text primary key,
  value       jsonb,
  updated_at  timestamptz not null default now()
);

-- ---------- KULLANICILAR (DM /start) ----------
create table if not exists bot_users (
  telegram_id   bigint primary key,
  username      text,
  first_name    text,
  last_seen     timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

-- RLS: service_role ile bağlanıyoruz, anon erişimi kapalı kalsın.
alter table signals     enable row level security;
alter table vip_members enable row level security;
alter table payments    enable row level security;
alter table posts       enable row level security;
alter table bot_state   enable row level security;
alter table bot_users   enable row level security;
