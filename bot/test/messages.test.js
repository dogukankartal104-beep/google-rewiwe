// Mesaj şablonları ve dönem anahtarları. Şablon çökmesi üretimde yayını durdurur,
// bu yüzden her şablon eksik/null alanlarla da denenir.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as M from '../src/messages.js';
import { dayKey, weekKey, monthKey } from '../src/publisher.js';
import { stats } from '../src/tracker.js';
import { ENV } from '../src/config.js';

const sig = {
  key: 'PEPEUSDTS1', symbol: 'PEPEUSDT', dir: 'S', tf: '15m',
  grade: 'A', type: 'SHORT SQUEEZE', verdict: 'SHORT', qual: 78,
  entry: 0.00001234, stop: 0.00001301, tp1: 0.00001156, tp2: 0.00001098,
  tp1_label: 'POC', rr: 1.16, risk_pct: 5.43, qty: 81000, decimals: 8,
  ex_n: 4, tr_n: 2, teyit_ps: 11, teyit_av: 16,
  why: 'imp +34.20% · OI -8.10% · f/OI 4.2× · tepeden -6.10%',
  trg: 'likidite süpürmesi, aVWAP reddi',
  leg: 34.2, oi_chg: -8.1, oi_ratio: 4.2, sweep: true,
  atr_pct: 1.8, vol_ratio: 1.4, bars_stop: 2, bars_tp: 5,
  cost_r: 0.04, session: 'avrupa', status: 'takip',
  open_r: 0.6,
  created_at: new Date(Date.now() - 42 * 60_000).toISOString(),
};

const closed = {
  ...sig, status: 'kazanç', r: 1.16, r_net: 1.12,
  close_px: 0.00001156, max_r: 1.4, min_r: -0.3, partial: true,
  closed_at: new Date().toISOString(),
  free_posted_at: new Date(Date.now() - 2 * 60_000).toISOString(),
  free_msg_id: 5, vip_msg_id: 4,
};

const hasNoUndefined = (s) => {
  assert.ok(!/undefined/.test(s), 'metinde "undefined" olmamalı:\n' + s);
  assert.ok(!/\bNaN\b/.test(s), 'metinde "NaN" olmamalı:\n' + s);
  assert.ok(!/\[object Object\]/.test(s), 'nesne basılmamalı:\n' + s);
};

// Telegram HTML parse_mode'da sadece belirli etiketler geçerli
const ALLOWED = ['b', 'i', 'u', 's', 'code', 'pre', 'a', 'em', 'strong', 'br',
  'blockquote', 'tg-spoiler'];
function checkHtml(s) {
  const tags = [...s.matchAll(/<\/?([a-z][a-z0-9-]*)/gi)].map((m) => m[1].toLowerCase());
  tags.forEach((t) => assert.ok(ALLOWED.includes(t), `izinsiz HTML etiketi <${t}> :\n` + s));
  // açılış/kapanış dengesi
  for (const t of new Set(tags)) {
    if (t === 'br') continue;
    const open = (s.match(new RegExp(`<${t}(\\s[^>]*)?>`, 'gi')) || []).length;
    const close = (s.match(new RegExp(`</${t}>`, 'gi')) || []).length;
    assert.equal(open, close, `<${t}> etiketi dengesiz (${open} açık / ${close} kapalı)`);
  }
}

/* ======================= SİNYAL ŞABLONLARI ======================= */
test('vipSignal: tüm plan alanlarını içerir ve HTML geçerli', () => {
  const s = M.vipSignal(sig);
  hasNoUndefined(s);
  checkHtml(s);
  assert.match(s, /SHORT/);
  assert.match(s, /PEPE/);
  assert.ok(!/PEPEUSDT/.test(s), 'USDT eki sadeleştirilmeli');
  assert.match(s, /Entry/);
  assert.match(s, /Stop/);
  assert.match(s, /TP1/);
  assert.match(s, /TP2/);
  assert.match(s, /R:R/);
  assert.match(s, /0\.00001234/, 'entry must print with 8 decimals');
  assert.match(s, /Not financial advice/, 'disclaimer required');
});

