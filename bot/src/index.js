// Giriş noktası: tarama döngüsü + zamanlayıcı + Telegram polling + HTTP sunucu.
import { ENV, CFG, missingEnv } from './config.js';
import * as db from './db.js';
import * as tg from './telegram.js';
import * as vip from './vip.js';
import * as np from './payments.js';
import { warmup, scanOnce, MARKET } from './scanner.js';
import { resolveOpen, resolveShadows } from './tracker.js';
import { shadowTick } from './shadow.js';
import {
  publishSignal, publishResult, publishPendingFree,
  publishDaily, publishDailyRecap, publishWeekly, publishMonthly,
  publishEducation, snapshotChannels,
  publishBreakingNews, publishNewsDigest, dayKey,
} from './publisher.js';
import { pollLoop } from './commands.js';
import { startServer } from './server.js';
import { applyBranding, reportText } from './brand.js';
import { log, warn, err, sleep, trDate, fmt } from './util.js';

const ARG = new Set(process.argv.slice(2));

let scanning = false;
let lastSched = '';

async function runScan() {
  if (scanning) return { scanned: 0, fired: [], watch: [], ms: 0, busy: true };
  scanning = true;
  try {
    return await scanOnce(publishSignal);
  } finally {
    scanning = false;
  }
}

async function tick() {
  // 1) açık pozisyonları güncelle, kapananların sonucunu yayınla
  try { await resolveOpen(publishResult); }
  catch (e) { warn('resolveOpen:', e.message); }
  try { await resolveShadows(); }
  catch (e) { warn('resolveShadows:', e.message); }

  // 2) tarama
  try { await runScan(); }
  catch (e) { err('tarama:', e.message); }

  // 2b) candidate engines: forward paper trading, never published
  try { await shadowTick(); }
  catch (e) { warn('shadow:', e.message); }

  // 3) gecikmeli free vitrin
  try { await publishPendingFree(); }
  catch (e) { warn('free vitrin:', e.message); }

  // 4) flaş haber kontrolü (kendi aralığıyla, her turda değil)
  if (ENV.newsOn && Date.now() - lastNews > ENV.newsCheckMin * 60_000) {
    lastNews = Date.now();
    try { await publishBreakingNews(); }
    catch (e) { warn('haber:', e.message); }
  }
}
let lastNews = 0;

/* Zamanlı işler. Her dakika kontrol edilir, her iş günde bir kez çalışır
   (posts tablosundaki tekillik garantisi sayesinde tekrar yayın olmaz). */
async function schedule() {
  const d = trDate();
  const h = d.getUTCHours();
  const mi = d.getUTCMinutes();
  const dow = d.getUTCDay();          // 0=Pazar
  const dom = d.getUTCDate();
  const stamp = `${dayKey()}-${h}:${Math.floor(mi / 5)}`;
  if (stamp === lastSched) return;
  lastSched = stamp;

  try {
    // günlük analiz
    if (h === ENV.dailyHour && mi < 5) await publishDaily();

    // gün kapanışı (free vitrin) — 23:00 TR
    if (h === 23 && mi < 5) await publishDailyRecap();

    // haftalık tablo — günlük analizden 10 dk sonra
    if (dow === ENV.weeklyDay && h === ENV.dailyHour && mi >= 10 && mi < 15) await publishWeekly();

    // aylık tablo — ayın 1'i, günlük analizden 20 dk sonra
    if (dom === ENV.monthlyDay && h === ENV.dailyHour && mi >= 20 && mi < 25) await publishMonthly();

    // eğitim postu — günlük analizden ayrı saatte, spam olmasın
    if (ENV.eduOn && h === ENV.eduHour && mi < 5) {
      const gun = Math.floor(Date.now() / 864e5);
      if (ENV.eduEveryDays <= 1 || gun % ENV.eduEveryDays === 0) await publishEducation();
    }

    // günlük haber özeti
    if (ENV.newsOn && h === ENV.newsDigestHour && mi < 5) await publishNewsDigest();

    // abone sayısı fotoğrafı — günde iki kez yeter (dashboard büyüme grafiği)
    if ((h === 9 || h === 21) && mi < 5) await snapshotChannels();

    // VIP süre/hatırlatma taraması — saat başı
    if (mi < 5) {
      const r = await vip.sweep();
      if (r.kicked || r.reminded) log(`VIP sweep: ${r.kicked} çıkarıldı, ${r.reminded} hatırlatıldı`);
    }
  } catch (e) {
    warn('zamanlayıcı:', e.message);
  }
}

