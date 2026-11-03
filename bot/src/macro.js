// Macro-event window. Inside it the decision engine vetoes every new position,
// because spreads, slippage and correlations are at their worst and technical
// structure stops meaning anything.
//
// Three sources:
//  1. the US jobs report (NFP) — first Friday of the month, 8:30 New York time, converted with real DST rules
//  2. MACRO_EVENTS — dates you add yourself (FOMC, CPI ...):  MACRO_EVENTS="2026-11-04T19:00:00Z|FOMC,2026-11-12T13:30:00Z|CPI"
//  3. reactive: a high-scoring MACRO headline that was published in the last 30 minutes
//
// The result has the shape decide.js already understands: { e, dk, lvl } with
// lvl 'kırmızı' (red = veto), 'sarı' (yellow = heads-up) or 'yok'.

const RED_BEFORE_MIN = 30;     // veto starts 30 minutes before a scheduled release
const RED_AFTER_MIN = 15;      // ...and lasts 15 minutes after it
const YELLOW_BEFORE_MIN = 120;
const NEWS_WINDOW_MIN = 30;    // a macro headline keeps the veto on for 30 minutes after it was published

/* 8:30 on a given New York wall-clock day as a UTC timestamp (EDT is UTC-4, EST is UTC-5). */
export function etToUtc(y, m, d, h, mi = 0) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
  for (const off of [4, 5]) {
    const t = Date.UTC(y, m, d, h + off, mi);
    if (Number(fmt.format(new Date(t))) % 24 === h) return t;
  }
  return Date.UTC(y, m, d, h + 5, mi);
}

export function firstFridayNfp(y, m) {
  let d = 1;
  while (new Date(Date.UTC(y, m, d)).getUTCDay() !== 5) d++;
  return { n: 'US jobs report (NFP)', t: etToUtc(y, m, d, 8, 30) };
}

export function envEvents(raw = process.env.MACRO_EVENTS || '') {
  return String(raw).split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
    const [iso, name] = x.split('|');
    const t = Date.parse(iso);
    return Number.isFinite(t) ? { n: (name || 'macro event').trim(), t } : null;
  }).filter(Boolean);
}

export function allEvents(now = Date.now(), extra = null) {
  const d = new Date(now);
  const evs = [];
  for (let i = -1; i < 3; i++) {
    const month = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1));
    evs.push(firstFridayNfp(month.getUTCFullYear(), month.getUTCMonth()));
  }
  return evs.concat(envEvents(), extra || []).sort((a, b) => a.t - b.t);
}

// time a high-scoring macro headline was published; the veto is held for NEWS_WINDOW_MIN after it
let newsAt = 0;
export function noteMacroNews(publishedAt) { if (publishedAt > newsAt) newsAt = publishedAt; }
export const _resetMacroNews = () => { newsAt = 0; };

export function macroRisk(now = Date.now(), { events = null } = {}) {
  // reactive window
  if (newsAt && now - newsAt >= 0 && now - newsAt <= NEWS_WINDOW_MIN * 60e3) {
    return { e: { n: 'macro headline', t: newsAt }, dk: (newsAt - now) / 60e3, lvl: 'kırmızı' };
  }
  const list = events || allEvents(now);
  // the nearest event that is still relevant (not more than RED_AFTER_MIN in the past)
  const e = list.find((x) => x.t > now - RED_AFTER_MIN * 60e3);
  if (!e) return null;
  const dk = (e.t - now) / 60e3;
  if (dk <= RED_BEFORE_MIN && dk >= -RED_AFTER_MIN) return { e, dk, lvl: 'kırmızı' };
  if (dk <= YELLOW_BEFORE_MIN && dk > 0) return { e, dk, lvl: 'sarı' };
  return { e, dk, lvl: 'yok' };
}