test('vipSignal: TP2 yoksa o satır çıkmaz, çökmez', () => {
  const s = M.vipSignal({ ...sig, tp2: null });
  hasNoUndefined(s);
  checkHtml(s);
  assert.ok(!/TP2/.test(s));
});

test('vipSignal: eksik alanlarla çökmez', () => {
  const s = M.vipSignal({
    symbol: 'XUSDT', dir: 'L', tf: '15m', grade: 'C',
    entry: 1, stop: 0.9, tp1: 1.1, created_at: new Date().toISOString(),
    teyit_ps: 0, teyit_av: 0, ex_n: 3, tr_n: 1, qty: 10, session: 'asya',
  });
  hasNoUndefined(s);
  checkHtml(s);
  assert.match(s, /LONG/);
});

test('freeTeaser: plan fiyatlarını SIZDIRMAZ', () => {
  const { text, reply_markup } = M.freeTeaser(sig, { openR: sig.open_r });
  hasNoUndefined(text);
  checkHtml(text);
  // en kritik kontrol: free kanalda giriş/stop/hedef görünmemeli
  assert.ok(!text.includes('0.00001234'), 'giriş fiyatı free\'ye sızmamalı');
  assert.ok(!text.includes('0.00001301'), 'stop free\'ye sızmamalı');
  assert.ok(!text.includes('0.00001156'), 'TP1 free\'ye sızmamalı');
  assert.ok(!text.includes('0.00001098'), 'TP2 free\'ye sızmamalı');
  assert.ok(!/R:R/.test(text), 'R:R must not leak to free');
  // ama değer göstermeli
  assert.match(text, /PEPE/);
  assert.match(text, /SHORT/);
  assert.match(text, /Grade/);
  assert.match(text, /VIP/);
  assert.ok(reply_markup?.inline_keyboard?.[0]?.[0]?.url, 'VIP butonu olmalı');
});

test('freeTeaser: gecikme süresini insan diline çevirir', () => {
  const { text } = M.freeTeaser({
    ...sig, created_at: new Date(Date.now() - 95 * 60_000).toISOString(),
  });
  assert.match(text, /1h 35m ago/);
});

test('freeTeaser: açık R yoksa o satır çıkmaz', () => {
  const { text } = M.freeTeaser(sig, { openR: null });
  hasNoUndefined(text);
  assert.ok(!/Currently:/.test(text));
});

/* ======================= SONUÇ KARTI ======================= */
test('resultCard (VIP): kazanç sonucunu net R ile gösterir', () => {
  const { text } = M.resultCard(closed, { forFree: false });
  hasNoUndefined(text);
  checkHtml(text);
  assert.match(text, /TARGET HIT/);
  assert.match(text, /\+1\.12R/, 'net R must be shown');
  assert.match(text, /partial exit/);
});

test('resultCard (free): VIP vurgusu ve buton var', () => {
  const { text, reply_markup } = M.resultCard(closed, { forFree: true });
  hasNoUndefined(text);
  checkHtml(text);
  assert.match(text, /VIP channel/);
  assert.ok(reply_markup?.inline_keyboard, 'free result card needs the VIP button');
});

test('resultCard: kayıpta dürüst dil kullanır, kazanç gibi göstermez', () => {
  const lost = { ...closed, status: 'kayıp', r: -1, r_net: -1.04, close_px: 0.00001301 };
  const { text } = M.resultCard(lost, { forFree: true });
  hasNoUndefined(text);
  assert.match(text, /STOPPED OUT/);
  assert.match(text, /-1\.04R/);
  assert.ok(!/TARGET HIT/.test(text), 'a loss must not read like a win');
  assert.match(text, /knew the risk|manages losses/,
    'honest but reassuring language on a loss');
});

test('resultCard: süre dolması ayrı başlıkla görünür', () => {
  const { text } = M.resultCard({ ...closed, status: 'zaman', r: 0.2, r_net: 0.16 });
  assert.match(text, /TIME EXIT/);
});

