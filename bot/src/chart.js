// Images for the channels: TradingView-style candle charts for signals and profit showcases, and news cards.
// SVG is drawn here and rasterised with resvg (no browser, no system fonts: DejaVu Sans is bundled in assets/fonts).
// Every public helper returns null on failure so the caller can fall back to a plain text post.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { warn } from './util.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONTS = ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf'].map((f) => path.join(HERE, '..', 'assets', 'fonts', f));
const C = { bg: '#131722', panel: '#1b2030', grid: '#2a2e39', text: '#d1d4dc', dim: '#787b86', up: '#26a69a', dn: '#ef5350', gold: '#f5c542', cyan: '#2dd4bf', blue: '#4c8dff' };
const FONT = 'DejaVu Sans';

export const xml = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* Greedy word wrap by character count; the last line is cut with an ellipsis when the text does not fit. */
export function wrap(text, maxChars, maxLines) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ');
  const lines = []; let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length <= maxChars) cur = (cur + ' ' + w).trim();
    else { if (cur) lines.push(cur); cur = w.length > maxChars ? w.slice(0, maxChars - 1) + '…' : w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { const cut = lines.slice(0, maxLines); cut[maxLines - 1] = cut[maxLines - 1].replace(/\s?\S*$/, '').slice(0, maxChars - 1) + '…'; return cut; }
  return lines;
}

export const priceText = (v) => (!Number.isFinite(v) ? '—' : Math.abs(v) >= 1000 ? v.toFixed(1) : Math.abs(v) >= 100 ? v.toFixed(2) : Math.abs(v) >= 1 ? v.toFixed(4) : Math.abs(v) >= 0.01 ? v.toFixed(5) : v.toFixed(7));

/* candles: [{t,o,h,l,c}], lines: [{price,label,color,dash}], badge: {big, small, color}. Returns an SVG string. */
export function candleChartSvg({ symbol, tf = '15m', candles, lines = [], badge = null, tag = '', foot = 'Not financial advice.' }) {
  const W = 1280, H = 720, L = 36, R = 1160, T = 120, B = 640;
  const cs = candles.slice(-80);
  const prices = [...cs.flatMap((c) => [c.h, c.l]), ...lines.map((l) => l.price).filter(Number.isFinite)];
  let lo = Math.min(...prices), hi = Math.max(...prices);
  const pad = (hi - lo) * 0.08 || hi * 0.01; lo -= pad; hi += pad;
  const y = (p) => T + (hi - p) / (hi - lo) * (B - T);
  const bw = (R - L) / cs.length, body = Math.max(2, bw * 0.62);
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`);
  o.push(`<rect width="${W}" height="${H}" fill="${C.bg}"/>`);
  // header
  o.push(`<text x="${L}" y="62" font-size="38" font-weight="bold" fill="${C.text}">${xml(symbol)} <tspan fill="${C.dim}" font-size="26" font-weight="normal">· ${xml(tf)} · Binance Futures</tspan></text>`);
  if (tag) o.push(`<rect x="${W - 36 - 24 * tag.length - 28}" y="30" rx="8" ry="8" width="${24 * tag.length + 28}" height="44" fill="${C.panel}" stroke="${C.grid}"/><text x="${W - 36 - 14 - (24 * tag.length) / 2 - 0}" y="61" font-size="24" font-weight="bold" fill="${C.cyan}" text-anchor="middle">${xml(tag)}</text>`);
  // grid + axis
  for (let i = 0; i <= 5; i++) {
    const gy = T + (B - T) * i / 5, gp = hi - (hi - lo) * i / 5;
    o.push(`<line x1="${L}" y1="${gy}" x2="${R}" y2="${gy}" stroke="${C.grid}" stroke-width="1"/><text x="${R + 10}" y="${gy + 5}" font-size="17" fill="${C.dim}">${xml(priceText(gp))}</text>`);
  }
  // candles
  cs.forEach((c, i) => {
    const x = L + (i + 0.5) * bw, up = c.c >= c.o, col = up ? C.up : C.dn;
    const yo = y(c.o), yc = y(c.c);
    o.push(`<line x1="${x}" y1="${y(c.h)}" x2="${x}" y2="${y(c.l)}" stroke="${col}" stroke-width="2"/><rect x="${x - body / 2}" y="${Math.min(yo, yc)}" width="${body}" height="${Math.max(2, Math.abs(yc - yo))}" fill="${col}"/>`);
  });
  // levels
  for (const ln of lines) {
    if (!Number.isFinite(ln.price)) continue;
    const ly = y(ln.price), col = ln.color || C.gold, txt = `${ln.label} ${priceText(ln.price)}`, w = Math.max(190, txt.length * 12.5 + 22);
    o.push(`<line x1="${L}" y1="${ly}" x2="${R}" y2="${ly}" stroke="${col}" stroke-width="2" ${ln.dash === false ? '' : 'stroke-dasharray="10 7"'}/>`);
    o.push(`<rect x="${R - w + 100}" y="${ly - 15}" rx="6" ry="6" width="${w}" height="30" fill="${col}"/><text x="${R - w + 100 + w / 2}" y="${ly + 6}" font-size="17" font-weight="bold" fill="#0b0f14" text-anchor="middle">${xml(txt)}</text>`);
  }
  // profit / info badge
  if (badge) {
    o.push(`<rect x="${L + 20}" y="${T + 16}" rx="14" ry="14" width="330" height="120" fill="${C.panel}" fill-opacity="0.92" stroke="${badge.color || C.up}" stroke-width="2"/>`);
    o.push(`<text x="${L + 44}" y="${T + 84}" font-size="62" font-weight="bold" fill="${badge.color || C.up}">${xml(badge.big)}</text><text x="${L + 46}" y="${T + 118}" font-size="22" fill="${C.text}">${xml(badge.small || '')}</text>`);
  }
  // footer
  o.push(`<text x="${L}" y="${H - 38}" font-size="22" font-weight="bold" fill="${C.cyan}">Crypto Pump Radar</text><text x="${L}" y="${H - 12}" font-size="15" fill="${C.dim}">${xml(foot)}</text>`);
  o.push('</svg>');
  return o.join('');
}

const TAG_COLOR = { SECURITY: '#ef5350', INSOLVENCY: '#ef5350', LIQUIDATION: '#ff9800', REGULATION: '#ab47bc', ETF: '#4c8dff', MACRO: '#f5c542', EXCHANGE: '#26a69a', WHALE: '#29b6f6', NETWORK: '#7e57c2', FRAUD: '#ef5350', MARKET: '#2dd4bf' };
export function newsCardSvg({ title, tag, source, when }) {
  const W = 1200, H = 630, color = TAG_COLOR[tag] || C.cyan;
  const size = title.length > 120 ? 42 : title.length > 80 ? 50 : 58;
  const lines = wrap(title, Math.floor(1080 / (size * 0.62)), 5);
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`);
  o.push(`<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b0f14"/><stop offset="1" stop-color="#17202e"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/>`);
  o.push(`<rect x="0" y="0" width="14" height="${H}" fill="${color}"/>`);
  if (tag) o.push(`<rect x="60" y="56" rx="10" ry="10" width="${tag.length * 19 + 44}" height="48" fill="${color}"/><text x="${60 + (tag.length * 19 + 44) / 2}" y="89" font-size="26" font-weight="bold" fill="#0b0f14" text-anchor="middle">${xml(tag)}</text>`);
  lines.forEach((ln, i) => o.push(`<text x="60" y="${190 + i * (size * 1.25)}" font-size="${size}" font-weight="bold" fill="#f1f3f6">${xml(ln)}</text>`));
  o.push(`<text x="60" y="${H - 96}" font-size="28" fill="${C.dim}">${xml(source)}${when ? ' · ' + xml(when) : ''}</text>`);
  o.push(`<line x1="60" y1="${H - 74}" x2="${W - 60}" y2="${H - 74}" stroke="${C.grid}" stroke-width="2"/>`);
  o.push(`<text x="60" y="${H - 32}" font-size="30" font-weight="bold" fill="${C.cyan}">Crypto Pump Radar</text><text x="${W - 60}" y="${H - 32}" font-size="22" fill="${C.dim}" text-anchor="end">crypto news · what could happen</text>`);
  o.push('</svg>');
  return o.join('');
}

