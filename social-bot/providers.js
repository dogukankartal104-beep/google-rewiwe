import { getAccount, saveAccount, cfg } from './db.js';
const redirect = (p) => `${cfg('BASE_URL')}/oauth/${p}/callback`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function j(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error(`${res.status} ${url.split('?')[0]}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  return body;
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`video indirilemedi: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/* ---------------- Instagram (Business/Creator, Instagram Login) ---------------- */
const IG = 'https://graph.instagram.com/v21.0';
const instagram = {
  keys: ['INSTAGRAM_APP_ID','INSTAGRAM_APP_SECRET'],
  steps: ["developers.facebook.com → My Apps → Create App → \"Other\" → \"Business\" türünü seç.","Ürün ekle: Instagram → \"API setup with Instagram login\".","\"Business login settings\" → OAuth redirect URIs alanına aşağıdaki adresi yapıştır.","App roles → Roles → Instagram Testers: kendi hesabını ekle, sonra Instagram'da Ayarlar → Uygulamalar ve web siteleri → Tester davetleri'nden kabul et.","Instagram app ID ve secret'ı (Instagram → API setup sayfasında) aşağıya yapıştır. Hesabın Business veya Creator olmalı."],
  label: 'Instagram',
  configured: () => !!(cfg('INSTAGRAM_APP_ID') && cfg('INSTAGRAM_APP_SECRET')),
  authUrl: (state) =>
    'https://www.instagram.com/oauth/authorize?' +
    new URLSearchParams({
      client_id: cfg('INSTAGRAM_APP_ID'),
      redirect_uri: redirect('instagram'),
      response_type: 'code',
      scope: 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights',
      state,
    }),
  async exchange(code) {
    const short = await j('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: cfg('INSTAGRAM_APP_ID'),
        client_secret: cfg('INSTAGRAM_APP_SECRET'),
        grant_type: 'authorization_code',
        redirect_uri: redirect('instagram'),
        code: code.replace(/#_$/, ''),
      }),
    });
    const long = await j(
      'https://graph.instagram.com/access_token?' +
        new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: cfg('INSTAGRAM_APP_SECRET'), access_token: short.access_token }),
    );
    const me = await j(`${IG}/me?fields=user_id,username&access_token=${long.access_token}`);
    return {
      access_token: long.access_token,
      expires_at: Date.now() + long.expires_in * 1000,
      user_id: me.user_id || String(short.user_id),
      handle: me.username,
    };
  },
  async refresh(acc) {
    const r = await j(
      'https://graph.instagram.com/refresh_access_token?' +
        new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: acc.access_token }),
    );
    return { ...acc, access_token: r.access_token, expires_at: Date.now() + r.expires_in * 1000 };
  },
  refreshDue: (acc) => acc.expires_at - Date.now() < 10 * 864e5,
  async publish(acc, post) {
    const token = acc.access_token;
    const c = await j(`${IG}/${acc.user_id}/media`, {
      method: 'POST',
      body: new URLSearchParams({ media_type: 'REELS', video_url: post.video_url, caption: post.caption, access_token: token }),
    });
    for (let i = 0; i < 60; i++) {
      const s = await j(`${IG}/${c.id}?fields=status_code&access_token=${token}`);
      if (s.status_code === 'FINISHED') break;
      if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error('Instagram videoyu işleyemedi: ' + s.status_code);
      await sleep(5000);
    }
    const p = await j(`${IG}/${acc.user_id}/media_publish`, {
      method: 'POST',
      body: new URLSearchParams({ creation_id: c.id, access_token: token }),
    });
    return p.id;
  },
};

