import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { pool, init, saveAccount, getAccount, loadSettings, setSetting, cfg } from './db.js';
import { providers } from './providers.js';
import { startScheduler } from './scheduler.js';
import { analyzeVideo } from './ai.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(here, 'data');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!PASSWORD) throw new Error('ADMIN_PASSWORD ayarlanmalı');

const app = express();
const states = new Map();

// Açık: videolar, OAuth dönüşü, giriş, gizlilik/şartlar. Geri kalan her şey oturum ister.
app.use('/media', express.static(MEDIA_DIR));
app.use(express.json());

const sign = (v) => crypto.createHmac('sha256', PASSWORD).update(v).digest('hex');
const cookieOf = (req, name) => (req.headers.cookie || '').split(/;\s*/).map((c) => c.split(/=(.*)/s)).find(([k]) => k === name)?.[1];
const valid = (req) => {
  const [exp, mac] = (cookieOf(req, 'sb') || '').split('.');
  return !!mac && Number(exp) > Date.now() && mac.length === sign(exp).length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(sign(exp)));
};
const auth = (req, res, next) => {
  if (valid(req)) return next();
  if (req.method === 'GET' && req.accepts('html') && !req.path.startsWith('/api')) return res.redirect('/login');
  res.status(401).json({ error: 'giriş gerekli' });
};
const page = (f) => (_req, res) => res.sendFile(path.join(here, 'public', f));
app.get('/login', page('login.html'));
app.get('/privacy', page('privacy.html'));
app.get('/terms', page('terms.html'));
app.post('/login', async (req, res) => {
  const a = Buffer.from(String(req.body?.password ?? '')), b = Buffer.from(PASSWORD);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
    const exp = String(Date.now() + 30 * 864e5);
    res.setHeader('Set-Cookie', `sb=${exp}.${sign(exp)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${30 * 86400}`);
    return res.json({ ok: true });
  }
  await new Promise((r) => setTimeout(r, 1000));
  res.status(401).json({ error: 'Şifre yanlış' });
});
app.post('/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'sb=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/oauth/:p/callback', async (req, res) => {
  const p = providers[req.params.p];
  if (!p) return res.status(404).end();
  const { code, state, error } = req.query;
  if (error) return res.status(400).send('İzin reddedildi: ' + error);
  if (!state || !states.delete(`${req.params.p}:${state}`)) return res.status(400).send('Geçersiz state, bağlantıyı panelden yeniden başlat');
  try {
    await saveAccount(req.params.p, await p.exchange(code));
    res.redirect('/');
  } catch (e) {
    res.status(500).send('Bağlanamadı: ' + e.message);
  }
});

app.use(auth);
app.use(express.static(path.join(here, 'public')));

app.get('/connect/:p', (req, res) => {
  const p = providers[req.params.p];
  if (!p?.configured()) return res.status(400).send('Bu platformun anahtarları Railway Variables içinde yok');
  const state = crypto.randomBytes(16).toString('hex');
  states.set(`${req.params.p}:${state}`, Date.now());
  res.redirect(p.authUrl(state));
});

app.get('/api/state', async (_req, res) => {
  const accounts = {};
  for (const [k, p] of Object.entries(providers)) {
    const acc = await getAccount(k);
    accounts[k] = { label: p.label, configured: p.configured(), connected: !!acc, handle: acc?.handle ?? null, keys: p.keys, steps: p.steps, redirect: `${BASE_URL}/oauth/${k}/callback`, have: Object.fromEntries(p.keys.map((x) => [x, !!cfg(x)])) };
  }
  const { rows } = await pool.query('select * from posts order by scheduled_at desc limit 50');
  const ai = {
    label: 'Yapay zeka',
    configured: !!cfg('GEMINI_API_KEY'),
    keys: ['GEMINI_API_KEY'],
    redirect: '',
    have: { GEMINI_API_KEY: !!cfg('GEMINI_API_KEY') },
    steps: [
      'aistudio.google.com/apikey adresine git ve Google hesabınla gir.',
      '"Create API key" de ve çıkan anahtarı aşağıya yapıştır.',
      'Ücretsiz bir katmanı var (limitleri Google belirler). Video buraya yüklenir, yazı oluşturulunca silinir.',
    ],
  };
  res.json({ accounts, ai, posts: rows });
});

app.post('/api/settings', async (req, res) => {
  const allowed = new Set([...Object.values(providers).flatMap((p) => p.keys), 'GEMINI_API_KEY']);
  for (const [k, v] of Object.entries(req.body?.values ?? {})) {
    if (allowed.has(k) && typeof v === 'string' && v.trim()) await setSetting(k, v.trim());
  }
  res.json({ ok: true });
});

app.post('/api/analyze', async (req, res) => {
  try {
    const url = String(req.body?.video_url ?? '');
    let buf;
    const local = url.startsWith(`${BASE_URL}/media/`) && path.join(MEDIA_DIR, path.basename(url));
    if (local && fs.existsSync(local)) buf = fs.readFileSync(local);
    else {
      const r = await fetch(url);
      if (!r.ok) throw new Error('video indirilemedi: ' + r.status);
      buf = Buffer.from(await r.arrayBuffer());
    }
    if (buf.length > 150 * 1024 * 1024) throw new Error('Video 150MB üstü, analiz için küçült');
    res.json(await analyzeVideo(buf));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/upload', async (req, res) => {
  const id = crypto.randomBytes(12).toString('hex') + '.mp4';
  try {
    await pipeline(req, fs.createWriteStream(path.join(MEDIA_DIR, id)));
    res.json({ url: `${BASE_URL}/media/${id}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/posts', async (req, res) => {
  const { video_url, caption = '', title = '', platforms, scheduled_at } = req.body;
  const list = (platforms || []).filter((p) => providers[p]);
  if (!video_url || !list.length) return res.status(400).json({ error: 'video ve en az bir platform gerekli' });
  const when = scheduled_at ? new Date(scheduled_at) : new Date();
  if (isNaN(when)) return res.status(400).json({ error: 'tarih geçersiz' });
  const { rows } = await pool.query(
    'insert into posts(caption,title,video_url,platforms,scheduled_at) values($1,$2,$3,$4,$5) returning *',
    [caption, title, video_url, list, when],
  );
  res.json(rows[0]);
});

app.delete('/api/posts/:id', async (req, res) => {
  await pool.query(`delete from posts where id=$1 and status in ('scheduled','failed')`, [req.params.id]);
  res.json({ ok: true });
});

// 30 günden eski medyayı sil; zamanlanmış/çalışan bir paylaşımın videosuna dokunma.
async function cleanMedia() {
  const { rows } = await pool.query(`select video_url from posts where status in ('scheduled','running')`);
  const keep = new Set(rows.map((r) => r.video_url.split('/media/')[1]));
  const limit = Date.now() - 30 * 864e5;
  for (const f of fs.readdirSync(MEDIA_DIR)) {
    const file = path.join(MEDIA_DIR, f);
    if (!keep.has(f) && fs.statSync(file).mtimeMs < limit) fs.unlinkSync(file);
  }
}

await init();
await loadSettings();
startScheduler();
cleanMedia().catch((e) => console.error('cleanMedia:', e.message));
setInterval(() => cleanMedia().catch((e) => console.error('cleanMedia:', e.message)), 864e5);
app.listen(process.env.PORT || 3000, () => console.log('social-bot hazır'));