let ResvgClass = null;
export async function renderPng(svg) {
  if (!ResvgClass) ResvgClass = (await import('@resvg/resvg-js')).Resvg;
  const r = new ResvgClass(svg, { font: { fontFiles: FONTS.filter((f) => fs.existsSync(f)), loadSystemFonts: false, defaultFontFamily: FONT }, fitTo: { mode: 'width', value: 1200 } });
  return Buffer.from(r.render().asPng());
}
const safe = async (fn) => { try { return await fn(); } catch (e) { warn('image skipped:', e.message); return null; } };

async function candlesFor(symbol, tf = '15m', limit = 80) {
  const { klines } = await import('./binance.js');
  return klines(symbol, tf, limit);
}
const dirOf = (d) => (d === 'L' ? 'L' : 'S');

/* VIP signal chart: entry, stop and targets over the recent candles. sig: row of the signals table. */
export const signalChartPng = (sig) => safe(async () => {
  const candles = await candlesFor(sig.symbol, sig.tf || '15m');
  const long = dirOf(sig.dir) === 'L';
  return renderPng(candleChartSvg({
    symbol: sig.symbol, tf: sig.tf || '15m', candles, tag: long ? 'LONG SIGNAL' : 'SHORT SIGNAL',
    lines: [{ price: sig.entry, label: 'ENTRY', color: C.blue }, { price: sig.stop, label: 'STOP', color: C.dn }, { price: sig.tp1, label: 'TP1', color: C.up }, { price: sig.tp2, label: 'TP2', color: C.up }],
    badge: { big: long ? 'LONG' : 'SHORT', small: `Grade ${sig.grade || '—'} · R:R ${Number(sig.rr || 0).toFixed(1)}`, color: long ? C.up : C.dn },
    foot: 'Not financial advice. Leveraged trading can lose your entire capital.',
  }));
});

/* Free showcase: a position that is in profit. now = current price, profitText e.g. "+3.4%". */
export const profitChartPng = ({ symbol, tf = '15m', dir = 'S', entry, now, stop = null, targets = [], profitText, small = 'IN PROFIT' }) => safe(async () => {
  const candles = await candlesFor(symbol, tf);
  const lines = [{ price: entry, label: 'ENTRY', color: C.blue }, { price: now, label: 'NOW', color: C.up, dash: false }];
  if (stop) lines.push({ price: stop, label: 'STOP', color: C.dn });
  targets.forEach((t, i) => lines.push({ price: t, label: `TP${i + 1}`, color: C.gold }));
  return renderPng(candleChartSvg({ symbol, tf, candles, lines, tag: dir === 'L' ? 'LONG' : 'SHORT', badge: { big: profitText, small, color: C.up }, foot: 'Selected position shown while in profit. Not financial advice.' }));
});

export const newsCardPng = (item, when) => safe(() => renderPng(newsCardSvg({ title: item.title, tag: item.tags?.[0] || '', source: item.source, when })));
