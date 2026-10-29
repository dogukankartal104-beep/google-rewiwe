import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /railway\.internal|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '') ? false : process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

export async function init() {
  await pool.query(`
    create table if not exists accounts (
      platform text primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    );
    create table if not exists settings (key text primary key, value text not null);
    create table if not exists workspaces (
      id serial primary key,
      name text not null,
      created_at timestamptz not null default now()
    );
    insert into workspaces(name) select 'Hedefbesyom' where not exists (select 1 from workspaces);
    create table if not exists posts (
      id serial primary key,
      caption text not null default '',
      title text not null default '',
      video_url text not null,
      platforms text[] not null,
      scheduled_at timestamptz not null,
      status text not null default 'scheduled',
      results jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
  `);
  await pool.query(`
    alter table accounts add column if not exists workspace_id int not null default 1;
    alter table posts add column if not exists workspace_id int not null default 1;
    do $$ begin
      if exists (select 1 from pg_constraint where conname='accounts_pkey' and conrelid='accounts'::regclass and array_length(conkey,1)=1) then
        alter table accounts drop constraint accounts_pkey;
        alter table accounts add primary key (workspace_id, platform);
      end if;
    end $$;
    create table if not exists snapshots (
      workspace_id int not null, platform text not null, day date not null, data jsonb not null,
      primary key (workspace_id, platform, day)
    );
  `);
  await pool.query(`update posts set status='failed', results = results || '{"_":{"ok":false,"error":"sunucu yeniden basladi"}}' where status='running'`);
}

export async function getAccount(ws, platform) {
  const { rows } = await pool.query('select data from accounts where workspace_id=$1 and platform=$2', [ws, platform]);
  return rows[0]?.data ?? null;
}

export async function saveAccount(ws, platform, data) {
  await pool.query(
    `insert into accounts(workspace_id,platform,data) values($1,$2,$3)
     on conflict (workspace_id,platform) do update set data=$3, updated_at=now()`,
    [ws, platform, data],
  );
}

const cache = {};
export const cfg = (k) => cache[k] || process.env[k];
export async function loadSettings() {
  const { rows } = await pool.query('select key,value from settings');
  for (const r of rows) cache[r.key] = r.value;
}
export async function setSetting(k, v) {
  await pool.query('insert into settings(key,value) values($1,$2) on conflict (key) do update set value=$2', [k, v]);
  cache[k] = v;
}
