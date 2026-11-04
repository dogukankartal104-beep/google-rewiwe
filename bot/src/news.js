/* Haber motoru — RSS tabanlı, API anahtarı GEREKMEZ.
   Türkçe kaynaklar önceliklidir (çeviri uydurmamak için). İngilizce kaynaklar
   sadece yüksek puanlı "flaş" haberler için kullanılır ve başlık ORİJİNAL
   bırakılır; altına Türkçe "neden önemli" satırı eklenir.

   Çalışma mantığı:
   1. Feed'ler çekilir (her biri bağımsız; biri patlarsa diğerleri devam eder)
   2. Başlık anahtar kelimelere göre PUANLANIR
   3. Eşiği geçen haber anında yayınlanır, gerisi günlük özete girer
   4. news_log ile tekrar yayın engellenir
*/
import crypto from 'node:crypto';
import { ENV } from './config.js';
import { log, warn, trDateTime, dur } from './util.js';
import * as db from './db.js';

/* ---------------- KAYNAKLAR ----------------
   NEWS_FEEDS env'i ile tamamen değiştirilebilir (virgülle ayrılmış URL listesi).
   lang: 'tr' olanlar tercih edilir. */
const DEFAULT_FEEDS = [
  { url: 'https://kriptokoin.com/feed/', name: 'Kriptokoin', lang: 'tr' },
  { url: 'https://coin-turk.com/feed', name: 'CoinTürk', lang: 'tr' },
  { url: 'https://uzmancoin.com/feed/', name: 'Uzmancoin', lang: 'tr' },
  { url: 'https://www.bitcoinsistemi.com/feed/', name: 'Bitcoin Sistemi', lang: 'tr' },
  { url: 'https://cointelegraph.com/rss', name: 'Cointelegraph', lang: 'en' },
  { url: 'https://decrypt.co/feed', name: 'Decrypt', lang: 'en' },
];

export function feeds() {
  const raw = (process.env.NEWS_FEEDS || '').trim();
  if (!raw) return DEFAULT_FEEDS;
  return raw.split(',').map((x) => x.trim()).filter(Boolean).map((url) => {
    let host = url;
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* yoksay */ }
    return { url, name: host, lang: /\.tr\b|turk|kripto|koin|coin-turk/i.test(url) ? 'tr' : 'en' };
  });
}

/* ---------------- PUANLAMA ----------------
   Yüksek puan = dikkat çeker + piyasayı gerçekten etkiler.
   TR ve EN karşılıkları birlikte aranır. */
/* DİKKAT — Türkçe metinde \b KULLANILMAZ.
   JavaScript'te \b sınırı \w = [A-Za-z0-9_] üzerinden tanımlıdır; ç,ğ,ı,ö,ş,ü
   bu kümede olmadığı için "\bçalın" ifadesi " çalındı" içinde EŞLEŞMEZ.
   Bunun yerine Unicode harf/rakam olmayan bir sınır kullanıyoruz. */
