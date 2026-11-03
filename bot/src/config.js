// FADE sistem parametreleri — HUD'daki CFG ile birebir aynı varsayılanlar.
// Hepsi ENV ile ezilebilir: CFG_zz=1.8 gibi.
const num = (k, d) => {
  const v = process.env['CFG_' + k];
  return v === undefined || v === '' ? d : Number(v);
};

export const CFG = {
  // --- tepe/dip motoru ---
  zz: num('zz', 1.6),                  // zigzag hassasiyeti (ATR katı)
  searchBars: num('searchBars', 250),  // tepe arama penceresi
  minPumpPct: num('minPumpPct', 15),   // min impulse %
  candleAtr: num('candleAtr', 2.5),    // tek mum / ATR
  // --- OI / tip ---
  oiPriceRatio: num('oiPriceRatio', 4),
  oiVeto: num('oiVeto', 25),
  oiBleed: num('oiBleed', 2),
  fundingHot: num('fundingHot', 0.05),
  // --- tükenme / tetik ---
  volDecay: num('volDecay', 0.5),
  minPullback: num('minPullback', 3),
  retestZone: num('retestZone', 3),
  btcVeto: num('btcVeto', 1.5),
  // --- stop / hedef ---
  stopAtr: num('stopAtr', 1.2),
  huntAtr: num('huntAtr', 1.5),
  minStopAtr: num('minStopAtr', 1.3),
  maxStopAtr: num('maxStopAtr', 3),
  stopLook: num('stopLook', 6),
  tpBarRatio: num('tpBarRatio', 3),
  volCap: num('volCap', 3),
  tpMinR: num('tpMinR', 1.2),
  maxStopPct: num('maxStopPct', 6),
  rrTarget: num('rrTarget', 1),
  maxTpR: num('maxTpR', 2.5),
  newListDays: num('newListDays', 30),
  srTouch: num('srTouch', 2),
  // --- risk yönetimi ---
  acct: num('acct', 1000),
  riskPct: num('riskPct', 1),
  maxOpen: num('maxOpen', 2),
  dailyStopR: num('dailyStopR', -2),
  trackBars: num('trackBars', 32),
  reSignalMin: num('reSignalMin', 60),
  // --- maliyet ---
  feeBps: num('feeBps', 5),
  extraSlipBps: num('extraSlipBps', 5),
  partialOn: num('partialOn', 1),
  tp1Frac: num('tp1Frac', 0.5),
  beAfterTp1: num('beAfterTp1', 1),
  limitWaitBars: num('limitWaitBars', 8),
  minGroupN: num('minGroupN', 30),
};

const str = (k, d = '') => (process.env[k] ?? d).trim();
const bool = (k, d = false) => {
  const v = process.env[k];
  if (v === undefined || v === '') return d;
  return /^(1|true|yes|on|evet)$/i.test(v.trim());
};

export const ENV = {
  // --- Telegram ---
  botToken: str('TELEGRAM_BOT_TOKEN'),
  freeChat: str('FREE_CHANNEL_ID'),     // @cryptopumpradarr veya -100...
  vipChat: str('VIP_CHANNEL_ID'),       // -100... (özel kanal, @ yok)
  vipInviteLink: str('VIP_INVITE_LINK', 'https://t.me/+B6q_nphrEu1mMjk0'),
  freeLink: str('FREE_CHANNEL_LINK', 'https://t.me/cryptopumpradarr'),
  adminIds: str('ADMIN_IDS').split(',').map((x) => x.trim()).filter(Boolean),

  // --- tarama ---
  tf: str('SCAN_TF', '15m'),
  scanMinChg: Number(str('SCAN_MIN_CHG', '8')),   // 24s min % hareket
  scanTop: Number(str('SCAN_TOP', '60')),         // her yönde kaç coin
  scanIntervalSec: Number(str('SCAN_INTERVAL_SEC', '90')),
  scanDir: str('SCAN_DIR', 'both'),               // both | S | L
  minGradeVip: str('MIN_GRADE_VIP', 'C'),         // VIP'e gidecek min sınıf
  minGradeFree: str('MIN_GRADE_FREE', 'B'),       // free'ye gidecek min sınıf
  freeDelayMin: Number(str('FREE_DELAY_MIN', '40')), // free gecikmesi (dk)
  wsConfirm: bool('WS_CONFIRM', true),            // sinyal öncesi canlı tape teyidi
  wsConfirmSec: Number(str('WS_CONFIRM_SEC', '45')),
  sectorCheck: bool('SECTOR_CHECK', true),        // CoinGecko sektör kontrolü

  // --- yayın ---
  postFree: bool('POST_FREE', true),
  postVip: bool('POST_VIP', true),
  dailyHour: Number(str('DAILY_HOUR', '9')),      // TR saati, günlük analiz
  weeklyDay: Number(str('WEEKLY_DAY', '1')),      // 1=Pazartesi
  monthlyDay: Number(str('MONTHLY_DAY', '1')),
  dryRun: bool('DRY_RUN', false),                 // true: Telegram'a göndermez, loglar

  // --- Supabase ---
  sbUrl: str('SUPABASE_URL'),
  sbKey: str('SUPABASE_SERVICE_ROLE_KEY'),

  // --- NOWPayments ---
  npApiKey: str('NOWPAYMENTS_API_KEY'),
  npIpnSecret: str('NOWPAYMENTS_IPN_SECRET'),
  npCurrency: str('NOWPAYMENTS_CURRENCY', 'usd'),
  publicUrl: str('PUBLIC_URL').replace(/\/+$/, ''), // https://xxx.up.railway.app
  port: Number(str('PORT', '3000')),

  // --- fiyatlandırma ---
  plans: (() => {
    // PLANS="1ay:49,3ay:129,12ay:399"  (USD)
    const raw = str('PLANS', '1ay:49:30,3ay:129:90,12ay:399:365');
    return raw.split(',').map((p) => {
      const [name, price, days] = p.split(':').map((x) => x.trim());
      return { name, price: Number(price), days: Number(days) };
    }).filter((p) => p.name && p.price > 0 && p.days > 0);
  })(),
};

export const GRADES = ['D', 'C', 'B', 'A'];
export const gradeAtLeast = (g, min) =>
  GRADES.indexOf(g) >= GRADES.indexOf(min);

// Eksik zorunlu ayarları döndürür (boş dizi = her şey tamam)
export function missingEnv() {
  const miss = [];
  if (!ENV.botToken) miss.push('TELEGRAM_BOT_TOKEN');
  if (!ENV.freeChat && ENV.postFree) miss.push('FREE_CHANNEL_ID');
  if (!ENV.vipChat && ENV.postVip) miss.push('VIP_CHANNEL_ID');
  if (!ENV.sbUrl) miss.push('SUPABASE_URL');
  if (!ENV.sbKey) miss.push('SUPABASE_SERVICE_ROLE_KEY');
  return miss;
}
