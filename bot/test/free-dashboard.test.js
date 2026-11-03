// Free vitrin kapısı, takipli link, eğitim ve dashboard testleri.
// Ağ gerektirmez.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyFreeCandidate } from '../src/publisher.js';
import * as M from '../src/messages.js';
import { LESSONS, lessonById } from '../src/lessons.js';
import { keyOk, dashHtml } from '../src/dashboard.js';
import { ENV } from '../src/config.js';

const env = {
  minGradeFree: 'B',
  freeOnlyWinning: true,
  freeMinOpenR: 0.5,
  freePendingMaxH: 14,
};
const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const agoMin = (m) => new Date(NOW - m * 60_000).toISOString();

const sig = (over = {}) => ({
  key: 'PEPEUSDTS1', symbol: 'PEPEUSDT', dir: 'S', tf: '15m',
  grade: 'A', type: 'SHORT SQUEEZE', status: 'takip',
  ex_n: 4, tr_n: 2, trg: 'likidite süpürmesi', why: 'imp +34.20% · OI -8.10%',
  entry: 0.00001234, stop: 0.00001301, tp1: 0.00001156, tp2: 0.00001098,
  rr: 1.16, decimals: 8, teyit_ps: 11, teyit_av: 16, qty: 81000,
  session: 'avrupa', created_at: agoMin(60),
  ...over,
});

/* ======================= FREE VİTRİN KAPISI ======================= */
test('kazanan açık pozisyon yayınlanır (showcase)', () => {
  const v = classifyFreeCandidate(sig({ open_r: 1.2 }), NOW, env);
  assert.equal(v.action, 'post');
  assert.equal(v.kind, 'showcase');
  assert.equal(v.score, 1.2);
});

test('eşiğin tam üstü yayınlanır, altı beklemeye alınır', () => {
  assert.equal(classifyFreeCandidate(sig({ open_r: 0.5 }), NOW, env).action, 'post');
  assert.equal(classifyFreeCandidate(sig({ open_r: 0.49 }), NOW, env).action, 'wait');
});

test('zararda olan pozisyon YAYINLANMAZ, beklemeye alınır', () => {
  const v = classifyFreeCandidate(sig({ open_r: -0.8 }), NOW, env);
  assert.equal(v.action, 'wait', 'henüz vazgeçmemeli — kâra geçebilir');
  assert.match(v.why, /-0\.80R/);
});

test('süre aşımında zararda olan pozisyondan vazgeçilir', () => {
  const v = classifyFreeCandidate(
    sig({ open_r: -0.2, created_at: agoMin(15 * 60) }), NOW, env);
  assert.equal(v.action, 'skip');
  assert.match(v.why, /14 saatte kâra geçmedi/);
});

test('süre aşımı olsa bile KAZANIYORSA yayınlanır', () => {
  const v = classifyFreeCandidate(
    sig({ open_r: 1.5, created_at: agoMin(20 * 60) }), NOW, env);
  assert.equal(v.action, 'post');
  assert.equal(v.kind, 'showcase');
});

test('gecikme dolmadan kârda kapanmışsa sonuç kartı yayınlanır', () => {
  const v = classifyFreeCandidate(sig({
    status: 'kazanç', closed_at: agoMin(10), r: 1.16, r_net: 1.12,
  }), NOW, env);
  assert.equal(v.action, 'post');
  assert.equal(v.kind, 'result');
  assert.equal(v.score, 1.12, 'net R kullanılmalı, brüt değil');
});

test('zararla kapanmış sinyal free kanala HİÇ gitmez', () => {
  const v = classifyFreeCandidate(sig({
    status: 'kayıp', closed_at: agoMin(10), r: -1, r_net: -1.04,
  }), NOW, env);
  assert.equal(v.action, 'skip');
  assert.match(v.why, /kapandı -1\.04R/);
});

test('sınıf eşiğinin altı atlanır', () => {
  const v = classifyFreeCandidate(sig({ grade: 'C', open_r: 3 }), NOW, env);
  assert.equal(v.action, 'skip');
  assert.match(v.why, /sınıf C < B/);
});

