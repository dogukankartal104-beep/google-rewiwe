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

      const msg = await tg.send(ENV.freeChat, text, { reply_markup });
      await db.patchSignal(s.key, {
        free_msg_id: msg?.message_id ?? null,
        free_posted_at: new Date().toISOString(),
        free_kind: kind,
        free_open_r: score,
      });
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

/* ---------------- 7) EĞİTİM İÇERİĞİ ----------------
   Sırayla yayınlanır, tekrar etmez. Kütüphane bitince baştan başlar
   (edu_log tekilliği yüzünden aynı ders aynı kanala iki kez gitmez;
   döngü sıfırlanırsa yeni ders eklenmesi beklenir). */
export async function publishEducation() {
  if (!ENV.eduOn) return 0;
  const { LESSONS } = await import('./lessons.js');
  let n = 0;

  for (const [channel, chatId, forFree] of [
    ['free', ENV.freeChat, true],
    ['vip', ENV.vipChat, false],
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

      const { text, reply_markup } = M.eduPost(lesson, {
        forFree, idx: idx + 1, total: LESSONS.length,
      });
      const msg = await tg.send(chatId, text, reply_markup ? { reply_markup } : {});
      await db.eduAdd(lesson.id, channel, msg?.message_id ?? null);
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