/* ---------------- YouTube ---------------- */
const youtube = {
  keys: ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET'],
  steps: ["console.cloud.google.com → yeni proje aç → APIs & Services → \"YouTube Data API v3\" etkinleştir.","OAuth consent screen → External → Test users'a kendi Gmail adresini ekle.","Credentials → Create credentials → OAuth client ID → Web application → Authorized redirect URI'ye aşağıdaki adresi yapıştır.","Client ID ve secret'ı aşağıya yapıştır.","Not: Google denetimi geçene kadar videolar özel yüklenir, YouTube Studio'dan tek tıkla herkese açık yapabilirsin."],
  label: 'YouTube',
  configured: () => !!(cfg('GOOGLE_CLIENT_ID') && cfg('GOOGLE_CLIENT_SECRET')),
  authUrl: (state) =>
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: cfg('GOOGLE_CLIENT_ID'),
      redirect_uri: redirect('youtube'),
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/youtube',
      access_type: 'offline',
      prompt: 'consent',
      state,
    }),
  async exchange(code) {
    const t = await j('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({
        code,
        client_id: cfg('GOOGLE_CLIENT_ID'),
        client_secret: cfg('GOOGLE_CLIENT_SECRET'),
        redirect_uri: redirect('youtube'),
        grant_type: 'authorization_code',
      }),
    });
    let handle = 'YouTube';
    try {
      const ch = await j('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
        headers: { Authorization: `Bearer ${t.access_token}` },
      });
      handle = ch.items?.[0]?.snippet?.title || handle;
    } catch {}
    return { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + t.expires_in * 1000, handle };
  },
  async refresh(acc) {
    const t = await j('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: cfg('GOOGLE_CLIENT_ID'),
        client_secret: cfg('GOOGLE_CLIENT_SECRET'),
        refresh_token: acc.refresh_token,
        grant_type: 'refresh_token',
      }),
    });
    return { ...acc, access_token: t.access_token, expires_at: Date.now() + t.expires_in * 1000 };
  },
  refreshDue: (acc) => acc.expires_at - Date.now() < 5 * 60e3,
  async publish(acc, post) {
    const video = await download(post.video_url);
    const meta = {
      snippet: { title: (post.title || post.caption.split('\n')[0] || 'Video').replace(/[<>]/g, '').slice(0, 100), description: post.caption, categoryId: '22' },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
    };
    const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${acc.access_token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'video/mp4',
        'X-Upload-Content-Length': String(video.length),
      },
      body: JSON.stringify(meta),
    });
    if (!init.ok) throw new Error(`YouTube başlatma ${init.status}: ${await init.text()}`);
    const up = await j(init.headers.get('location'), {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(video.length) },
      body: video,
    });
    return up.id;
  },
  async remove(acc, id) {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${acc.access_token}` },
    });
    if (!res.ok && res.status !== 404) throw new Error(`YouTube silme ${res.status}: ${(await res.text()).slice(0, 200)}`);
  },
};

/* ---------------- TikTok ---------------- */
const TT = 'https://open.tiktokapis.com/v2';
const tiktok = {
  keys: ['TIKTOK_CLIENT_KEY','TIKTOK_CLIENT_SECRET'],
  steps: ["developers.tiktok.com → Manage apps → Connect an app. Products: Login Kit, Content Posting API ve Display API ekle.","Login Kit → Redirect URI'ye aşağıdaki adresi yapıştır. Scopes: user.info.basic, user.info.stats, video.list, video.upload, video.publish.","Sandbox'ta kendi TikTok hesabını Target Users olarak ekle.","Client key ve secret'ı aşağıya yapıştır. Video TikTok taslaklarına düşer, uygulamadan tek dokunuşla yayınlarsın."],
  label: 'TikTok',
  configured: () => !!(cfg('TIKTOK_CLIENT_KEY') && cfg('TIKTOK_CLIENT_SECRET')),
  authUrl: (state) =>
    'https://www.tiktok.com/v2/auth/authorize/?' +
    new URLSearchParams({
      client_key: cfg('TIKTOK_CLIENT_KEY'),
      scope: cfg('TIKTOK_SCOPES') || 'user.info.basic,user.info.stats,video.list,video.upload,video.publish',
      response_type: 'code',
      redirect_uri: redirect('tiktok'),
      state,
    }),
  async exchange(code) {
    const t = await j(`${TT}/oauth/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: cfg('TIKTOK_CLIENT_KEY'),
        client_secret: cfg('TIKTOK_CLIENT_SECRET'),
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirect('tiktok'),
      }),
    });
    let handle = 'TikTok';
    try {
      const u = await j(`${TT}/user/info/?fields=display_name`, { headers: { Authorization: `Bearer ${t.access_token}` } });
      handle = u.data?.user?.display_name || handle;
    } catch {}
    return {
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: Date.now() + t.expires_in * 1000,
      refresh_expires_at: Date.now() + t.refresh_expires_in * 1000,
      handle,
    };
  },
  async refresh(acc) {
    const t = await j(`${TT}/oauth/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: cfg('TIKTOK_CLIENT_KEY'),
        client_secret: cfg('TIKTOK_CLIENT_SECRET'),
        grant_type: 'refresh_token',
        refresh_token: acc.refresh_token,
      }),
    });
    return {
      ...acc,
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: Date.now() + t.expires_in * 1000,
      refresh_expires_at: Date.now() + t.refresh_expires_in * 1000,
    };
  },
  refreshDue: (acc) => acc.expires_at - Date.now() < 30 * 60e3,
  async publish(acc, post) {
    const video = await download(post.video_url);
    if (video.length > 64 * 1024 * 1024) throw new Error('TikTok için video 64MB üstü, küçült');
    const headers = { Authorization: `Bearer ${acc.access_token}`, 'Content-Type': 'application/json; charset=UTF-8' };
    // inbox: video TikTok taslaklarına düşer, uygulamadan tek dokunuşla yayınlarsın (denetim gerekmez)
    const inbox = cfg('TIKTOK_MODE') === 'inbox';
    const init = await j(`${TT}/post/publish/${inbox ? 'inbox/video' : 'video'}/init/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...(inbox ? {} : { post_info: { title: post.caption.slice(0, 2200), privacy_level: cfg('TIKTOK_PRIVACY') || 'SELF_ONLY' } }),
        source_info: { source: 'FILE_UPLOAD', video_size: video.length, chunk_size: video.length, total_chunk_count: 1 },
      }),
    });
    if (init.error?.code && init.error.code !== 'ok') throw new Error('TikTok: ' + JSON.stringify(init.error));
    const { upload_url, publish_id } = init.data;
    const put = await fetch(upload_url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(video.length),
        'Content-Range': `bytes 0-${video.length - 1}/${video.length}`,
      },
      body: video,
    });
    if (!put.ok) throw new Error(`TikTok yükleme ${put.status}: ${await put.text()}`);
    for (let i = 0; i < 60; i++) {
      const s = await j(`${TT}/post/publish/status/fetch/`, { method: 'POST', headers, body: JSON.stringify({ publish_id }) });
      const st = s.data?.status;
      if (st === 'PUBLISH_COMPLETE' || (inbox && st === 'SEND_TO_USER_INBOX')) return publish_id;
      if (st === 'FAILED') throw new Error('TikTok başarısız: ' + (s.data?.fail_reason || 'bilinmiyor'));
      await sleep(5000);
    }
    throw new Error('TikTok zaman aşımı');
  },
};

export const providers = { instagram, youtube, tiktok };

export async function freshAccount(ws, platform) {
  let acc = await getAccount(ws, platform);
  if (!acc) throw new Error(`${providers[platform].label} bağlı değil`);
  if (providers[platform].refreshDue(acc)) {
    acc = await providers[platform].refresh(acc);
    await saveAccount(ws, platform, acc);
  }
  return acc;
}