test('risk kapısında atlanan ve dolmayan sinyaller free\'ye gitmez', () => {
  assert.equal(classifyFreeCandidate(sig({ status: 'atlandı', open_r: 2 }), NOW, env).action, 'skip');
  assert.equal(classifyFreeCandidate(sig({ status: 'dolmadı', open_r: 2 }), NOW, env).action, 'skip');
});

test('freeOnlyWinning kapalıyken zararda olan da yayınlanır', () => {
  const gevsek = { ...env, freeOnlyWinning: false };
  assert.equal(classifyFreeCandidate(sig({ open_r: -0.9 }), NOW, gevsek).action, 'post');
  assert.equal(classifyFreeCandidate(sig({
    status: 'kayıp', closed_at: agoMin(5), r_net: -1.04,
  }), NOW, gevsek).action, 'post');
});

test('open_r hiç yoksa 0 sayılır ve beklemeye alınır', () => {
  const v = classifyFreeCandidate(sig({ open_r: undefined }), NOW, env);
  assert.equal(v.action, 'wait');
});

/* ======================= VİTRİN MESAJI ======================= */
test('freeShowcase: fiyat sızdırmaz, yön ve R gösterir', () => {
  const s = sig({ open_r: 1.35 });
  const { text, reply_markup } = M.freeShowcase(s, 1.35);

  // en kritik kontrol
  ['0.00001234', '0.00001301', '0.00001156', '0.00001098'].forEach((px) => {
    assert.ok(!text.includes(px), `fiyat sızdı: ${px}`);
  });
  assert.ok(!/R:R/.test(text), 'R:R sızmamalı');
  assert.ok(!/Entry/.test(text), 'no entry label');

  // göstermesi gerekenler
  assert.match(text, /LIVE POSITION — IN PROFIT/);
  assert.match(text, /PEPE/);
  assert.match(text, /SHORT/);
  assert.match(text, /\+1\.35R/);
  assert.match(text, /4\/5/, 'exhaustion confirmations');
  assert.match(text, /Not financial advice/);
  assert.ok(reply_markup?.inline_keyboard?.[0]?.[0]?.url, 'VIP butonu olmalı');
  assert.ok(!/undefined|NaN/.test(text));
});

test('freeShowcase: LONG yönünde de doğru', () => {
  const { text } = M.freeShowcase(sig({ dir: 'L', open_r: 0.9 }), 0.9);
  assert.match(text, /LONG/);
  assert.ok(!/SHORT/.test(text));
});

test('freeShowcase: "yön tek başına yetmez" argümanı var (dönüşüm mesajı)', () => {
  const { text } = M.freeShowcase(sig({ open_r: 1 }), 1);
  assert.match(text, /where to enter, where to stop/);
});

/* ======================= TAKİPLİ LİNK ======================= */
test('vipUrl: without PUBLIC_URL it is the bot deep link, never an invite link', () => {
  const saved = [ENV.publicUrl, ENV.botUsername];
  ENV.publicUrl = '';
  ENV.botUsername = 'my_bot';
  try {
    assert.equal(M.vipUrl('showcase', 'K1'), 'https://t.me/my_bot?start=vip_showcase');
  } finally { [ENV.publicUrl, ENV.botUsername] = saved; }
});

test('vipUrl: PUBLIC_URL varsa kaynak ve sinyal anahtarıyla takipli link', () => {
  const saved = ENV.publicUrl;
  ENV.publicUrl = 'https://bot.up.railway.app';
  try {
    const u = new URL(M.vipUrl('showcase', 'PEPEUSDTS1'));
    assert.equal(u.origin + u.pathname, 'https://bot.up.railway.app/go/vip');
    assert.equal(u.searchParams.get('s'), 'showcase');
    assert.equal(u.searchParams.get('k'), 'PEPEUSDTS1');
  } finally { ENV.publicUrl = saved; }
});

