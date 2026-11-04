// Binance public data archive (data.binance.vision). No API key. CDN first, S3 mirror as automatic fallback.
// Zips are read in memory (single-file zips: central directory + zlib), cached on disk unless ARSIV_YAZMA=0.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ARSIV_DIR = process.env.ARSIV_DIR || path.join(HERE, 'arsiv');
const WRITE = process.env.ARSIV_YAZMA !== '0';
const HOSTS = [
  'https://data.binance.vision/',
  'https://s3-ap-northeast-1.amazonaws.com/data.binance.vision/',
];
export const stats = { fetched: 0, cached: 0, notFound: 0, errors: [] };

/* ---- limit concurrent downloads ---- */
let active = 0; const waiters = [];
const MAXC = Number(process.env.ARSIV_PARALEL || 12);
async function slot() { if (active >= MAXC) await new Promise((r) => waiters.push(r)); active++; }
const release = () => { active--; waiters.shift()?.(); };

let preferred = 0;   // index of the host that worked last
const hostFails = HOSTS.map(() => 0);      // consecutive connection failures; a host with 5 is skipped
async function download(rel) {
  let lastErr = null, notFound = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (let h = 0; h < HOSTS.length; h++) {
      const idx = (preferred + h) % HOSTS.length;
      if (hostFails[idx] >= 5 && HOSTS.some((_, j) => hostFails[j] < 5)) continue;
      try {
        const r = await fetch(HOSTS[idx] + rel, { signal: AbortSignal.timeout(60_000) });
        hostFails[idx] = 0;
        if (r.status === 404 || r.status === 403) { notFound = true; continue; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        preferred = idx;
        return Buffer.from(await r.arrayBuffer());
      } catch (e) { hostFails[idx]++; lastErr = e; }
    }
    // A reachable host said "no such file": that is an answer, not an error.
    if (notFound) return null;
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  throw new Error(`${rel}: ${lastErr?.message || 'failed'}`);
}

/* Minimal zip reader: first entry via the central directory. */
export function unzipFirst(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not a zip');
  const cd = buf.readUInt32LE(e + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error('bad central directory');
  const method = buf.readUInt16LE(cd + 10);
  const csize = buf.readUInt32LE(cd + 20);
  const lho = buf.readUInt32LE(cd + 42);
  const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
  const data = buf.subarray(start, start + csize);
  return method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data);
}

/* Returns the CSV text, or null if the archive has no such file. Throws on real errors. */
export async function csvText(rel) {
  const local = path.join(ARSIV_DIR, rel);
  if (fs.existsSync(local)) {
    stats.cached++;
    const b = fs.readFileSync(local);
    return b.length === 0 ? null : unzipFirst(b).toString('utf8');
  }
  await slot();
  try {
    const buf = await download(rel);
    if (!buf) {
      stats.notFound++;
      if (WRITE) { fs.mkdirSync(path.dirname(local), { recursive: true }); fs.writeFileSync(local, Buffer.alloc(0)); }
      return null;
    }
    stats.fetched++;
    if (WRITE) { fs.mkdirSync(path.dirname(local), { recursive: true }); fs.writeFileSync(local, buf); }
    return unzipFirst(buf).toString('utf8');
  } catch (e) {
    if (stats.errors.length < 50) stats.errors.push(e.message);
    stats.errorCount = (stats.errorCount || 0) + 1;
    throw e;
  } finally { release(); }
}

const tsMs = (v) => { const n = Number(v); return n > 1e14 ? Math.floor(n / 1000) : n; };

export function parseKlines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line || line.charCodeAt(0) < 48 || line.charCodeAt(0) > 57) continue;     // header / blank
    const c = line.split(',');
    out.push({ t: tsMs(c[0]), o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[5], q: +c[7], tb: +c[9] });
  }
  return out;
}
export function parseMetrics(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line || line.charCodeAt(0) < 48 || line.charCodeAt(0) > 57) continue;
    const c = line.split(',');
    const t = Date.parse(c[0].replace(' ', 'T') + 'Z');
    const v = +c[2];
    if (Number.isFinite(t) && Number.isFinite(v)) out.push({ t, v, u: +c[3] });
  }
  return out;
}
export function parseFunding(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line || line.charCodeAt(0) < 48 || line.charCodeAt(0) > 57) continue;
    const c = line.split(',');
    out.push({ t: tsMs(c[0]), r: +c[2] });
  }
  return out;
}

/* ---- path helpers ---- */
const P = 'data/futures/um/';
export const monthKey = (t) => new Date(t).toISOString().slice(0, 7);
export const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
export const klinesMonthly = (s, tf, ym) => `${P}monthly/klines/${s}/${tf}/${s}-${tf}-${ym}.zip`;
export const klinesDaily = (s, tf, d) => `${P}daily/klines/${s}/${tf}/${s}-${tf}-${d}.zip`;
export const metricsDaily = (s, d) => `${P}daily/metrics/${s}/${s}-metrics-${d}.zip`;
export const fundingMonthly = (s, ym) => `${P}monthly/fundingRate/${s}/${s}-fundingRate-${ym}.zip`;