/* Railway tasarrufu: ölü saatlerde (TR 00:00–04:00) likidite ince ve
   sistem zaten sinyal üretmiyor — tarama aralığını uzatıyoruz.
   Aynı container, daha az CPU. */
function scanWaitMs() {
  const base = ENV.scanIntervalSec * 1000;
  if (!ENV.ecoOn) return base;
  const h = trDate().getUTCHours();
  const olu = ENV.ecoFromHour <= ENV.ecoToHour
    ? h >= ENV.ecoFromHour && h < ENV.ecoToHour
    : h >= ENV.ecoFromHour || h < ENV.ecoToHour;   // gece yarısını geçen aralık
  return olu ? base * Math.max(1, ENV.ecoFactor) : base;
}

async function selftest() {
  log('=== KENDİ KENDİNİ TEST ===');
  const miss = missingEnv();
  log(miss.length ? `❌ eksik ayar: ${miss.join(', ')}` : '✅ zorunlu ayarlar tamam');

  if (db.dbReady()) {
    try {
      await db.ping();
      await db.migrate();
      log('✅ Postgres bağlantısı çalışıyor, tablolar hazır');
    } catch (e) { log('❌ Postgres: ' + e.message); }
  } else log('⚠️ DATABASE_URL ayarlı değil — Railway\'de Postgres ekle');

  if (ENV.botToken) {
    try { const me = await tg.getMe(); log(`✅ Telegram botu: @${me.username}`); }
    catch (e) { log('❌ Telegram: ' + e.message); }
  }
  for (const [name, id] of [['FREE', ENV.freeChat], ['VIP', ENV.vipChat]]) {
    if (!id) { log(`⚠️ ${name} kanal ayarlı değil`); continue; }
    try {
      const n = await tg.memberCount(id);
      log(`✅ ${name} kanalı erişilebilir (${n ?? '?'} üye)`);
    } catch (e) { log(`❌ ${name} kanalı: ${e.message}`); }
  }
  if (np.configured()) {
    try { const s = await np.npStatus(); log('✅ NOWPayments: ' + JSON.stringify(s)); }
    catch (e) { log('❌ NOWPayments: ' + e.message); }
  } else log('⚠️ NOWPayments eksik ayar (API key / IPN secret / PUBLIC_URL)');

  try {
    await warmup();
    log(`✅ Binance verisi: ${MARKET.tick.length} sembol · BTC 15m ${fmt(MARKET.btc15, 2)}% · rejim ${MARKET.reg?.label || '—'}`);
  } catch (e) { log('❌ Binance: ' + e.message); }

  if (ENV.newsOn) {
    try {
      const news = await import('./news.js');
      const items = await news.collect({ hours: 24 });
      const kaynaklar = [...new Set(items.map((x) => x.source))];
      if (items.length) {
        log(`✅ Haber: ${items.length} başlık · çalışan kaynaklar: ${kaynaklar.join(', ')}`);
        const top = items[0];
        log(`   en yüksek puan ${top.score}: ${top.title.slice(0, 70)}`);
      } else log('⚠️ Haber: hiç başlık alınamadı (kaynak adresleri NEWS_FEEDS ile değiştirilebilir)');
    } catch (e) { log('❌ Haber: ' + e.message); }
  }

  log('=== TEST BİTTİ ===');
}