/* ======================= PERFORMANS TABLOSU ======================= */
const rows = [
  { status: 'kazanç', r: 1.2, r_net: 1.15, dir: 'S', grade: 'A', symbol: 'AUSDT', closed_at: '2026-10-28T10:00:00Z' },
  { status: 'kayıp', r: -1, r_net: -1.05, dir: 'S', grade: 'B', symbol: 'BUSDT', closed_at: '2026-10-29T10:00:00Z' },
  { status: 'kazanç', r: 2, r_net: 1.95, dir: 'L', grade: 'A', symbol: 'CUSDT', closed_at: '2026-10-30T10:00:00Z' },
  { status: 'zaman', r: 0.3, r_net: 0.25, dir: 'L', grade: 'C', symbol: 'DUSDT', closed_at: '2026-10-31T10:00:00Z' },
];

test('perfTable: gerçek istatistikten tablo üretir', () => {
  const st = stats(rows);
  const { text } = M.perfTable(st, {
    title: 'WEEKLY PERFORMANCE', periodLabel: 'Oct 27 – Nov 2', forFree: false,
  });
  hasNoUndefined(text);
  checkHtml(text);
  assert.match(text, /WEEKLY PERFORMANCE/);
  assert.match(text, /Trades/);
  assert.match(text, /4/, 'trade count');
  assert.match(text, /\+2\.30R/, 'net total: ' + st.tot);
  assert.match(text, /BY GRADE/);
  assert.match(text, /BY DIRECTION/);
  assert.match(text, /NET/, 'must state the figures are net');
});

test('perfTable: boş dönemde uydurma sayı üretmez', () => {
  const { text } = M.perfTable(stats([]), {
    title: 'WEEKLY PERFORMANCE', periodLabel: 'test', forFree: true,
  });
  hasNoUndefined(text);
  assert.match(text, /No trades closed/);
  assert.ok(!/Trades\s+\d/.test(text), 'no table for an empty period');
});

test('perfTable: free sürümünde VIP butonu ve üye sayısı', () => {
  const { text, reply_markup } = M.perfTable(stats(rows), {
    title: 'MONTHLY PERFORMANCE', periodLabel: 'October', forFree: true, memberCount: 42,
  });
  assert.match(text, /42 members/);
  assert.ok(reply_markup?.inline_keyboard);
});

test('perfTable: zarar eden dönemi de dürüst gösterir', () => {
  const bad = [
    { status: 'kayıp', r: -1, r_net: -1.05, dir: 'S', grade: 'B', symbol: 'X', closed_at: '2026-10-28T10:00:00Z' },
    { status: 'kayıp', r: -1, r_net: -1.05, dir: 'S', grade: 'C', symbol: 'Y', closed_at: '2026-10-29T10:00:00Z' },
  ];
  const st = stats(bad);
  const { text } = M.perfTable(st, { title: 'WEEKLY', periodLabel: 'x', forFree: true });
  hasNoUndefined(text);
  assert.match(text, /-2\.10R/, 'losses must not be hidden');
  assert.ok(st.tot < 0);
});

/* ======================= GÜNLÜK ANALİZ ======================= */
const dailyData = {
  reg: {
    btc: { p: 68000, m15: 0.1, h1: 0.4, h4: -0.8, d1: 1.2 },
    eth: { p: 2450.5, m15: 0.2, h1: 0.5, h4: -0.6, d1: 1.0 },
    label: 'yatay', score: 0,
  },
  dvol: { now: 48.2, chg: -3.1, pctl: 42 },
  shock: 1.1,
  breadth: { up: 18, dn: 7, n: 320, note: 'nötr' },
  movers: [{ s: 'WIFUSDT', c: 22.4, v: 180e6 }, { s: 'PEPEUSDT', c: -14.1, v: 90e6 }],
  scanned: 74,
  watching: 2,
  watchlist: [{
    symbol: 'WIFUSDT', dir: 'S', verdict: 'TETİK BEKLE', grade: 'B',
    ex_n: 4, tr_n: 0, trg: '', entry: 2.345, stop: 2.46, decimals: 4, qual: 61,
  }],
  openN: 1,
  open: [{ symbol: 'PEPEUSDT', dir: 'S', open_r: 0.6, stop: 0.00001301, tp1: 0.00001156, decimals: 8 }],
  yesterday: stats(rows),
  note: 'Rejim nötr. Sistem normal çalışıyor.',
};

