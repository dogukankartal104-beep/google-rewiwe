import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway.internal') ? false : process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
});

export async function init() {
  await pool.query(`
    create table if not exists accounts (
      platform text primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    );
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
  await pool.query(`update posts set status='failed', results = results || '{"_":{"ok":false,"error":"sunucu yeniden basladi"}}' where status='running'`);
}

export async function getAccount(platform) {
  const { rows } = await pool.query('select data from accounts where platform=$1', [platform]);
  return rows[0]?.data ?? null;
}

export async function saveAccount(platform, data) {
  await pool.query(
    `insert into accounts(platform,data) values($1,$2)
     on conflict (platform) do update set data=$2, updated_at=now()`,
    [platform, data],
  );
}
