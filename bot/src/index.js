// Giriş noktası: tarama döngüsü + zamanlayıcı + Telegram polling + HTTP sunucu.
import { ENV, CFG, missingEnv } from './config.js';
import * as db from './db.js';
import * as tg from './telegram.js';
import * as vip from './vip.js';
import * as np from './payments.js';
import { warmup, scanOnce, MARKET } from './scanner.js';
import { resolveOpen } from './tracker.js';
import {
  publishSignal, publishResult, publishPendingFree,
  publishDaily, publishDailyRecap, publishWeekly, publishMonthly, dayKey,
} from './publisher.js';
import { pollLoop } from './commands.js';
import { startServer } from './server.js';
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

  // 2) tarama
  try { await runScan(); }
  catch (e) { err('tarama:', e.message); }

  // 3) gecikmeli free teaser'ları yayınla
  try { await publishPendingFree(); }
  catch (e) { warn('free teaser:', e.message); }
}

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

    // VIP süre/hatırlatma taraması — saat başı
    if (mi < 5) {
      const r = await vip.sweep();
      if (r.kicked || r.reminded) log(`VIP sweep: ${r.kicked} çıkarıldı, ${r.reminded} hatırlatıldı`);
    }
  } catch (e) {
    warn('zamanlayıcı:', e.message);
  }
}

async function selftest() {
  log('=== KENDİ KENDİNİ TEST ===');
  const miss = missingEnv();
  log(miss.length ? `❌ eksik ayar: ${miss.join(', ')}` : '✅ zorunlu ayarlar tamam');

  if (db.dbReady()) {
    try { await db.ping(); log('✅ Supabase bağlantısı çalışıyor'); }
    catch (e) { log('❌ Supabase: ' + e.message); }
  } else log('⚠️ Supabase ayarlı değil');

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

  log('=== TEST BİTTİ ===');
}

async function main() {
  log('FADE bot başlıyor…');
  log(`TF ${ENV.tf} · min %${ENV.scanMinChg} · top ${ENV.scanTop} · her ${ENV.scanIntervalSec}sn`);
  log(`risk %${CFG.riskPct} · max ${CFG.maxOpen} pozisyon · gün limiti ${CFG.dailyStopR}R`);
  log(`free gecikme ${ENV.freeDelayMin}dk · VIP min sınıf ${ENV.minGradeVip} · free min sınıf ${ENV.minGradeFree}`);
  if (ENV.dryRun) log('⚠️ DRY_RUN açık — Telegram\'a hiçbir şey gönderilmeyecek');

  if (ARG.has('--selftest')) { await selftest(); return; }

  const miss = missingEnv();
  if (miss.length) {
    err('Eksik zorunlu ayarlar: ' + miss.join(', '));
    err('Railway > Variables kısmından ekleyip yeniden deploy et.');
    if (!ENV.dryRun) process.exit(1);
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

  // Telegram DM dinleyicisi (ayrı döngü)
  pollLoop({ runScan }).catch((e) => err('poll döngüsü çöktü: ' + e.message));

  // zamanlayıcı
  setInterval(() => { schedule().catch(() => {}); }, 60_000);
  schedule().catch(() => {});

  // ana döngü
  for (;;) {
    const t0 = Date.now();
    try { await tick(); }
    catch (e) { err('tick:', e.message); }
    const wait = Math.max(5_000, ENV.scanIntervalSec * 1000 - (Date.now() - t0));
    await sleep(wait);
  }
}

process.on('unhandledRejection', (e) => err('yakalanmamış reddetme:', e?.message || e));
process.on('uncaughtException', (e) => err('yakalanmamış istisna:', e?.message || e));
process.on('SIGTERM', () => { log('SIGTERM — kapanıyor'); process.exit(0); });
process.on('SIGINT', () => { log('SIGINT — kapanıyor'); process.exit(0); });

main().catch((e) => { err('ölümcül:', e?.stack || e?.message || e); process.exit(1); });