test('vipUrl: sinyal anahtarı yoksa k parametresi eklenmez', () => {
  const saved = ENV.publicUrl;
  ENV.publicUrl = 'https://bot.up.railway.app';
  try {
    const u = new URL(M.vipUrl('daily'));
    assert.equal(u.searchParams.get('s'), 'daily');
    assert.equal(u.searchParams.has('k'), false);
  } finally { ENV.publicUrl = saved; }
});

test('her free şablonu farklı kaynak etiketi taşır (dönüşüm ölçümü için)', () => {
  const saved = ENV.publicUrl;
  ENV.publicUrl = 'https://bot.up.railway.app';
  try {
    const src = (rm) => new URL(rm.inline_keyboard[0][0].url).searchParams.get('s');
    const s = sig({ open_r: 1 });
    assert.equal(src(M.freeShowcase(s, 1).reply_markup), 'showcase');
    assert.equal(src(M.freeTeaser(s).reply_markup), 'teaser');
    assert.equal(src(M.dailyFree({
      reg: null, dvol: null, breadth: null, movers: [],
      scanned: 0, watching: 0, openN: 0, yesterday: null,
    }).reply_markup), 'daily');
    assert.equal(src(M.eduPost(LESSONS[0], { forFree: true }).reply_markup), 'edu');
  } finally { ENV.publicUrl = saved; }
});

/* ======================= EĞİTİM ======================= */
test('ders kütüphanesi: id tekrarı yok, alanlar dolu', () => {
  assert.ok(LESSONS.length >= 20, 'en az 20 ders olmalı, var: ' + LESSONS.length);
  const ids = LESSONS.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, 'id tekrarı var');
  LESSONS.forEach((l) => {
    assert.ok(l.id && l.title && l.body && l.tag, 'eksik alan: ' + l.id);
    assert.ok(l.body.length > 200, 'ders çok kısa (dolgu içerik?): ' + l.id);
  });
});

test('her ders Telegram mesaj limitinin altında', () => {
  LESSONS.forEach((l) => {
    const free = M.eduPost(l, { forFree: true, idx: 1, total: LESSONS.length }).text;
    const vip = M.eduPost(l, { forFree: false }).text;
    assert.ok(free.length <= 4096, `${l.id} free sürümü ${free.length} karakter`);
    assert.ok(vip.length <= 4096, `${l.id} vip sürümü ${vip.length} karakter`);
  });
});

test('eduPost: free sürümünde VIP çağrısı var, VIP sürümünde yok', () => {
  const l = LESSONS[0];
  const free = M.eduPost(l, { forFree: true });
  const vip = M.eduPost(l, { forFree: false });
  assert.ok(free.reply_markup, 'free\'de buton olmalı');
  assert.ok(!vip.reply_markup, 'VIP\'te buton olmamalı — üye zaten içeride');
  assert.match(free.text, /24\/7/);
  assert.ok(!/Join VIP/.test(vip.text));
});

test('eduPost: ders numarası gösterilir', () => {
  const { text } = M.eduPost(LESSONS[0], { forFree: false, idx: 3, total: 25 });
  assert.match(text, /lesson 3\/25/);
});

test('lessonById çalışır', () => {
  assert.equal(lessonById(LESSONS[0].id).title, LESSONS[0].title);
  assert.equal(lessonById('olmayan-ders'), null);
});

test('dersler sistemin gerçek kavramlarını kapsıyor', () => {
  const hepsi = LESSONS.map((l) => l.id + ' ' + l.title + ' ' + l.body).join(' ').toLowerCase();
  ['open interest', 'liquidity sweep', 'cvd', 'avwap', 'atr',
    'poc', 'funding', 'liquidation', 'position size', 'stop',
  ].forEach((k) => assert.ok(hepsi.includes(k), 'missing topic: ' + k));
});

/* ======================= DASHBOARD ======================= */
test('keyOk: anahtar yoksa dashboard kapalı', () => {
  const saved = ENV.dashKey;
  ENV.dashKey = '';
  try {
    assert.equal(keyOk(''), false);
    assert.equal(keyOk('herhangi'), false);
  } finally { ENV.dashKey = saved; }
});