/* All candles of one symbol for [fromMs, toMs): monthly files, daily files for months with no monthly yet. */
export async function loadKlines(sym, tf, fromMs, toMs) {
  const rows = [];
  const missing = [];
  const first = new Date(fromMs); first.setUTCDate(1); first.setUTCHours(0, 0, 0, 0);
  for (let m = new Date(first); m.getTime() < toMs; m.setUTCMonth(m.getUTCMonth() + 1)) {
    const ym = m.toISOString().slice(0, 7);
    const txt = await csvText(klinesMonthly(sym, tf, ym));
    if (txt) { rows.push(...parseKlines(txt)); continue; }
    // No monthly file. Daily files only exist for months that are not published as a monthly yet
    // (the current month and, for a few days, the previous one). An old month without a file means the
    // contract did not exist or was already delisted, so asking for 30 daily files would be wasted work.
    const monthEnd = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1)).getTime();
    if (monthEnd < Date.now() - 12 * 864e5) continue;
    const mEnd = Math.min(toMs, new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1)).getTime());
    let got = 0;
    for (let d = m.getTime(); d < mEnd && d < Date.now() - 864e5; d += 864e5) {
      const t2 = await csvText(klinesDaily(sym, tf, dayKey(d)));
      if (t2) { rows.push(...parseKlines(t2)); got++; }
    }
    if (!got) missing.push(ym);
  }
  rows.sort((a, b) => a.t - b.t);
  const dedup = rows.filter((r, i) => i === 0 || r.t !== rows[i - 1].t);
  return { k: dedup.filter((r) => r.t >= fromMs && r.t < toMs), missing };
}

export async function loadFunding(sym, fromMs, toMs) {
  const out = [];
  const first = new Date(fromMs); first.setUTCDate(1); first.setUTCHours(0, 0, 0, 0);
  for (let m = new Date(first); m.getTime() < toMs; m.setUTCMonth(m.getUTCMonth() + 1)) {
    const txt = await csvText(fundingMonthly(sym, m.toISOString().slice(0, 7)));
    if (txt) out.push(...parseFunding(txt));
  }
  return out.sort((a, b) => a.t - b.t);
}

/* Lazy open-interest lookup: latest 5 minute point at or before ts. Loads one archive day at a time. */
export function makeOiAt(sym) {
  const days = new Map();      // 'YYYY-MM-DD' -> sorted array | null
  let failed = 0;
  const day = async (d) => {
    if (days.has(d)) return days.get(d);
    let arr = null;
    try { const t = await csvText(metricsDaily(sym, d)); arr = t ? parseMetrics(t) : null; } catch { failed++; }
    days.set(d, arr);
    return arr;
  };
  const at = async (ts) => {
    for (let back = 0; back < 2; back++) {          // today's file, else the previous day's last point
      const arr = await day(dayKey(ts - back * 864e5));
      if (!arr || !arr.length) continue;
      let lo = 0, hi = arr.length - 1, best = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid].t <= ts) { best = mid; lo = mid + 1; } else hi = mid - 1; }
      if (best >= 0) return arr[best];
    }
    return null;
  };
  at.failed = () => failed;
  at.drop = (before) => { for (const d of days.keys()) if (d < before) days.delete(d); };
  return at;
}

/* Every USDT-M perpetual that ever had klines in the archive (delisted ones too). */
export async function listSymbols() {
  const cache = path.join(ARSIV_DIR, 'symbols.json');
  if (fs.existsSync(cache) && Date.now() - fs.statSync(cache).mtimeMs < 12 * 3600e3) return JSON.parse(fs.readFileSync(cache, 'utf8'));
  const base = 'https://s3-ap-northeast-1.amazonaws.com/data.binance.vision/';
  const out = [];
  let marker = '';
  for (;;) {
    const r = await fetch(`${base}?delimiter=/&prefix=${P}monthly/klines/&marker=${encodeURIComponent(marker)}`, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error('symbol listing HTTP ' + r.status);
    const x = await r.text();
    for (const m of x.matchAll(/<Prefix>data\/futures\/um\/monthly\/klines\/([^/]+)\/<\/Prefix>/g)) out.push(m[1]);
    const nm = x.match(/<NextMarker>([^<]+)<\/NextMarker>/);
    if (!/<IsTruncated>true/.test(x) || !nm) break;
    marker = nm[1];
  }
  const syms = [...new Set(out)].filter((s) => /USDT$/.test(s) && !s.includes('_')).sort();
  fs.mkdirSync(ARSIV_DIR, { recursive: true });
  fs.writeFileSync(cache, JSON.stringify(syms));
  return syms;
}