async function main() {
  log('FADE bot başlıyor…');
  log(`TF ${ENV.tf} · min %${ENV.scanMinChg} · top ${ENV.scanTop} · her ${ENV.scanIntervalSec}sn`);
  log(`risk %${CFG.riskPct} · max ${CFG.maxOpen} pozisyon · gün limiti ${CFG.dailyStopR}R`);
  log(`free: gecikme ${ENV.freeDelayMin}dk · günde ${ENV.freePerDay} sinyal · ${ENV.freeOnlyWinning ? `sadece kazanan (min +${ENV.freeMinOpenR}R)` : 'hepsi'} · min sınıf ${ENV.minGradeFree}`);
  log(`VIP min sınıf ${ENV.minGradeVip} · eğitim ${ENV.eduOn ? `açık (saat ${ENV.eduHour})` : 'kapalı'} · eco ${ENV.ecoOn ? `açık (×${ENV.ecoFactor})` : 'kapalı'}`);
  log(`dashboard: ${ENV.dashKey ? (ENV.publicUrl ? ENV.publicUrl + '/dash (sign-in required)' : 'PUBLIC_URL yok') : 'kapalı (DASHBOARD_KEY yok)'}`);
  if (ENV.dryRun) log('⚠️ DRY_RUN açık — Telegram\'a hiçbir şey gönderilmeyecek');

  if (ARG.has('--selftest')) { await selftest(); return; }

  const miss = missingEnv();
  if (miss.length) {
    err('Eksik zorunlu ayarlar: ' + miss.join(', '));
    err('Railway > Variables kısmından ekleyip yeniden deploy et.');
    if (!ENV.dryRun) process.exit(1);
    warn('DRY_RUN açık olduğu için yine de başlatılıyor — ' +
      'bot tarar ve kaydeder, ama hiçbir yere mesaj göndermez.');
  }

  // Veritabanı: tabloları bot kurar, elle SQL çalıştırmak gerekmez.
  if (db.dbReady()) {
    try { await db.migrate(); }
    catch (e) { err('veritabanı kurulamadı: ' + e.message); }
  }

  // Learn the bot's own username first: every public "Join VIP" button is a deep link to it.
  if (ENV.botToken) {
    try {
      const me = await tg.getMe();
      if (!ENV.botUsername) ENV.botUsername = me.username;
      log(`bot: @${ENV.botUsername}`);
    } catch (e) { warn('getMe failed — VIP buttons fall back to the free channel: ' + e.message); }
  }

  startServer();

  try { await warmup(); }
  catch (e) { err('ısınma başarısız: ' + e.message); }

  if (ARG.has('--once')) {
    const r = await runScan();
    log(`tek tur bitti: ${r.fired.length} sinyal`);
    await publishPendingFree();
    return;
  }

  // Telegram DM dinleyicisi (ayrı döngü) — token yoksa hiç başlatma,
  // yoksa her 4 saniyede bir aynı hatayı loglar.
  if (ENV.botToken) {
    pollLoop({ runScan }).catch((e) => err('poll döngüsü çöktü: ' + e.message));
  } else {
    warn('TELEGRAM_BOT_TOKEN yok — DM dinleyicisi başlatılmadı. ' +
      'Tarama ve kayıt çalışmaya devam ediyor.');
  }

  // Channel + bot branding, applied once per version (see brand.js). Never blocks startup.
  if (ENV.brandAuto && ENV.botToken && !ENV.dryRun) {
    applyBranding()
      .then(async (r) => {
        if (r.skipped) { log(`branding: ${r.skipped}`); return; }
        await vip.notifyAdmins(reportText(r));
      })
      .catch((e) => warn('branding failed: ' + e.message));
  }

  // zamanlayıcı
  setInterval(() => { schedule().catch(() => {}); }, 60_000);
  schedule().catch(() => {});

  // ana döngü
  for (;;) {
    const t0 = Date.now();
    try { await tick(); }
    catch (e) { err('tick:', e.message); }
    const wait = Math.max(5_000, scanWaitMs() - (Date.now() - t0));
    await sleep(wait);
  }
}

process.on('unhandledRejection', (e) => err('yakalanmamış reddetme:', e?.message || e));
process.on('uncaughtException', (e) => err('yakalanmamış istisna:', e?.message || e));
process.on('SIGTERM', () => { log('SIGTERM — kapanıyor'); process.exit(0); });
process.on('SIGINT', () => { log('SIGINT — kapanıyor'); process.exit(0); });

main().catch((e) => { err('ölümcül:', e?.stack || e?.message || e); process.exit(1); });
