import { pool } from './db.js';
import { providers, freshAccount } from './providers.js';

export async function runPost(post) {
  const results = {};
  for (const platform of post.platforms) {
    try {
      const acc = await freshAccount(platform);
      const id = await providers[platform].publish(acc, post);
      results[platform] = { ok: true, id };
    } catch (e) {
      console.error(`[${post.id}] ${platform}:`, e.message);
      results[platform] = { ok: false, error: e.message.slice(0, 500) };
    }
  }
  const oks = Object.values(results).filter((r) => r.ok).length;
  const status = oks === post.platforms.length ? 'done' : oks ? 'partial' : 'failed';
  await pool.query('update posts set status=$1, results=$2 where id=$3', [status, results, post.id]);
}

async function tick() {
  const { rows } = await pool.query(
    `update posts set status='running' where id in (
       select id from posts where status='scheduled' and scheduled_at <= now()
       order by scheduled_at limit 3 for update skip locked
     ) returning *`,
  );
  for (const post of rows) await runPost(post);
}

export function startScheduler() {
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await tick(); } catch (e) { console.error('scheduler:', e.message); }
    busy = false;
  }, 30_000);
}
