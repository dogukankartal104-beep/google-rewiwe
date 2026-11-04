// Kanallara yayın: VIP sinyal, free teaser (gecikmeli), sonuç kartları,
// günlük analiz, haftalık/aylık performans tabloları.
import { ENV } from './config.js';
import * as db from './db.js';
import * as tg from './telegram.js';
import * as M from './messages.js';
import { stats } from './tracker.js';
import { MARKET } from './scanner.js';
import { noteMacroNews, macroRisk } from './macro.js';
import { activeCount } from './vip.js';
import { gradeAtLeast } from './config.js';
import { log, warn, trDate, trShort, trDayStart } from './util.js';
import { signalChartPng, profitChartPng, newsCardPng } from './chart.js';

/* ---------------- dönem anahtarları ---------------- */
export const dayKey = (t = Date.now()) => {
  const d = trDate(t);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
};
export const monthKey = (t = Date.now()) => {
  const d = trDate(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
export function weekKey(t = Date.now()) {
  const d = trDate(t);
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (dt.getUTCDay() + 6) % 7;          // Pazartesi = 0
  dt.setUTCDate(dt.getUTCDate() - dayNum + 3);      // o haftanın Perşembesi
  const firstThu = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const fDayNum = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fDayNum + 3);
  const week = 1 + Math.round((dt - firstThu) / (7 * 864e5));
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/* ---------------- 1) VIP SİNYAL (anında) ---------------- */
export async function publishSignal(sig) {
  if (!ENV.fadePublish) return;                     // FADE engine is recorded but not published
  if (!ENV.postVip || !ENV.vipChat) return;
  try {
    const msg = await tg.sendCard(ENV.vipChat, await signalChartPng(sig), M.vipSignal(sig));
    if (msg?.message_id) await db.patchSignal(sig.key, { vip_msg_id: msg.message_id });
    log(`VIP'e yayınlandı: ${sig.symbol} ${sig.dir}`);
  } catch (e) {
    warn(`VIP yayın hatası (${sig.symbol}): ${e.message}`);
  }
}

/* ---------------- 2) FREE VİTRİN ----------------
   Kurallar:
   • Günde en fazla ENV.freePerDay sinyal (varsayılan 1)
   • SADECE kârda olan pozisyon gösterilir (ENV.freeOnlyWinning)
   • Gecikme ENV.freeDelayMin dakika
   • Kârda değilse hemen vazgeçmez — freePendingMaxH saat boyunca bekler,
     o süre içinde kâra geçerse yayınlar. Geçmezse sessizce atlar.
   • Birden fazla aday varsa EN İYİSİ seçilir (en yüksek R).

   ÖNEMLİ: Vitrine çıkan pozisyonun sonucu, kaybetse bile free kanala
   gönderilir (publishResult bunu free_posted_at üzerinden yapar).
   Kazananı gösterip sonucu saklamak yapmadığımız bir şey. */
/* DRY_RUN notu: kuru modda tg.send gercekte gondermez, {dry:true} doner.
   Boyle bir gonderimi "yayinlandi" diye isaretlersek, canliya gecince o icerik
   bir daha hic gonderilmez — kimsenin gormedigi icerik yanmis olur.
   Bu yuzden kuru gonderimlerde tekillik kayitlari YAZILMAZ. */
const kuru = (msg) => Boolean(msg && msg.dry);

/* Profit image for a showcased FADE position: entry, stop, targets and the current price over the recent candles. */
async function showcasePng(s) {
  const long = s.dir === 'L', px = Number(s.last_px), en = Number(s.entry);
  if (!(px > 0) || !(en > 0)) return null;
  const move = (long ? px - en : en - px) / en * 100;
  return profitChartPng({ symbol: s.symbol, tf: s.tf || '15m', dir: s.dir, entry: en, now: px, stop: s.stop, targets: [s.tp1, s.tp2].filter(Number.isFinite),
    profitText: `${move >= 0 ? '+' : ''}${move.toFixed(1)}%`, small: s.open_r != null ? `${s.open_r >= 0 ? '+' : ''}${Number(s.open_r).toFixed(1)}R · IN PROFIT` : 'IN PROFIT' });
}

const fmtR = (v) => `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}R`;

const skipFree = (key, why) =>
  db.patchSignal(key, { free_skipped: true, free_skip_why: why }).catch(() => {});

/* Bir adayın free kanala uygun olup olmadığını belirler. Saf fonksiyon —
   testlerde doğrudan doğrulanır (ticari olarak en kritik karar burası).

   döner: { action: 'post' | 'skip' | 'wait', kind, score, why } */
export function classifyFreeCandidate(s, now = Date.now(), env = ENV) {
  if (s.status === 'atlandı' || s.status === 'dolmadı') {
    return { action: 'skip', why: s.status };
  }
  if (!gradeAtLeast(s.grade, env.minGradeFree)) {
    return { action: 'skip', why: `sınıf ${s.grade} < ${env.minGradeFree}` };
  }

  const yas = now - Date.parse(s.created_at);
  const zamanAsimi = yas > env.freePendingMaxH * 3600e3;

  if (s.closed_at) {
    // Gecikme dolmadan kapandı: "şu an kazanıyor" demek yanlış olur,
    // doğrudan sonuç kartı — ama sadece kazandıysa.
    const net = s.r_net ?? s.r ?? 0;
    if (env.freeOnlyWinning && net <= 0) {
      return { action: 'skip', why: `kapandı ${fmtR(net)}` };
    }
    return { action: 'post', kind: 'result', score: net };
  }

  const openR = s.open_r ?? 0;
  if (env.freeOnlyWinning && openR < env.freeMinOpenR) {
    return zamanAsimi
      ? { action: 'skip', why: `${env.freePendingMaxH} saatte kâra geçmedi` }
      : { action: 'wait', why: `${fmtR(openR)} < +${env.freeMinOpenR}R` };
  }
  return { action: 'post', kind: 'showcase', score: openR };
}

export async function publishPendingFree() {
  if (!ENV.fadePublish) return 0;
  if (!ENV.postFree || !ENV.freeChat) return 0;

  // --- günlük kota ---
  const dayFrom = new Date(trDayStart()).toISOString();
  const dayTo = new Date(trDayStart() + 864e5).toISOString();
  let used = 0;
  try { used = ((await db.freePostedBetween(dayFrom, dayTo)) || []).length; }
  catch (e) { warn('free kota okunamadı:', e.message); return 0; }
  const slots = ENV.freePerDay - used;
  if (slots <= 0) return 0;

  // --- adaylar ---
  const cutoff = new Date(Date.now() - ENV.freeDelayMin * 6e4).toISOString();
  let rows;
  try { rows = await db.freeCandidates(cutoff); }
  catch (e) { warn('free adayları:', e.message); return 0; }
  if (!rows?.length) return 0;

  const ready = [];
  for (const s of rows) {
    const v = classifyFreeCandidate(s);
    if (v.action === 'skip') { await skipFree(s.key, v.why); continue; }
    if (v.action === 'wait') continue;              // sonraki turda tekrar bakılır
    ready.push({ s, kind: v.kind, score: v.score });
  }
  if (!ready.length) return 0;

  // en iyi performans gösteren adayı seç
  ready.sort((a, b) => b.score - a.score);

  let n = 0;
  for (const { s, kind, score } of ready.slice(0, slots)) {
    try {
      const { text, reply_markup } = kind === 'result'
        ? M.resultCard(s, { forFree: true })
        : M.freeShowcase(s, score);

      const png = kind === 'result' ? null : await showcasePng(s);
      const msg = await tg.sendCard(ENV.freeChat, png, text, { reply_markup });
      if (!kuru(msg)) {
        await db.patchSignal(s.key, {
          free_msg_id: msg?.message_id ?? null,
          free_posted_at: new Date().toISOString(),
          free_kind: kind,
          free_open_r: score,
        });
      }
      n++;
      log(`free'ye ${kind}: ${s.symbol} ${s.dir} (${fmtR(score)})`);
    } catch (e) {
      warn(`free vitrin (${s.symbol}): ${e.message}`);
      if (/chat not found|not enough rights|blocked/i.test(e.message)) {
        await skipFree(s.key, 'kanal hatası');
      }
    }
  }
  return n;
}


/* ---------------- 3) SONUÇ KARTI ---------------- */
export async function publishResult(sig) {
  // With FADE publishing off, results are still posted for signals that WERE published (follow-through), never for the rest.
  if (!ENV.fadePublish && !sig.vip_msg_id && !sig.free_posted_at) return;
  // VIP: her zaman, orijinal mesaja cevap olarak
  if (ENV.postVip && ENV.vipChat && (ENV.fadePublish || sig.vip_msg_id)) {
    try {
      const { text } = M.resultCard(sig, { forFree: false });
      const msg = await tg.send(ENV.vipChat, text,
        sig.vip_msg_id ? { reply_parameters: { message_id: sig.vip_msg_id, allow_sending_without_reply: true } } : {});
      if (msg?.message_id) await db.patchSignal(sig.key, { result_msg_id: msg.message_id });
    } catch (e) { warn(`VIP sonuç (${sig.symbol}): ${e.message}`); }
  }
  // FREE: sadece free'de teaser'ı yayınlanmış olanlar için (bağlam olsun)
  if (ENV.postFree && ENV.freeChat && sig.free_posted_at) {
    try {
      const { text, reply_markup } = M.resultCard(sig, { forFree: true });
      await tg.send(ENV.freeChat, text, {
        reply_markup,
        ...(sig.free_msg_id
          ? { reply_parameters: { message_id: sig.free_msg_id, allow_sending_without_reply: true } }
          : {}),
      });
    } catch (e) { warn(`free sonuç (${sig.symbol}): ${e.message}`); }
  }
}

/* ---------------- 4) GÜNLÜK ANALİZ ---------------- */
async function dailyData() {
  const y0 = trDayStart(Date.now() - 864e5);
  const y1 = trDayStart();
  let yRows = [], open = [];
  try { yRows = (await db.closedBetween(new Date(y0).toISOString(), new Date(y1).toISOString())) || []; }
  catch (e) { warn('dun verisi:', e.message); }
  try { open = (await db.openSignals()) || []; }
  catch (e) { warn('acik pozisyonlar:', e.message); }

  const movers = MARKET.tick
    .slice()
    .sort((a, b) => Math.abs(b.c) - Math.abs(a.c))
    .filter((x) => x.v > 5e6)
    .slice(0, 8);

  return {
    reg: MARKET.reg,
    dvol: MARKET.dvol,
    shock: MARKET.shock,
    breadth: MARKET.breadth,
    movers,
    scanned: MARKET.scanned,
    watching: MARKET.watchlist.length,
    watchlist: MARKET.watchlist,
    openN: open.length,
    open,
    yesterday: yRows.length ? stats(yRows) : null,
    noteEn: MARKET.breadth
      ? (MARKET.breadth.up / (MARKET.breadth.n || 1) > 0.25
        ? 'Market is risk-on. Be extra selective on short fades — A/B grades only.'
        : MARKET.breadth.dn / (MARKET.breadth.n || 1) > 0.25
          ? 'Market is risk-off. Do not rush long fades; wait for the trigger.'
          : 'Regime is neutral. The system is operating normally.')
      : null,
  };
}

export async function publishDaily() {
  const key = dayKey();
  const d = await dailyData();

  if (ENV.postVip && ENV.vipChat && !(await db.postExists('daily', 'vip', key))) {
    try {
      const { text } = M.dailyVip(d);
      const msg = await tg.send(ENV.vipChat, text);
      if (!kuru(msg)) await db.postOnce('daily', 'vip', key, msg?.message_id ?? null);
      log('VIP günlük brifing yayınlandı');
    } catch (e) { warn('VIP gunluk:', e.message); }
  }
  if (ENV.postFree && ENV.freeChat && !(await db.postExists('daily', 'free', key))) {
    try {
      const { text, reply_markup } = M.dailyFree(d);
      const msg = await tg.send(ENV.freeChat, text, { reply_markup });
      if (!kuru(msg)) await db.postOnce('daily', 'free', key, msg?.message_id ?? null);
      log('Free günlük analiz yayınlandı');
    } catch (e) { warn('free gunluk:', e.message); }
  }
}

/* ---------------- 5) GÜN KAPANIŞI (free vitrin) ---------------- */
export async function publishDailyRecap() {
  if (!ENV.fadePublish) return;
  if (!ENV.postFree || !ENV.freeChat) return;
  const key = dayKey();
  if (await db.postExists('recap', 'free', key)) return;
  try {
    const from = new Date(trDayStart()).toISOString();
    const to = new Date(trDayStart() + 864e5).toISOString();
    const rows = (await db.closedBetween(from, to)) || [];
    const open = (await db.openSignals()) || [];
    const { text, reply_markup } = M.dailyRecapFree(stats(rows), open.length);
    const msg = await tg.send(ENV.freeChat, text, { reply_markup });
    if (!kuru(msg)) await db.postOnce('recap', 'free', key, msg?.message_id ?? null);
    log('Free gün kapanışı yayınlandı');
  } catch (e) { warn('gun kapanisi:', e.message); }
}

/* ---------------- 6) HAFTALIK / AYLIK TABLO ---------------- */
async function perfFor(fromMs, toMs) {
  const rows = (await db.closedBetween(
    new Date(fromMs).toISOString(), new Date(toMs).toISOString())) || [];
  return stats(rows);
}

export async function publishWeekly() {
  if (!ENV.fadePublish) return;
  // Geçen haftanın (Pzt–Paz) sonucu
  const now = Date.now();
  const d = trDate(now);
  const dayNum = (d.getUTCDay() + 6) % 7;                       // Pazartesi = 0
  const thisMon = trDayStart(now) - dayNum * 864e5;
  const from = thisMon - 7 * 864e5;
  const to = thisMon;
  const key = weekKey(from + 864e5);
  const st = await perfFor(from, to);
  const label = `${trShort(from)} – ${trShort(to - 864e5)}`;
  const members = await activeCount();

  await publishTable({
    kind: 'weekly', periodKey: key, st,
    title: 'HAFTALIK PERFORMANS', periodLabel: label, members,
  });
}

export async function publishMonthly() {
  if (!ENV.fadePublish) return;
  const d = trDate(Date.now());
  const firstThis = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - 3 * 3600e3;
  const prev = new Date(firstThis - 864e5);
  const pd = trDate(firstThis - 864e5);
  const firstPrev = Date.UTC(pd.getUTCFullYear(), pd.getUTCMonth(), 1) - 3 * 3600e3;
  const key = monthKey(firstPrev + 864e5);
  const st = await perfFor(firstPrev, firstThis);
  const label = `${trShort(firstPrev)} – ${trShort(firstThis - 864e5)}`;
  const members = await activeCount();

  await publishTable({
    kind: 'monthly', periodKey: key, st,
    title: 'AYLIK PERFORMANS', periodLabel: label, members,
  });
}

async function publishTable({ kind, periodKey, st, title, periodLabel, members }) {
  if (ENV.postVip && ENV.vipChat && !(await db.postExists(kind, 'vip', periodKey))) {
    try {
      const { text } = M.perfTable(st, { title, periodLabel, forFree: false });
      const msg = await tg.send(ENV.vipChat, text);
      if (!kuru(msg)) await db.postOnce(kind, 'vip', periodKey, msg?.message_id ?? null);
      if (msg?.message_id) await tg.pin(ENV.vipChat, msg.message_id);
      log(`VIP ${kind} tablo yayınlandı (${periodKey})`);
    } catch (e) { warn(`VIP ${kind}:`, e.message); }
  }
  if (ENV.postFree && ENV.freeChat && !(await db.postExists(kind, 'free', periodKey))) {
    try {
      const { text, reply_markup } = M.perfTable(st, {
        title, periodLabel, forFree: true, memberCount: members,
      });
      const msg = await tg.send(ENV.freeChat, text, { reply_markup });
      if (!kuru(msg)) await db.postOnce(kind, 'free', periodKey, msg?.message_id ?? null);
      if (msg?.message_id) await tg.pin(ENV.freeChat, msg.message_id);
      log(`Free ${kind} tablo yayınlandı (${periodKey})`);
    } catch (e) { warn(`free ${kind}:`, e.message); }
  }
}

// /performans komutu için — son N gün
export async function perfLastDays(days = 30) {
  return perfFor(Date.now() - days * 864e5, Date.now() + 6e4);
}

/* ---------------- 7) EĞİTİM İÇERİĞİ ----------------
   Sırayla yayınlanır, tekrar etmez. Kütüphane bitince baştan başlar
   (edu_log tekilliği yüzünden aynı ders aynı kanala iki kez gitmez;
   döngü sıfırlanırsa yeni ders eklenmesi beklenir). */
export async function publishEducation() {
  if (!ENV.eduOn) return 0;
  const { LESSONS } = await import('./lessons.js');
  let n = 0;

  // Education goes to the FREE channel only (VIP is not sent lessons). Cadence: EDU_EVERY_DAYS (default every 2 days).
  for (const [channel, chatId, forFree] of [
    ['free', ENV.freeChat, true],
  ]) {
    if (!chatId) continue;
    if (channel === 'free' && !ENV.postFree) continue;
    if (channel === 'vip' && !ENV.postVip) continue;

    try {
      const done = (await db.eduPosted(channel)) || [];
      const doneIds = new Set(done.map((x) => x.lesson_id));

      // sıradaki yayınlanmamış ders
      const idx = LESSONS.findIndex((l) => !doneIds.has(l.id));
      if (idx === -1) {
        log(`eğitim: ${channel} için tüm dersler yayınlanmış (${LESSONS.length})`);
        continue;
      }
      const lesson = LESSONS[idx];

      const { text, reply_markup } = M.eduPost(lesson, { forFree });
      const msg = await tg.send(chatId, text, reply_markup ? { reply_markup } : {});
      if (!kuru(msg)) await db.eduAdd(lesson.id, channel, msg?.message_id ?? null);
      n++;
      log(`eğitim yayınlandı (${channel}): ${lesson.id} [${idx + 1}/${LESSONS.length}]`);
    } catch (e) {
      if (/duplicate|unique/i.test(e.message)) continue; // yarış durumu, sorun değil
      warn(`eğitim (${channel}):`, e.message);
    }
  }
  return n;
}

/* ---------------- 8) KANAL İSTATİSTİĞİ ----------------
   Telegram Bot API gönderi görüntülenmesini VERMEZ. Abone sayısını
   günlük kaydediyoruz; dashboard büyümeyi buradan gösteriyor. */
export async function snapshotChannels() {
  const day = dayKey();
  for (const [channel, chatId] of [['free', ENV.freeChat], ['vip', ENV.vipChat]]) {
    if (!chatId) continue;
    try {
      const members = await tg.memberCount(chatId);
      if (members == null) continue;
      await db.statsSnapshot(day, channel, members);
    } catch (e) {
      warn(`abone sayısı (${channel}):`, e.message);
    }
  }
}

/* ---------------- 9) NEWS ----------------
   VIP and free get DIFFERENT news products, and neither is a firehose:

   • VIP  — a fresh flash story (at most NEWS_MAX_PER_DAY a day) with the "desk view": how to trade
            around it, the live market state, the coins it names, and our open book.
   • Free — only big stories (score >= NEWS_FREE_MIN_SCORE), at most NEWS_FREE_MAX_PER_DAY a day,
            posted NEWS_FREE_DELAY_MIN minutes after VIP, without the desk view, with a pointer to VIP.

   The same event is never posted twice: duplicates are caught by story id, by headline similarity
   and by a per-topic cooldown (several outlets cover one hack with different headlines).
   A story older than NEWS_BREAKING_MINUTES is not "breaking" and is left for the evening digest. */

// posts made by this process, in case the database write after a successful send fails:
// without this a failed log write would repost the same story every 20 minutes
const POSTED_MEMORY = [];
const remember = (row) => { POSTED_MEMORY.push(row); if (POSTED_MEMORY.length > 100) POSTED_MEMORY.shift(); };

async function newsContext(item, news) {
  const watch = new Set((MARKET.watchlist || []).map((w) => w.symbol));
  let open = [];
  try {
    open = ((await db.openSignals()) || []).map((o) => ({ symbol: o.symbol, dir: o.dir, open_r: o.open_r ?? 0 }));
  } catch { /* the desk view just omits the open book */ }
  return {
    btc15: MARKET.btc15,
    shock: MARKET.shock,
    rejim: MARKET.reg?.label || null,
    coins: item ? news.mentionedCoins(item.title, MARKET.tick, watch) : [],
    open,
    macro: macroRisk(),
  };
}

const rowsOf = (dbRows, channel, sinceMs) => dbRows
  .concat(POSTED_MEMORY)
  .filter((r) => r.channel === channel && Date.parse(r.posted_at) >= sinceMs)
  // memory rows may duplicate database rows; keep one per uid
  .filter((r, i, arr) => arr.findIndex((x) => x.uid === r.uid) === i);

export async function publishBreakingNews() {
  if (!ENV.newsOn) return 0;
  const news = await import('./news.js');
  const now = Date.now();

  let items = [];
  try { items = await news.collect({ hours: ENV.newsBreakingMin / 60 }); }
  catch (e) { warn('news collection:', e.message); return 0; }

  // a fresh, high-scoring macro headline switches the engine's macro-window veto on
  for (const it of items) {
    if (it.tags?.[0] === 'MACRO' && it.score >= 38 && now - it.at <= 30 * 60e3) noteMacroNews(it.at);
  }

  let logRows;
  try { logRows = (await db.newsSince(new Date(now - 24 * 3600e3).toISOString())) || []; }
  catch (e) { warn('news log unreadable — posting nothing rather than risk repeats:', e.message); return 0; }

  const day0 = trDayStart();
  const vipAll = rowsOf(logRows, 'vip', now - 24 * 3600e3);
  const freeAll = rowsOf(logRows, 'free', now - 24 * 3600e3);
  const vipToday = vipAll.filter((r) => Date.parse(r.posted_at) >= day0).length;
  const freeToday = freeAll.filter((r) => Date.parse(r.posted_at) >= day0).length;
  const cooldownMs = ENV.newsTagCooldownH * 3600e3;
  let n = 0;

  // ---------------- VIP ----------------
  if (ENV.postVip && ENV.vipChat && vipToday < ENV.newsMaxPerDay) {
    const item = news.pickFlash(items, vipAll, {
      minScore: ENV.newsMinScore, maxAgeMs: ENV.newsBreakingMin * 60e3, cooldownMs, now,
    });
    if (item) {
      try {
        const { text } = M.newsFlash(item, await newsContext(item, news), { forFree: false });
        const msg = await tg.sendCard(ENV.vipChat, await newsCardPng(item, 'just now'), text);
        if (!kuru(msg)) {
          const row = {
            uid: item.uid, title: item.title, url: item.url, source: item.source, score: item.score,
            tags: (item.tags || []).join(','), channel: 'vip', message_id: msg?.message_id ?? null,
            published_at: item.at, posted_at: new Date().toISOString(),
          };
          remember(row);
          await db.newsAdd(row).catch((e) => warn('news log write failed (kept in memory):', e.message));
        }
        n++;
        log(`news → VIP (${item.score}p): ${item.title.slice(0, 70)}`);
      } catch (e) { warn('news → VIP:', e.message); }
    }
  }

  // ---------------- FREE: up to ENV.newsFreeMaxPerDay stories a day, spaced out, picked on their own ----------------
  const lastFree = freeAll.reduce((m, r) => Math.max(m, Date.parse(r.posted_at)), 0);
  if (ENV.postFree && ENV.freeChat && freeToday < ENV.newsFreeMaxPerDay && now - lastFree >= ENV.newsFreeGapMin * 60e3) {
    const item = news.pickFlash(items, freeAll, {
      minScore: ENV.newsFreeMinScore, maxAgeMs: ENV.newsBreakingMin * 60e3, cooldownMs, now,
    });
    if (item) {
      try {
        const { text, reply_markup } = M.newsFlash(item, {}, { forFree: true });
        const msg = await tg.sendCard(ENV.freeChat, await newsCardPng(item, 'just now'), text, { reply_markup });
        if (!kuru(msg)) {
          const row = {
            uid: item.uid + '-f', title: item.title, url: item.url, source: item.source, score: item.score,
            tags: (item.tags || []).join(','), channel: 'free', message_id: msg?.message_id ?? null,
            published_at: item.at, posted_at: new Date().toISOString(),
          };
          remember(row);
          await db.newsAdd(row).catch((e) => warn('news log write failed (kept in memory):', e.message));
        }
        n++;
        log(`news → free: ${item.title.slice(0, 70)}`);
      } catch (e) { warn('news → free:', e.message); }
    }
  }
  return n;
}

/* Evening digest: everything else that mattered, one message per channel.
   Stories already posted as a flash that day are left out so it never repeats them. */
export async function publishNewsDigest() {
  if (!ENV.newsOn || !ENV.newsDigestOn) return 0;     // digest is off by default: free gets its stories one by one
  const key = dayKey();
  const news = await import('./news.js');
  let all = [];
  try { all = await news.digest(8); }
  catch (e) { warn('news digest:', e.message); return 0; }

  let logRows = [];
  try { logRows = (await db.newsSince(new Date(Date.now() - 24 * 3600e3).toISOString())) || []; } catch { /* digest still works */ }

  const base = await newsContext(null, news);
  let n = 0;
  for (const [channel, chatId, enabled] of [
    ['free', ENV.freeChat, ENV.postFree],
    ['vip', ENV.vipChat, ENV.postVip],
  ]) {
    if (!chatId || !enabled) continue;
    if (await db.postExists('news', channel, key)) continue;

    const already = rowsOf(logRows, channel, Date.now() - 24 * 3600e3);
    const items = all
      .filter((it) => !news.isDuplicate(it, already, { cooldownMs: 0 }).dup)
      .slice(0, 5);
    const { text, reply_markup } = M.newsDigest(items, { ...base, flashToday: already.length > 0 }, { forFree: channel === 'free' });
    try {
      const msg = await tg.send(chatId, text, reply_markup ? { reply_markup } : {});
      if (!kuru(msg)) await db.postOnce('news', channel, key, msg?.message_id ?? null);
      n++;
    } catch (e) { warn(`news digest (${channel}):`, e.message); }
  }
  if (n) log(`news digest posted (${n} channel(s))`);
  return n;
}
