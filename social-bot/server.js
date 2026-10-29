import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { pool, init, saveAccount, getAccount } from './db.js';
import { providers } from './providers.js';
import { startScheduler } from './scheduler.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(here, 'data');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!PASSWORD) throw new Error('ADMIN_PASSWORD ayarlanmalı');

const app = express();
const states = new Map();

// Videolar ve OAuth dönüşleri açık; geri kalan her şey şifreli.
app.use('/media', express.static(MEDIA_DIR));
const auth = (req, res, next) => {
  const [, b64] = (req.headers.authorization || '').split(' ');
  const [, pass = ''] = Buffer.from(b64 || '', 'base64').toString().split(/:(.*)/s);
  const a = Buffer.from(pass), b = Buffer.from(PASSWORD);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  res.set('WWW-Authenticate', 'Basic realm="social-bot"').status(401).send('Giriş gerekli');
};

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
app.use(express.json());
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
    accounts[k] = { label: p.label, configured: p.configured(), connected: !!acc, handle: acc?.handle ?? null };
  }
  const { rows } = await pool.query('select * from posts order by scheduled_at desc limit 50');
  res.json({ accounts, posts: rows });
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

await init();
startScheduler();
app.listen(process.env.PORT || 3000, () => console.log('social-bot hazır'));