const W = (...terms) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(${terms.join('|')})`, 'iu');

const RULES = [
  // --- kritik: ani likidite olayları ---
  { p: 50, tag: 'SECURITY',
    re: W('hack', 'hackle', 'hacked', 'exploit', 'istismar', 'saldır', 'breach',
      'ihlal', 'çalın', 'çalınd', 'stolen', 'drain', 'güvenlik açığ', 'siber'),
    why: 'Exchange and protocol security incidents trigger a sudden flight of liquidity. The book thins out, slippage jumps, and stops fire in places you did not expect.' },
  { p: 45, tag: 'INSOLVENCY',
    re: W('iflas', 'bankrupt', 'insolven', 'çöktü', 'collapse', 'battı', 'batti',
      'halted withdrawal', 'çekim durdur', 'çekimleri durdur', 'konkordato'),
    why: 'An institution failing sets off chain liquidations. In moments like this, technical structure stops meaning anything.' },
  { p: 42, tag: 'LIQUIDATION',
    // sıra bağımsız: "1.2 milyar dolarlık likidasyon" da "likidasyon 1.2 milyar" da yakalanmalı
    re: {
      test: (t) => /(?<![\p{L}\p{N}])(likidasyon|liquidation|tasfiye)/iu.test(t)
        && /(?<![\p{L}\p{N}])(milyar|billion|milyon|million|rekor|record)/iu.test(t),
    },
    why: 'A large liquidation wave shows the fuel is either running out or just igniting — directly relevant to the system’s open-interest read.' },

  // --- düzenleme ---
  { p: 38, tag: 'REGULATION',
    re: W('SEC', 'CFTC', 'yasak', 'ban ', 'dava', 'lawsuit', 'soruşturma',
      'investigat', 'regülasyon', 'regulation', 'mahkeme', 'court', 'ceza', 'SPK'),
    why: 'Regulatory news can flip direction outright and invalidate technical setups.' },
  { p: 36, tag: 'ETF', re: W('ETF'),
    why: 'ETF flows move spot demand directly — it feeds the system’s "is this spot-driven?" question.' },

  // --- makro ---
  { p: 40, tag: 'MACRO',
    re: W('FED', 'FOMC', 'faiz', 'interest rate', 'enflasyon', 'inflation',
      'CPI', 'NFP', 'istihdam', 'powell', 'tarım dışı'),
    why: 'Around macro releases volatility explodes and correlations go to 1. The system opens no new positions in that window.' },

  // --- borsa / listeleme ---
  { p: 30, tag: 'EXCHANGE',
    re: W('delist', 'listeden çıkar', 'listeleme', 'listing', 'binance',
      'coinbase', 'okx', 'bybit', 'upbit', 'kraken'),
    why: 'Listing and delisting news creates a violent, short-lived move in a single coin — a classic fade trap.' },
  { p: 24, tag: 'WHALE',
    re: {
      test: (t) => /(?<![\p{L}\p{N}])(balina|whale)/iu.test(t)
        || (/(?<![\p{L}\p{N}])(transfer|moved|taşıd)/iu.test(t)
            && /(?<![\p{L}\p{N}])(milyar|billion|milyon|million)/iu.test(t)),
    },
    why: 'Large transfers can precede selling or accumulation, and they leave a trace in the order book.' },

  // --- ağ / proje ---
  { p: 25, tag: 'NETWORK',
    re: W('halving', 'yarılanma', 'hard fork', 'upgrade', 'güncelleme',
      'mainnet', 'airdrop', 'unlock', 'kilit açıl', 'token açılım'),
    why: 'Events that change the supply side — token unlocks above all — can suppress price for days.' },
  { p: 22, tag: 'FRAUD',
    re: W('rug ?pull', 'rugpull', 'dolandırıc', 'scam', 'ponzi', 'sahte', 'kayıplara karış'),
    why: 'Fraud news means permanent loss of trust in that coin. It is not a dip to buy.' },

  // --- genel piyasa ---
  { p: 18, tag: 'MARKET',
    re: W('ATH', 'rekor', 'record high', 'çöküş', 'crash', 'ralli', 'rally',
      'sert düş', 'sert yüksel', 'plunge', 'soar', 'uçtu', 'dipten döndü'),
    why: 'Sharp moves are what create the exhaustion setups the system hunts — but all three phases must confirm first.' },
];

/* "How to trade around it" — one short, honest line per topic, shown in VIP only.
   These are general rules of thumb that match how the system behaves, not predictions. */
export const TIPS = {
  SECURITY: 'Do not trade the first spike. Wait for the book to refill. If your funds sit on the named venue, that is a withdrawal question, not a chart question.',
  INSOLVENCY: 'Contagion moves fast and reverses fast. Cut size, widen stops — correlations go to 1.',
  LIQUIDATION: 'A liquidation wave is fuel being burned. Fades work after open interest stops falling, not while it is still dropping.',
  REGULATION: 'Headline risk resolves in hours, structure in days. No fresh fades into the first 30 minutes.',
  ETF: 'Flows hit spot demand directly. Check whether the move is spot-driven before fading it.',
  MACRO: 'Spreads and slippage are at their worst inside the release window. The system opens no new positions then — do the same.',
  EXCHANGE: 'Listing pumps are the classic fade trap, but never fade the first candle. Wait for volume decay, OI bleed and a trigger.',
  WHALE: 'A transfer is not a sale. Look for the order-book footprint before acting on it.',
  NETWORK: 'Unlock dates are known in advance and mostly priced in. The risk is crowded longs into the date.',
  FRAUD: 'Skip it. Fraud coins have no floor.',
  MARKET: 'Sharp moves create the exhaustion setups we hunt — but all three phases still have to confirm.',
};

const BIG = /\b(bitcoin|btc|ethereum|eth|binance|coinbase|tether|usdt|solana|xrp)\b/i;

export function scoreItem(title, { lang = 'tr' } = {}) {
  const t = String(title || '');
  let score = 0;
  const tags = [];
  let why = null;
  for (const r of RULES) {
    if (r.re.test(t)) {
      score += r.p;
      tags.push(r.tag);
      if (!why) why = r.why;
    }
  }
  if (score && BIG.test(t)) score += 10;      // büyük isim geçiyorsa daha çok ilgi görür
  if (lang === 'en') score -= 8;              // Türkçe kaynak tercih edilir
  return { score, tags, why, tip: TIPS[tags[0]] || null };
}

/* ---------------- RSS AYRIŞTIRMA (bağımlılıksız) ---------------- */
const decode = (s) => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&amp;/g, '&');          // en son: &amp;lt; gibi çift kodlamayı bozmamak için

/* Atom feed'lerde başlık type="html" olabilir ve etiketler &lt;b&gt; şeklinde
   KODLANMIŞ gelir. O yüzden önce çöz, sonra etiket temizle, sonra tekrar çöz. */
const strip = (s) => decode(
  decode(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))
    .replace(/<[^>]+>/g, '')
).replace(/\s+/g, ' ').trim();

const tagOf = (block, name) => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? strip(m[1]) : '';
};

export function parseFeed(xml) {
  const out = [];
  // RSS <item> ve Atom <entry>
  const blocks = [
    ...String(xml).matchAll(/<item[\s>][\s\S]*?<\/item>/gi),
    ...String(xml).matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi),
  ].map((m) => m[0]);

  for (const b of blocks) {
    const title = tagOf(b, 'title');
    if (!title) continue;
    let link = tagOf(b, 'link');
    if (!link) {
      const m = /<link[^>]*href=["']([^"']+)["']/i.exec(b);   // Atom
      if (m) link = m[1];
    }
    const dateRaw = tagOf(b, 'pubDate') || tagOf(b, 'published') || tagOf(b, 'updated');
    const t = dateRaw ? Date.parse(dateRaw) : NaN;
    out.push({
      title,
      url: link || '',
      at: Number.isFinite(t) ? t : Date.now(),
    });
  }
  return out;
}

const uidOf = (item) =>
  crypto.createHash('sha1')
    .update((item.url || '') + '|' + item.title.toLowerCase().slice(0, 120))
    .digest('hex').slice(0, 24);

// A feed that just failed is skipped for a while: a source that is down (HTTP 522, timeouts)
// would otherwise cost a request and a log line every cycle.
const FEED_DOWN = new Map();          // name -> timestamp until which it is skipped
const FEED_COOLDOWN_MS = 30 * 60e3;
export const _feedDown = FEED_DOWN;

async function fetchFeed(f) {
  if ((FEED_DOWN.get(f.name) || 0) > Date.now()) return [];
  try {
    const r = await fetch(f.url, {
      signal: AbortSignal.timeout(Number(process.env.NEWS_TIMEOUT_MS || 25000)),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; fade-bot/1.0)', Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const xml = await r.text();
    const items = parseFeed(xml);
    if (!items.length) throw new Error('içerik ayrıştırılamadı');
    return items.map((i) => ({ ...i, source: f.name, lang: f.lang }));
  } catch (e) {
    warn(`news source ${f.name} failed (${e.message}) — skipping it for ${FEED_COOLDOWN_MS / 60e3} min`);
    FEED_DOWN.set(f.name, Date.now() + FEED_COOLDOWN_MS);
    return [];
  }
}

/* Son N saatteki haberleri topla, puanla, sırala. */
export async function collect({ hours = 6 } = {}) {
  const list = feeds();
  const all = (await Promise.all(list.map(fetchFeed))).flat();
  const since = Date.now() - hours * 3600e3;
  const seen = new Set();
  const out = [];
  for (const it of all) {
    if (it.at < since) continue;
    const uid = uidOf(it);
    if (seen.has(uid)) continue;
    seen.add(uid);
    const s = scoreItem(it.title, { lang: it.lang });
    out.push({ ...it, uid, ...s });
  }
  out.sort((a, b) => b.score - a.score || b.at - a.at);
  return out;
}

/* ---------------- de-duplication ----------------
   Several outlets cover the same event with different headlines, so the same
   saga must not be posted four times. A story is a duplicate when its uid was
   already posted, when its headline is largely the same as a recent one, or
   when the same topic (for example SECURITY) was already posted lately. */
const STOP = new Set(('the and for with that this from have has had will was were are been after before over into about than ' +
  'then them they their its his her who how why what when where which while also just more most some such only very ' +
  'için ile ve bir bu şu daha çok sonra önce kadar gibi olan oldu olarak ama fakat veya yeni son dakika nasıl neden hangi nedir ilk kez').split(' '));

// word stems: lowercase, accents removed, first 6 letters ("saldırısının" and "saldırı" meet)
export function tokens(title) {
  const words = String(title || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !STOP.has(w));
  return new Set(words.map((w) => w.slice(0, 6)));
}

// overlap coefficient of the two stem sets; 0 when either headline is too short to compare
export function similarity(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (Math.min(ta.size, tb.size) < 3) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

export function isDuplicate(item, recentRows, { cooldownMs = 6 * 3600e3, now = Date.now(), threshold = 0.5 } = {}) {
  for (const r of recentRows || []) {
    if (r.uid === item.uid || r.uid === item.uid + '-f') return { dup: true, why: 'same story' };
    if (similarity(item.title, r.title) >= threshold) return { dup: true, why: 'similar headline' };
    const topic = String(r.tags || '').split(',')[0];
    if (topic && item.tags?.[0] === topic && now - Date.parse(r.posted_at) < cooldownMs) {
      return { dup: true, why: `${topic} already covered recently` };
    }
  }
  return { dup: false };
}

/* Best fresh, non-duplicate story above the threshold. `items` is sorted by score. */
export function pickFlash(items, recentRows, { minScore, maxAgeMs, cooldownMs, now = Date.now() } = {}) {
  for (const it of items) {
    if (it.score < minScore) break;
    if (maxAgeMs && now - it.at > maxAgeMs) continue;
    if (isDuplicate(it, recentRows, { cooldownMs, now }).dup) continue;
    return it;
  }
  return null;
}

/* ---------------- coins named in a headline ---------------- */
const NAMES = {
  bitcoin: 'BTC', ethereum: 'ETH', binance: 'BNB', solana: 'SOL', ripple: 'XRP', dogecoin: 'DOGE',
  cardano: 'ADA', toncoin: 'TON', avalanche: 'AVAX', chainlink: 'LINK', polkadot: 'DOT', litecoin: 'LTC',
};
// uppercase words that look like tickers but are not coins we trade
const NOT_COINS = new Set(['SEC', 'ETF', 'CEO', 'USD', 'FED', 'CPI', 'NFT', 'DEX', 'API', 'ATH', 'SAFU', 'USA', 'TRY',
  'EUR', 'ABD', 'FOMC', 'NFP', 'DAO', 'CZ', 'IRS', 'DOJ', 'FBI', 'UK', 'EU', 'AI', 'IPO', 'GDP', 'PCE', 'FTX']);

/* Coins we actually trade that the headline mentions, with their 24h move.
   `tick` is the live ticker list [{s, c}], `watch` the set of watched symbols. */
export function mentionedCoins(title, tick = [], watch = new Set(), max = 3) {
  const text = String(title || '');
  const found = new Set();
  for (const m of text.matchAll(/\b[A-Z]{2,10}\b/g)) if (!NOT_COINS.has(m[0])) found.add(m[0]);
  for (const [name, base] of Object.entries(NAMES)) {
    if (new RegExp(`(?<![\\p{L}\\p{N}])${name}`, 'iu').test(text)) found.add(base);
  }
  const bySymbol = new Map(tick.map((x) => [x.s, x]));
  const out = [];
  for (const base of found) {
    const t = bySymbol.get(base + 'USDT');
    if (t) out.push({ base, symbol: base + 'USDT', chg: t.c, watch: watch.has(base + 'USDT') });
    if (out.length >= max) break;
  }
  return out;
}

/* Günlük özet için: eşiği geçmeyen ama ilgi çekici haberler. */
export async function digest(n = 5) {
  const items = await collect({ hours: 24 });
  return items.filter((x) => x.score > 0).slice(0, n);
}