test('keyOk: doğru anahtar geçer, yanlış geçmez', () => {
  const saved = ENV.dashKey;
  ENV.dashKey = 'cok-uzun-ve-rastgele-bir-anahtar-123';
  try {
    assert.equal(keyOk('cok-uzun-ve-rastgele-bir-anahtar-123'), true);
    assert.equal(keyOk('yanlis'), false);
    assert.equal(keyOk(''), false);
    assert.equal(keyOk(null), false);
    assert.equal(keyOk(undefined), false);
    // uzunluk aynı ama içerik farklı
    assert.equal(keyOk('cok-uzun-ve-rastgele-bir-anahtar-124'), false);
  } finally { ENV.dashKey = saved; }
});

test('dashHtml: geçerli HTML, anahtarı gömmez, beklenen bölümler var', () => {
  const h = dashHtml();
  assert.match(h, /^<!doctype html>/i);
  assert.match(h, /<\/html>/);
  // Şablon statik: hiç yer tutucu kalmamalı ve nesne basılmamalı.
  // (sayfanın kendi JS'inde "undefined" geçer — o bir null kontrolü, hata değil)
  assert.ok(!h.includes('${'), 'çözülmemiş şablon yer tutucusu var');
  assert.ok(!h.includes('[object Object]'), 'nesne basılmış');
  // veriyi tarayıcı çeker, sunucu HTML'e gömmez
  assert.ok(!/"ts":|"para":|"performans":\s*\{/.test(h), 'veri HTML\'e gömülmemeli');

  // anahtar sayfaya gömülmemeli — tarayıcı URL'den okur
  const saved = ENV.dashKey;
  ENV.dashKey = 'GIZLI-ANAHTAR-XYZ';
  try {
    assert.ok(!dashHtml().includes('GIZLI-ANAHTAR-XYZ'), 'anahtar HTML\'e gömülmemeli');
  } finally { ENV.dashKey = saved; }

  // beklenen bölümler
  ['para', 'performans', 'kanal & ilgi', 'son sinyaller',
    'açık pozisyonlar', 'son ödemeler', 'günlük net R',
  ].forEach((k) => assert.ok(h.includes(k), 'eksik bölüm: ' + k));

  // arama motorlarına kapalı olduğunu belirten uç sunucuda; sayfada veri çekme var
  assert.match(h, /\/api\/dash\?key=/);
  assert.match(h, /setInterval\(load, 60000\)/, '60 sn\'de bir yenilemeli');
});

test('dashHtml: XSS kaçışı yapan yardımcı var', () => {
  const h = dashHtml();
  assert.match(h, /const esc = s =>/, 'dışarıdan gelen metinler kaçışlanmalı');
  // tablo satırları esc() ile basılıyor mu
  assert.match(h, /esc\(sym\(s\.sembol\)\)/);
});

/* ======================= DRY_RUN KAPSAMI (regresyon) ======================= */
import { isChannel } from '../src/telegram.js';

test('isChannel: kanal/grup ile özel sohbeti ayırt eder', () => {
  // kanal ve gruplar: @kullaniciadi veya negatif id
  ['@cryptopumpradarr', '-1001234567890', -1001234567890, '-100123'].forEach((id) =>
    assert.equal(isChannel(id), true, `kanal sayılmalı: ${id}`));
  // özel sohbet: pozitif sayı
  ['1173394657', 1173394657, 123].forEach((id) =>
    assert.equal(isChannel(id), false, `özel sohbet sayılmalı: ${id}`));
});

test('DRY_RUN sadece kanalları kapsar — DM komut cevapları hep gider', () => {
  /* Bu kritik: DRY_RUN tüm gönderimleri sustursaydı /start, /id ve /kanallar
     cevapsız kalır, kullanıcı kanal id'lerini öğrenemez ve kurulum yapamazdı.
     Canlıda tam olarak bu yaşandı; test geri gelmesini engelliyor. */
  assert.equal(isChannel(ENV.freeChat || '@kanal'), true,
    'free kanal hedefi kanal sayılmalı (DRY_RUN sustursun)');
  assert.equal(isChannel(1173394657), false,
    'kullanıcı DM hedefi kanal SAYILMAMALI (DRY_RUN susturmasın)');
});
