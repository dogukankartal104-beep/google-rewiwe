// Kanallara yayın: VIP sinyal, free teaser (gecikmeli), sonuç kartları,
// günlük analiz, haftalık/aylık performans tabloları.
import { ENV } from './config.js';
import * as db from './db.js';
import * as tg from './telegram.js';
import * as M from './messages.js';
import { stats } from './tracker.js';
import { MARKET } from './scanner.js';
import { activeCount } from './vip.js';
import { gradeAtLeast } from './config.js';
import { log, warn, trDate, trShort, trDayStart } from './util.js';

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
  if (!ENV.postVip || !ENV.vipChat) return;
  try {
    const msg = await tg.send(ENV.vipChat, M.vipSignal(sig));
    if (msg?.message_id) await db.patchSignal(sig.key, { vip_msg_id: msg.message_id });
    log(`VIP'e yayınlandı: ${sig.symbol} ${sig.dir}`);
  } catch (e) {
    warn(`VIP yayın hatası (${sig.symbol}): ${e.message}`);
  }
}

/* ---------------- 2) FREE TEASER (gecikmeli) ----------------
   Her turda çağrılır; gecikme süresi dolmuş ve henüz paylaşılmamış
   sinyalleri free kanala atar. */
export async function publishPendingFree() {
  if (!ENV.postFree || !ENV.freeChat) return 0;
  const cutoff = new Date(Date.now() - ENV.freeDelayMin * 6e4).toISOString();
  let rows;
  try { rows = await db.freePending(cutoff); }
  catch (e) { warn('free bekleyenler:', e.message); return 0; }
  if (!rows?.length) return 0;

  let n = 0;
  for (const s of rows) {
    // atlanan/dolmayan sinyalleri free'ye atmıyoruz
    if (s.status === 'atlandı' || s.status === 'dolmadı') {
      await db.patchSignal(s.key, { free_posted_at: new Date().toISOString() }).catch(() => {});
      continue;
    }
    if (!gradeAtLeast(s.grade, ENV.minGradeFree)) {
      await db.patchSignal(s.key, { free_posted_at: new Date().toISOString() }).catch(() => {});
      continue;
    }
    try {
      /* Sinyal gecikme süresi dolmadan kapanmış olabilir (örn. 10 dakikada stop).
         O durumda "şu an +XR önde" diyen teaser yanlış bilgi olur —
         doğrudan sonuç kartını yayınlıyoruz. */
      const kapandi = Boolean(s.closed_at);
      const { text, reply_markup } = kapandi
        ? M.resultCard(s, { forFree: true })
        : M.freeTeaser(s, { openR: s.open_r });

      const msg = await tg.send(ENV.freeChat, text, { reply_markup });
      await db.patchSignal(s.key, {
        free_msg_id: msg?.message_id ?? null,
        free_posted_at: new Date().toISOString(),
      });
      n++;
      log(`free'ye ${kapandi ? 'sonuç kartı' : 'teaser'}: ${s.symbol} ${s.dir}`);
    } catch (e) {
      warn(`free teaser (${s.symbol}): ${e.message}`);
      // kalıcı hata ise tekrar denemeyi bırak
      if (/chat not found|not enough rights|blocked/i.test(e.message)) {
        await db.patchSignal(s.key, { free_posted_at: new Date().toISOString() }).catch(() => {});
      }
    }
  }
  return n;
}

/* ---------------- 3) SONUÇ KARTI ---------------- */
export async function publishResult(sig) {
  // VIP: her zaman, orijinal mesaja cevap olarak
  if (ENV.postVip && ENV.vipChat) {
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
    note: MARKET.breadth
      ? (MARKET.breadth.up / (MARKET.breadth.n || 1) > 0.25
        ? 'Piyasa risk-on. Short fade\'lerde ekstra seçici ol, sadece A/B sınıfı.'
        : MARKET.breadth.dn / (MARKET.breadth.n || 1) > 0.25
          ? 'Piyasa risk-off. Long fade\'lerde acele etme, tetik şart.'
          : 'Rejim nötr. Sistem normal çalışıyor.')
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
      await db.postOnce('daily', 'vip', key, msg?.message_id ?? null);
      log('VIP günlük brifing yayınlandı');
    } catch (e) { warn('VIP gunluk:', e.message); }
  }
  if (ENV.postFree && ENV.freeChat && !(await db.postExists('daily', 'free', key))) {
    try {
      const { text, reply_markup } = M.dailyFree(d);
      const msg = await tg.send(ENV.freeChat, text, { reply_markup });
      await db.postOnce('daily', 'free', key, msg?.message_id ?? null);
      log('Free günlük analiz yayınlandı');
    } catch (e) { warn('free gunluk:', e.message); }
  }
}

/* ---------------- 5) GÜN KAPANIŞI (free vitrin) ---------------- */
export async function publishDailyRecap() {
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
    await db.postOnce('recap', 'free', key, msg?.message_id ?? null);
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
      await db.postOnce(kind, 'vip', periodKey, msg?.message_id ?? null);
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
      await db.postOnce(kind, 'free', periodKey, msg?.message_id ?? null);
      if (msg?.message_id) await tg.pin(ENV.freeChat, msg.message_id);
      log(`Free ${kind} tablo yayınlandı (${periodKey})`);
    } catch (e) { warn(`free ${kind}:`, e.message); }
  }
}

// /performans komutu için — son N gün
export async function perfLastDays(days = 30) {
  return perfFor(Date.now() - days * 864e5, Date.now() + 6e4);
}
