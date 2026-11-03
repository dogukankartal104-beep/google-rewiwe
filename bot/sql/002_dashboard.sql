-- ============================================================
--  FADE BOT — 002: dashboard + eğitim + tıklama takibi
--  schema.sql'den SONRA çalıştır. Tekrar çalıştırmak güvenlidir.
-- ============================================================

-- ---------- KANAL İSTATİSTİĞİ (günlük abone fotoğrafı) ----------
-- Telegram Bot API gönderi görüntülenmesini VERMEZ. Onun yerine
-- abone sayısını günlük kaydediyoruz; büyüme buradan görülür.
create table if not exists channel_stats (
  day         date not null,
  channel     text not null,              -- free | vip
  members     int,
  created_at  timestamptz not null default now(),
  primary key (day, channel)
);

-- ---------- TIKLAMA TAKİBİ ----------
-- Free kanaldaki VIP butonu bot üzerinden yönlendirilir, böylece
-- "kaç kişi gerçekten ilgilendi" ölçülebilir (görüntülenmeden daha değerli).
create table if not exists click_events (
  id          bigserial primary key,
  kind        text not null,              -- vip
  source      text,                       -- free | vip | dm | teaser | result | perf | edu
  signal_key  text,
  ua          text,
  created_at  timestamptz not null default now()
);
create index if not exists click_created_idx on click_events (created_at desc);
create index if not exists click_source_idx  on click_events (source, created_at desc);

-- ---------- EĞİTİM GÖNDERİ KAYDI ----------
create table if not exists edu_log (
  id          bigserial primary key,
  lesson_id   text not null,
  channel     text not null,              -- free | vip
  message_id  bigint,
  posted_at   timestamptz not null default now(),
  unique (lesson_id, channel)
);

-- ---------- signals: free vitrin alanları ----------
alter table signals add column if not exists free_kind       text;        -- teaser | showcase | result
alter table signals add column if not exists free_skipped    boolean default false;
alter table signals add column if not exists free_skip_why   text;
alter table signals add column if not exists free_open_r     double precision; -- vitrinde gösterilen R

alter table channel_stats enable row level security;
alter table click_events  enable row level security;
alter table edu_log       enable row level security;
