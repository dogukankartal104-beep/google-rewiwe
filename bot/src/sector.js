// CoinGecko sektör davranışı: coin tek mi hareket ediyor, sektör toplu mu?
// Rate limit düşük olduğu için agresif cache'lenir ve SADECE sinyal adayları için
// çağrılır. Hata durumunda null döner, karar motoru bunu "bilinmiyor" sayar.
import { api, CG } from './binance.js';
import { warn } from './util.js';
import { ENV } from './config.js';

const CACHE = new Map();      // base -> { v, t }
const TTL = 6 * 3600e3;       // 6 saat
let CATMAP = null;
let catMapTried = 0;
let lastCall = 0;
const MIN_GAP = 2500;         // CoinGecko free tier'ı yakmamak için

async function throttled(fn) {
  const gap = MIN_GAP - (Date.now() - lastCall);
  if (gap > 0) await new Promise((r) => setTimeout(r, gap));
  lastCall = Date.now();
  return fn();
}

export async function sectorOf(symbol) {
  if (!ENV.sectorCheck) return null;
  const base = symbol.replace('USDT', '');
  const hit = CACHE.get(base);
  if (hit && Date.now() - hit.t < TTL) return hit.v;

  let val = null;
  try {
    if (!CATMAP && Date.now() - catMapTried > 3600e3) {
      catMapTried = Date.now();
      const cl = await throttled(() => api('/coins/categories/list', {}, CG, 1));
      CATMAP = {};
      cl.forEach((c) => { CATMAP[c.name.toLowerCase()] = c.category_id; });
    }
    if (CATMAP) {
      const sr = await throttled(() => api('/search', { query: base }, CG, 1));
      const coin = (sr.coins || []).find((c) => c.symbol.toUpperCase() === base) || (sr.coins || [])[0];
      if (coin) {
        const c = await throttled(() => api('/coins/' + coin.id, {
          localization: false, tickers: false, market_data: false,
          community_data: false, developer_data: false, sparkline: false,
        }, CG, 1));
        const cats = (c.categories || []).filter(Boolean);
        let pick = null;
        for (const nm of cats) {
          const id = CATMAP[nm.toLowerCase()];
          if (id) { pick = { nm, id }; break; }
        }
        if (pick) {
          const mk = await throttled(() => api('/coins/markets', {
            vs_currency: 'usd', category: pick.id, per_page: 50, page: 1,
          }, CG, 1));
          const ch = mk.map((x) => x.price_change_percentage_24h)
            .filter((x) => x !== null && x !== undefined)
            .sort((a, b) => a - b);
          if (ch.length) {
            const med = ch[Math.floor(ch.length / 2)];
            const up = ch.filter((x) => x >= 8).length;
            val = { cat: pick.nm, n: ch.length, med, up, hot: med >= 6 || up / ch.length >= 0.3 };
          }
        }
      }
    }
  } catch (e) {
    warn('sektor (' + base + '):', e.message);
    val = null;
  }
  CACHE.set(base, { v: val, t: Date.now() });
  return val;
}
