import { pool } from './db.js';
import { freshAccount } from './providers.js';

const IGV = 'https://graph.instagram.com/v22.0';
const YT = 'https://www.googleapis.com/youtube/v3';
const TT = 'https://open.tiktokapis.com/v2';
const num = (v) => (v == null || v === '' ? undefined : Number(v));

async function j(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error(`${res.status} ${typeof body === 'string' ? body : JSON.stringify(body)}`.slice(0, 300));
  return body;
}

async function inChunks(items, n, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(...(await Promise.all(items.slice(i, i + n).map(fn))));
  return out;
}

/* ---------------- Instagram ---------------- */
async function instagram(acc) {
  const t = acc.access_token, notes = [];
  const me = await j(`${IGV}/${acc.user_id}?fields=username,followers_count,follows_count,media_count&access_token=${t}`);
  const media = (await j(`${IGV}/${acc.user_id}/media?fields=id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count&limit=25&access_token=${t}`)).data || [];
  // Bazı metrikler bazı gönderi türlerinde desteklenmiyor; yelpazeyi daraltarak dene.
  const sets = ['reach,views,saved,shares,total_interactions,follows', 'reach,views,saved,shares,total_interactions', 'reach,saved,shares', 'reach'];
  let missing = 0;
  const posts = await inChunks(media, 5, async (m) => {
    const ins = {};
    let ok = false;
    for (const set of sets) {
      try {
        const r = await j(`${IGV}/${m.id}/insights?metric=${set}&access_token=${t}`);
        for (const d of r.data || []) ins[d.name] = d.values?.[0]?.value;
        ok = true;
        break;
      } catch {}
    }
    if (!ok) missing++;
    return {
      id: m.id, url: m.permalink, caption: m.caption || '', time: m.timestamp,
      thumb: m.thumbnail_url || m.media_url, type: m.media_product_type || m.media_type,
      metrics: { views: ins.views ?? ins.reach, reach: ins.reach, likes: m.like_count, comments: m.comments_count, shares: ins.shares, saved: ins.saved, follows: ins.follows },
    };
  });
  if (missing) notes.push(`${missing} gönderinin içgörüsü okunamadı (çok yeni, hikaye ya da izin eksik olabilir).`);
  const insights = {};
  const until = Math.floor(Date.now() / 1000), since = until - 7 * 86400;
  for (const metric of ['reach', 'profile_views', 'website_clicks', 'profile_links_taps']) {
    try {
      const r = await j(`${IGV}/${acc.user_id}/insights?metric=${metric}&period=day&metric_type=total_value&since=${since}&until=${until}&access_token=${t}`);
      insights[metric] = r.data?.[0]?.total_value?.value;
    } catch {}
  }
  if (!Object.keys(insights).length) notes.push('Hesap içgörüleri (erişim, profil ziyareti, link tıklaması) okunamadı: Instagram hesabını "yenile" ile yeniden bağla.');
  return { handle: me.username, account: { followers: me.followers_count, following: me.follows_count, posts: me.media_count, insights }, posts, notes };
}

/* ---------------- YouTube ---------------- */
async function youtube(acc) {
  const h = { Authorization: `Bearer ${acc.access_token}` };
  const ch = (await j(`${YT}/channels?part=snippet,statistics,contentDetails&mine=true`, { headers: h })).items?.[0];
  if (!ch) throw new Error('YouTube kanalı bulunamadı');
  const pl = await j(`${YT}/playlistItems?part=contentDetails&maxResults=25&playlistId=${ch.contentDetails.relatedPlaylists.uploads}`, { headers: h });
  const ids = (pl.items || []).map((i) => i.contentDetails.videoId);
  const vids = ids.length ? (await j(`${YT}/videos?part=snippet,statistics,status&id=${ids.join(',')}`, { headers: h })).items || [] : [];
  const posts = vids.map((v) => ({
    id: v.id, url: `https://www.youtube.com/watch?v=${v.id}`, caption: v.snippet.title, time: v.snippet.publishedAt,
    thumb: v.snippet.thumbnails?.medium?.url, type: 'video', privacy: v.status?.privacyStatus,
    metrics: { views: num(v.statistics.viewCount), likes: num(v.statistics.likeCount), comments: num(v.statistics.commentCount) },
  }));
  const notes = [];
  if (posts.some((p) => p.privacy === 'private')) notes.push('Bazı videolar "özel" durumda (Google denetimi geçilene kadar API böyle yükler). YouTube Studio\'dan herkese açık yapabilirsin.');
  return {
    handle: ch.snippet.title,
    account: { followers: ch.statistics.hiddenSubscriberCount ? undefined : num(ch.statistics.subscriberCount), views: num(ch.statistics.viewCount), posts: num(ch.statistics.videoCount) },
    posts, notes,
  };
}