test('dailyFree: analiz içerir ama izleme listesi seviyelerini vermez', () => {
  const { text, reply_markup } = M.dailyFree(dailyData);
  hasNoUndefined(text);
  checkHtml(text);
  assert.match(text, /DAILY MARKET BRIEF/);
  assert.match(text, /REGIME/);
  assert.match(text, /MARKET BREADTH/);
  assert.match(text, /WIF/);
  assert.ok(!text.includes('2.345'), 'watchlist zone must not leak to free');
  assert.ok(!text.includes('2.46'), 'watchlist stop must not leak to free');
  assert.ok(reply_markup?.inline_keyboard);
});

test('dailyVip: izleme listesi seviyelerini ve açık pozisyonları verir', () => {
  const { text } = M.dailyVip(dailyData);
  hasNoUndefined(text);
  checkHtml(text);
  assert.match(text, /VIP DAILY BRIEFING/);
  assert.match(text, /WATCHLIST/);
  assert.match(text, /2\.3450/, 'VIP sees the watchlist zone');
  assert.match(text, /OPEN POSITIONS/);
  assert.match(text, /DVOL/);
});

test('dailyVip: veri yoksa (ilk gün) çökmez', () => {
  const { text } = M.dailyVip({
    reg: null, dvol: null, shock: null, breadth: null,
    movers: [], scanned: 0, watching: 0, watchlist: [], openN: 0, open: [],
    yesterday: null, note: null,
  });
  hasNoUndefined(text);
  checkHtml(text);
  assert.match(text, /nothing qualifying/);
});

test('dailyFree: veri yoksa çökmez', () => {
  const { text } = M.dailyFree({
    reg: null, dvol: null, breadth: null, movers: [],
    scanned: null, watching: 0, openN: 0, yesterday: null,
  });
  hasNoUndefined(text);
  checkHtml(text);
});

test('dailyRecapFree: işlem olan ve olmayan günü ayrı anlatır', () => {
  const a = M.dailyRecapFree(stats(rows), 1);
  hasNoUndefined(a.text);
  checkHtml(a.text);
  assert.match(a.text, /DAILY CLOSE/);
  assert.match(a.text, /\+2\.30R/);

  const b = M.dailyRecapFree(stats([]), 0);
  hasNoUndefined(b.text);
  assert.match(b.text, /No trades closed today/);
});

/* ======================= DM ŞABLONLARI ======================= */
test('startMsg / nasilMsg: geçerli ve bilgilendirici', () => {
  const a = M.startMsg('Ahmet');
  hasNoUndefined(a); checkHtml(a);
  assert.match(a, /Ahmet/);
  assert.match(a, /\/vip/);

  const b = M.howMsg();
  hasNoUndefined(b); checkHtml(b);
  assert.match(b, /FADE/);
  assert.match(b, /liquidity sweep/i);
  assert.match(b, /Not financial advice/);
});

test('startMsg: isim yoksa çökmez', () => {
  const a = M.startMsg(undefined);
  hasNoUndefined(a);
});

test('vipMsg: planları ve aylık karşılığını listeler', () => {
  const plans = [
    { name: '1ay', price: 49, days: 30 },
    { name: '3ay', price: 129, days: 90 },
    { name: '12ay', price: 399, days: 365 },
  ];
  const s = M.vipMsg(plans);
  hasNoUndefined(s); checkHtml(s);
  assert.match(s, /\$49/);
  assert.match(s, /\$129/);
  assert.match(s, /\$43\/mo/, 'monthly equivalent for the 3-month plan');
  assert.match(s, /does not guarantee/, 'past-performance warning required');
});