/* ---------------- TikTok ---------------- */
async function tiktok(acc) {
  const h = { Authorization: `Bearer ${acc.access_token}`, 'Content-Type': 'application/json' };
  const notes = [];
  let user = {};
  try {
    user = (await j(`${TT}/user/info/?fields=display_name,follower_count,following_count,likes_count,video_count`, { headers: h })).data?.user || {};
  } catch (e) {
    notes.push('Takipçi bilgisi okunamadı (user.info.stats izni): ' + e.message);
  }
  let vids = [];
  try {
    vids = (await j(`${TT}/video/list/?fields=id,title,video_description,create_time,cover_image_url,share_url,view_count,like_count,comment_count,share_count`, { method: 'POST', headers: h, body: JSON.stringify({ max_count: 20 }) })).data?.videos || [];
  } catch (e) {
    notes.push('Video listesi okunamadı (video.list izni, Display API): ' + e.message);
  }
  if (!vids.length && !notes.length) notes.push('Henüz yayınlanmış video yok. Taslağa düşen videolar, sen TikTok\'ta yayınlayana kadar görünmez.');
  const posts = vids.map((v) => ({
    id: v.id, url: v.share_url, caption: v.video_description || v.title || '', time: new Date(v.create_time * 1000).toISOString(),
    thumb: v.cover_image_url, type: 'video',
    metrics: { views: num(v.view_count), likes: num(v.like_count), comments: num(v.comment_count), shares: num(v.share_count) },
  }));
  return { handle: user.display_name || acc.handle, account: { followers: num(user.follower_count), following: num(user.following_count), likes: num(user.likes_count), posts: num(user.video_count) }, posts, notes };
}

const fetchers = { instagram, youtube, tiktok };

/* ---------------- Anlık görüntü + önbellek ---------------- */
const cache = new Map();
export const clearCache = (ws, platform) => cache.delete(`${ws}:${platform}`);

async function history(ws, platform) {
  const { rows } = await pool.query(
    'select day::text as day, data from snapshots where workspace_id=$1 and platform=$2 order by day desc limit 90', [ws, platform]);
  return rows.reverse().map((r) => ({ day: r.day, ...r.data }));
}

export async function fetchAnalytics(ws, platform, { refresh = false } = {}) {
  const key = `${ws}:${platform}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (refresh ? 60e3 : 10 * 60e3)) return hit.data;
  const acc = await freshAccount(ws, platform);
  const data = await fetchers[platform](acc);
  data.platform = platform;
  const a = data.account;
  await pool.query(
    `insert into snapshots(workspace_id,platform,day,data) values($1,$2,current_date,$3)
     on conflict (workspace_id,platform,day) do update set data=$3`,
    [ws, platform, { followers: a.followers, views: a.views, posts: a.posts }]);
  data.history = await history(ws, platform);
  const first = data.history.find((p) => p.followers != null);
  if (first && data.history.length > 1 && a.followers != null) data.followersChange = { value: a.followers - first.followers, since: first.day };
  data.best = bestTimes(data.posts);
  cache.set(key, { at: Date.now(), data });
  return data;
}

/* ---------------- Senin hesabına göre en iyi saatler ---------------- */
const DAYS = { Monday: 'Pazartesi', Tuesday: 'Salı', Wednesday: 'Çarşamba', Thursday: 'Perşembe', Friday: 'Cuma', Saturday: 'Cumartesi', Sunday: 'Pazar' };
const block = (h) => (h >= 6 && h < 12 ? 'sabah (06-12)' : h >= 12 && h < 17 ? 'öğleden sonra (12-17)' : h >= 17 && h < 22 ? 'akşam (17-22)' : 'gece (22-06)');

export function bestTimes(posts) {
  const scored = posts.map((p) => ({ t: p.time, s: p.metrics.views ?? p.metrics.reach ?? p.metrics.likes })).filter((p) => p.t && p.s != null);
  if (scored.length < 6) return { enough: false, n: scored.length, note: `Yeterli veri yok (${scored.length} gönderi). En az 6 gönderiden sonra senin hesabına göre öneri çıkar.` };
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Istanbul', hour: 'numeric', hourCycle: 'h23', weekday: 'long' });
  const blocks = {}, days = {};
  for (const p of scored) {
    const parts = Object.fromEntries(fmt.formatToParts(new Date(p.t)).map((x) => [x.type, x.value]));
    for (const [map, k] of [[blocks, block(Number(parts.hour))], [days, DAYS[parts.weekday]]]) {
      (map[k] ||= []).push(p.s);
    }
  }
  const rank = (m) => Object.entries(m).map(([name, v]) => ({ name, n: v.length, avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length) })).sort((a, b) => b.avg - a.avg);
  return { enough: true, n: scored.length, blocks: rank(blocks), days: rank(days), note: 'Ortalama izlenme/erişime göre. Örnek sayısı azsa kesin sayma.' };
}

/* ---------------- Günde birkaç kez takipçi geçmişini kaydet ---------------- */
export function startSnapshots() {
  const run = async () => {
    const { rows } = await pool.query('select workspace_id, platform from accounts');
    for (const r of rows) await fetchAnalytics(r.workspace_id, r.platform, { refresh: true }).catch((e) => console.error('snapshot:', r.platform, e.message));
  };
  setTimeout(run, 60e3);
  setInterval(run, 6 * 3600e3);
}

/* ---------------- Yapay zekaya gidecek özet ---------------- */
export function summarize(results) {
  return results.map((r) => ({
    platform: r.platform, handle: r.handle, account: r.account, followersChange: r.followersChange,
    posts: r.posts.map((p) => ({
      id: p.id, type: p.type, date: p.time?.slice(0, 16), caption: p.caption.slice(0, 120),
      hour: p.time ? Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Istanbul', hour: 'numeric', hourCycle: 'h23' }).format(new Date(p.time))) : undefined,
      ...p.metrics,
    })),
  }));
}