test('planKeyboard: her plan için buton üretir', () => {
  const kb = M.planKeyboard([{ name: '1ay', price: 49, days: 30 }]);
  assert.equal(kb.inline_keyboard.length, 1);
  assert.equal(kb.inline_keyboard[0][0].callback_data, 'buy:1ay');
});

test('invoiceMsg / grantMsg / statusMsg / expire mesajları geçerli', () => {
  const inv = M.invoiceMsg({ name: '1ay', price: 49 }, 'https://nowpayments.io/payment/x');
  hasNoUndefined(inv); checkHtml(inv);
  assert.match(inv, /nowpayments/);

  const g = M.grantMsg('1ay', Date.now() + 30 * 864e5, 'https://t.me/+abc');
  hasNoUndefined(g); checkHtml(g);
  assert.match(g, /access is live/);

  const s1 = M.statusMsg({ status: 'aktif', plan: '3ay', expires_at: new Date(Date.now() + 10 * 864e5).toISOString() });
  hasNoUndefined(s1); checkHtml(s1);
  assert.match(s1, /10 day/);

  const s2 = M.statusMsg(null);
  hasNoUndefined(s2);
  assert.match(s2, /no active VIP/);

  const e1 = M.expireSoonMsg(3, 'https://t.me/+abc');
  hasNoUndefined(e1); checkHtml(e1);
  const e2 = M.expiredMsg();
  hasNoUndefined(e2); checkHtml(e2);
});

/* ======================= DÖNEM ANAHTARLARI ======================= */
test('dayKey: TR gününe göre YYYY-MM-DD', () => {
  // 2026-11-03 00:30 UTC -> TR 03:30, aynı gün
  assert.equal(dayKey(Date.UTC(2026, 10, 3, 0, 30)), '2026-11-03');
  // 2026-11-02 22:30 UTC -> TR 01:30 (3 Kasım)
  assert.equal(dayKey(Date.UTC(2026, 10, 2, 22, 30)), '2026-11-03');
  // 2026-11-03 20:00 UTC -> TR 23:00, hâlâ 3 Kasım
  assert.equal(dayKey(Date.UTC(2026, 10, 3, 20, 0)), '2026-11-03');
});

test('monthKey: YYYY-MM', () => {
  assert.equal(monthKey(Date.UTC(2026, 10, 15, 12)), '2026-11');
  assert.equal(monthKey(Date.UTC(2026, 0, 1, 12)), '2026-01');
});

test('weekKey: ISO hafta, aynı haftanın günleri aynı anahtar', () => {
  // 2026-11-02 Pazartesi, 2026-11-08 Pazar -> aynı ISO hafta
  const mon = weekKey(Date.UTC(2026, 10, 2, 12));
  const sun = weekKey(Date.UTC(2026, 10, 8, 12));
  assert.equal(mon, sun, `${mon} === ${sun}`);
  assert.match(mon, /^\d{4}-W\d{2}$/);
  // sonraki Pazartesi farklı olmalı
  assert.notEqual(weekKey(Date.UTC(2026, 10, 9, 12)), mon);
});

test('weekKey: yıl sınırını doğru geçer', () => {
  const k = weekKey(Date.UTC(2026, 11, 31, 12));
  assert.match(k, /^\d{4}-W\d{2}$/);
  hasNoUndefined(k);
});

/* ======================= AYAR DOĞRULAMA ======================= */
test('PLANS ayarı doğru ayrıştırılır', () => {
  ENV.plans.forEach((p) => {
    assert.ok(p.name, 'plan adı olmalı');
    assert.ok(p.price > 0, 'fiyat pozitif');
    assert.ok(p.days > 0, 'gün sayısı pozitif');
  });
  assert.ok(ENV.plans.length >= 1, 'en az bir plan tanımlı olmalı');
});
