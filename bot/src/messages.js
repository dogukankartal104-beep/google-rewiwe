// Telegram mesaj şablonları. VIP = tam plan, FREE = gecikmeli teaser + sonuç.
import { ENV, CFG } from './config.js';
import { fmt, pct, shortn, trDateTime, trClock, trShort, dur, seans } from './util.js';

const UYARI = 'Yatırım tavsiyesi değildir. Kaldıraçlı işlem sermayenizin tamamını kaybettirebilir.';
const sym = (s) => s.replace('USDT', '');
const ok = (b) => (b ? '✅' : '◻️');
const dirIcon = (d) => (d === 'L' ? '🟢 LONG' : '🔴 SHORT');
const dirArrow = (d) => (d === 'L' ? '▲' : '▼');

/* VIP butonu. PUBLIC_URL varsa link bot üzerinden yönlendirilir, böylece
   "kaç kişi gerçekten ilgilendi" ölçülebilir (Telegram Bot API gönderi
   görüntülenmesini vermiyor, tıklama ondan daha değerli bir metrik). */
export function vipUrl(source = 'free', signalKey = null) {
  if (!ENV.publicUrl) return ENV.vipInviteLink;
  const u = new URL(ENV.publicUrl + '/go/vip');
  u.searchParams.set('s', source);
  if (signalKey) u.searchParams.set('k', signalKey);
  return u.toString();
}

const vipBtn = (source = 'free', signalKey = null, text = '⭐ VIP\'e katıl') => ({
  inline_keyboard: [[{ text, url: vipUrl(source, signalKey) }]],
});

// Giriş fiyatına göre yüzde
const yz = (v, en) => (v == null || en == null ? '' : ` <i>(${pct(((v - en) / en) * 100)})</i>`);

/* ============================================================
   VIP SİNYAL — tam plan, anında
   ============================================================ */
export function vipSignal(s) {
  const D = s.decimals ?? 4;
  const p = (v) => (v == null ? '—' : fmt(v, D));
  const L = s.dir === 'L';
  const usdRisk = (CFG.acct * CFG.riskPct) / 100;

  const lines = [];
  lines.push(`${dirIcon(s.dir)}  <b>${sym(s.symbol)}</b> · ${s.tf}`);
  lines.push(`Sınıf <b>${s.grade}</b> · ${String(s.type || '').toLowerCase()} · teyit ${s.teyit_ps}/${s.teyit_av}`);
  lines.push('');
  lines.push('<b>İŞLEM PLANI</b>');
  lines.push(`<code>Giriş   ${p(s.entry)}</code>`);
  lines.push(`<code>Stop    ${p(s.stop)}</code>${yz(s.stop, s.entry)}`);
  lines.push(`<code>TP1     ${p(s.tp1)}</code>${yz(s.tp1, s.entry)}`);
  if (s.tp2) lines.push(`<code>TP2     ${p(s.tp2)}</code>${yz(s.tp2, s.entry)}`);
  lines.push(`<code>R:R     ${s.rr ? fmt(s.rr, 2) : '—'}</code>`);
  lines.push('');
  lines.push('<b>POZİSYON</b>');
  lines.push(`Risk %${fmt(CFG.riskPct, 0)} → <b>$${fmt(usdRisk, 0)}</b> ($${shortn(CFG.acct)} hesapta)`);
  lines.push(`Miktar ≈ <b>${fmt(s.qty, s.qty > 100 ? 0 : 2)}</b> ${sym(s.symbol)}`);
  if (s.tp1_label) lines.push(`TP1 dayanağı: ${s.tp1_label}`);
  lines.push('');
  lines.push('<b>NEDEN</b>');
  lines.push(`Tükenme <b>${s.ex_n}/5</b> · Tetik <b>${s.tr_n}/4</b>`);
  if (s.trg) lines.push(`Tetik: ${s.trg}`);
  if (s.why) lines.push(`Veri: ${s.why}`);
  const bits = [];
  if (s.atr_pct != null) bits.push(`ATR %${fmt(s.atr_pct, 2)}`);
  if (s.vol_ratio != null) bits.push(`oynaklık ${fmt(s.vol_ratio, 2)}×`);
  if (s.bars_stop != null && s.bars_tp != null) bits.push(`süre ~${s.bars_tp} mum (stop ~${s.bars_stop})`);
  if (bits.length) lines.push(bits.join(' · '));
  lines.push(`Seans: ${s.session} · ${trDateTime(Date.parse(s.created_at))}`);
  lines.push('');
  lines.push(`<i>${UYARI}</i>`);
  return lines.join('\n');
}

/* ============================================================
   FREE TEASER — gecikmeli, plan YOK
   Amaç: değeri göster, kullanılabilirliği VIP'e bırak.
   ============================================================ */
export function freeTeaser(s, { openR = null } = {}) {
  const geciken = dur(Date.now() - Date.parse(s.created_at));
  const lines = [];
  lines.push(`📡 <b>SİNYAL VERİLDİ</b> · ${geciken} önce`);
  lines.push(`${dirArrow(s.dir)} <b>${sym(s.symbol)}</b> · ${s.dir === 'L' ? 'LONG' : 'SHORT'} · Sınıf <b>${s.grade}</b>`);
  lines.push('');
  lines.push(`Sistem üç fazlı onayı geçti:`);
  lines.push(`• Tip: ${String(s.type || '').toLowerCase()}`);
  lines.push(`• Tükenme onayı: <b>${s.ex_n}/5</b>`);
  lines.push(`• Tetik: ${s.trg || '—'}`);
  if (s.why) lines.push(`• Veri: ${s.why}`);
  lines.push('');
  if (openR != null && Number.isFinite(openR)) {
    const em = openR > 0.1 ? '🟢' : openR < -0.1 ? '🔴' : '⚪️';
    lines.push(`Şu an: <b>${openR > 0 ? '+' : ''}${fmt(openR, 2)}R</b> ${em}`);
    lines.push('');
  }
  lines.push(`Giriş, stop, hedef ve pozisyon boyutu <b>VIP kanalda ${geciken} önce</b> paylaşıldı.`);
  lines.push(`Sinyal anında almak için ⤵️`);
  lines.push('');
  lines.push(`<i>${UYARI}</i>`);
  return { text: lines.join('\n'), reply_markup: vipBtn('teaser', s.key) };
}

/* ============================================================
   FREE VİTRİN — "bakın bu pozisyon kazanıyor"
   Günde en fazla 1 tane, SADECE kârda olan pozisyon için.
   Fiyat vermez; coin + yön + o anki R + VIP çağrısı.
   ============================================================ */
export function freeShowcase(s, openR) {
  const geciken = dur(Date.now() - Date.parse(s.created_at));
  const L = s.dir === 'L';
  const lines = [];

  lines.push(`🔥 <b>ŞU AN KAZANAN POZİSYON</b>`);
  lines.push('');
  lines.push(`${dirIcon(s.dir)}  <b>${sym(s.symbol)}</b>`);
  lines.push(`Durum: <b>+${fmt(openR, 2)}R önde</b> 🟢`);
  lines.push('');
  lines.push(`Bu pozisyonu <b>${geciken} önce</b> VIP kanalda açtık —`);
  lines.push(`giriş, stop ve hedefleriyle birlikte.`);
  lines.push('');
  lines.push('<b>Sistem neye baktı?</b>');
  lines.push(`• Tip: ${String(s.type || '').toLowerCase()}`);
  lines.push(`• Tükenme onayı: <b>${s.ex_n}/5</b>`);
  lines.push(`• Tetik: ${s.trg || '—'}`);
  if (s.why) lines.push(`• Veri: ${s.why}`);
  lines.push('');
  lines.push(`Yön doğru çıktı. Ama <b>nereden girip nerede çıkacağını</b>`);
  lines.push(`bilmeden yön tek başına para kazandırmaz.`);
  lines.push('');
  lines.push(`VIP\'te sinyal <b>anında</b> gelir: giriş · stop · TP1 · TP2 · pozisyon boyutu ⤵️`);
  lines.push('');
  lines.push(`<i>${UYARI}</i>`);

  return { text: lines.join('\n'), reply_markup: vipBtn('showcase', s.key) };
}

/* ============================================================
   SONUÇ KARTI — hem free hem VIP (free'de VIP vurgusu var)
   ============================================================ */
export function resultCard(s, { forFree = false } = {}) {
  const D = s.decimals ?? 4;
  const net = s.r_net ?? s.r ?? 0;
  const kazanc = net > 0;
  const head = s.status === 'kazanç' ? '✅ HEDEF' : s.status === 'kayıp' ? '🛑 STOP' : '⏳ SÜRE DOLDU';
  const tutuldu = dur(Date.parse(s.closed_at) - Date.parse(s.created_at));
  const usd = net * ((CFG.acct * CFG.riskPct) / 100);

  const lines = [];
  lines.push(`${head} · <b>${sym(s.symbol)}</b> ${s.dir === 'L' ? 'LONG' : 'SHORT'} · Sınıf ${s.grade}`);
  lines.push('');
  lines.push(`Sonuç: <b>${net > 0 ? '+' : ''}${fmt(net, 2)}R</b>  (${net > 0 ? '+' : ''}$${fmt(usd, 0)} · %${fmt(CFG.riskPct, 0)} risk)`);
  lines.push(`<code>giriş ${fmt(s.entry, D)} → çıkış ${fmt(s.close_px, D)}</code>`);
  lines.push(`Süre: ${tutuldu}${s.partial ? ' · kısmi çıkış yapıldı' : ''}`);
  if (s.max_r != null) lines.push(`Seyir: max ${s.max_r > 0 ? '+' : ''}${fmt(s.max_r, 2)}R / min ${fmt(s.min_r, 2)}R`);
  lines.push('');

  if (forFree) {
    lines.push(`Bu sinyal <b>VIP kanalda ${dur(Date.parse(s.closed_at) - Date.parse(s.created_at))} önce</b>, giriş-stop-hedefiyle paylaşıldı.`);
    lines.push(kazanc
      ? 'VIP üyeler bu hareketi baştan yakaladı.'
      : 'Stop planda yazıyordu — VIP üyeler riski önceden biliyordu. Sistem zararı da yönetir.');
    return { text: lines.join('\n') + `\n\n<i>${UYARI}</i>`, reply_markup: vipBtn('result', s.key) };
  }
  return { text: lines.join('\n') + `\n\n<i>${UYARI}</i>` };
}

/* ============================================================
   GÜNLÜK ANALİZ
   ============================================================ */
export function dailyFree(d) {
  const lines = [];
  lines.push(`🌅 <b>GÜNLÜK PİYASA ANALİZİ</b> · ${trShort(Date.now())}`);
  lines.push('');
  if (d.reg) {
    lines.push('<b>REJİM</b>');
    lines.push(`BTC $${fmt(d.reg.btc.p, 0)} · 1s ${pct(d.reg.btc.h1)} · 4s ${pct(d.reg.btc.h4)} · 1g ${pct(d.reg.btc.d1)}`);
    lines.push(`ETH $${fmt(d.reg.eth.p, 2)} · 1s ${pct(d.reg.eth.h1)} · 4s ${pct(d.reg.eth.h4)}`);
    lines.push(`Durum: <b>${d.reg.label}</b>${d.dvol ? ` · DVOL ${fmt(d.dvol.now, 1)} (${fmt(d.dvol.pctl, 0)}. dilim)` : ''}`);
    lines.push('');
  }
  if (d.breadth) {
    lines.push('<b>PİYASA GENİŞLİĞİ</b>');
    lines.push(`%5+ yükselen: <b>${d.breadth.up}</b> · %5+ düşen: <b>${d.breadth.dn}</b> (${d.breadth.n} coin)`);
    lines.push(`Yorum: ${d.breadth.note}`);
    lines.push('');
  }
  if (d.movers?.length) {
    lines.push('<b>GÜNÜN HAREKETLİLERİ</b>');
    d.movers.slice(0, 6).forEach((x) => {
      lines.push(`${x.c >= 0 ? '▲' : '▼'} ${sym(x.s)} ${pct(x.c)} · hacim $${shortn(x.v)}`);
    });
    lines.push('');
  }
  lines.push('<b>SİSTEM NE YAPIYOR</b>');
  lines.push(`Tarama: ${d.scanned ?? '—'} coin · izlemede <b>${d.watching ?? 0}</b> kurulum · açık pozisyon <b>${d.openN ?? 0}</b>`);
  if (d.yesterday) {
    lines.push(`Dün: ${d.yesterday.n} işlem · <b>${d.yesterday.tot > 0 ? '+' : ''}${fmt(d.yesterday.tot, 2)}R</b> · isabet %${fmt(d.yesterday.winPct, 0)}`);
  }
  lines.push('');
  lines.push('Sistem pump ve dump\'ın <b>tükendiği</b> yeri arar: likidite süpürmesi, OI erimesi, CVD dönüşü.');
  lines.push('Giriş-stop-hedefli canlı sinyaller VIP kanalda ⤵️');
  lines.push('');
  lines.push(`<i>${UYARI}</i>`);
  return { text: lines.join('\n'), reply_markup: vipBtn('daily') };
}

export function dailyVip(d) {
  const lines = [];
  lines.push(`🌅 <b>VIP GÜNLÜK BRİFİNG</b> · ${trShort(Date.now())}`);
  lines.push('');
  if (d.reg) {
    lines.push('<b>REJİM & FİLTRELER</b>');
    lines.push(`BTC $${fmt(d.reg.btc.p, 0)} · 15dk ${pct(d.reg.btc.m15)} · 1s ${pct(d.reg.btc.h1)} · 4s ${pct(d.reg.btc.h4)} · 1g ${pct(d.reg.btc.d1)}`);
    lines.push(`Rejim: <b>${d.reg.label}</b>`);
    if (d.dvol) lines.push(`DVOL ${fmt(d.dvol.now, 1)} · ${fmt(d.dvol.pctl, 0)}. dilim ${d.dvol.pctl > 75 ? '⚠️ panik bölgesi — fade riskli' : '✓ normal'}`);
    if (d.shock != null) lines.push(`BTC şok: ${fmt(d.shock, 1)}× ATR ${d.shock > 2.5 ? '⚠️ YENİ POZİSYON YOK' : '✓ sakin'}`);
    lines.push(`Seans: ${seans()}`);
    lines.push('');
  }
  if (d.breadth) {
    lines.push(`<b>GENİŞLİK</b> ${d.breadth.up}↑ / ${d.breadth.dn}↓ · ${d.breadth.note}`);
    lines.push('');
  }
  if (d.watchlist?.length) {
    lines.push('<b>İZLEME LİSTESİ</b> — tetik bekleyen kurulumlar');
    d.watchlist.slice(0, 8).forEach((w) => {
      lines.push(`${dirArrow(w.dir)} <b>${sym(w.symbol)}</b> ${w.verdict} · ${w.grade} · tükenme ${w.ex_n}/5 · tetik ${w.tr_n}/4`);
      lines.push(`   <code>bölge ${fmt(w.entry, w.decimals)} · stop ${fmt(w.stop, w.decimals)}</code> · ${w.trg || 'tetik yok'}`);
    });
    lines.push('');
  } else {
    lines.push('<b>İZLEME LİSTESİ</b> — şu an onay bekleyen kurulum yok. Sistem bekliyor.');
    lines.push('');
  }
  if (d.open?.length) {
    lines.push('<b>AÇIK POZİSYONLAR</b>');
    d.open.forEach((o) => {
      const r = o.open_r ?? 0;
      lines.push(`${dirArrow(o.dir)} ${sym(o.symbol)} · <b>${r > 0 ? '+' : ''}${fmt(r, 2)}R</b> · stop ${fmt(o.stop, o.decimals)} · TP1 ${fmt(o.tp1, o.decimals)}`);
    });
    lines.push('');
  }
  if (d.yesterday) {
    lines.push('<b>DÜNÜN SONUCU</b>');
    lines.push(`${d.yesterday.n} işlem · <b>${d.yesterday.tot > 0 ? '+' : ''}${fmt(d.yesterday.tot, 2)}R</b> · isabet %${fmt(d.yesterday.winPct, 0)} · TP ${d.yesterday.tpHit} / stop ${d.yesterday.stopHit} / süre ${d.yesterday.timeOut}`);
    lines.push('');
  }
  lines.push('<b>BUGÜN NEYE DİKKAT</b>');
  lines.push(d.note || 'Rejim filtrelerine uy. Gün limiti dolduysa dur — sistem seni korur.');
  lines.push('');
  lines.push(`<i>${UYARI}</i>`);
  return { text: lines.join('\n') };
}

/* ============================================================
   PERFORMANS TABLOSU — haftalık / aylık, hem free hem VIP
   ============================================================ */
export function perfTable(st, { title, periodLabel, forFree = false, memberCount = null }) {
  const lines = [];
  lines.push(`📊 <b>${title}</b>`);
  lines.push(`<i>${periodLabel}</i>`);
  lines.push('');
  if (!st.n) {
    lines.push('Bu dönemde kapanan işlem yok. Sistem kurulum bulamadıysa işlem açmaz —');
    lines.push('zorlamamak da bir karardır.');
    lines.push('');
    lines.push(`<i>${UYARI}</i>`);
    return { text: lines.join('\n'), reply_markup: forFree ? vipBtn('perf') : undefined };
  }

  const usd = st.usd;
  lines.push('<b>SONUÇ</b>');
  lines.push(`<code>İşlem      ${String(st.n).padStart(6)}</code>`);
  lines.push(`<code>Kazanç     ${String(st.win).padStart(6)}  (%${fmt(st.winPct, 0)})</code>`);
  lines.push(`<code>Kayıp      ${String(st.loss).padStart(6)}</code>`);
  lines.push(`<code>Toplam     ${(st.tot > 0 ? '+' : '') + fmt(st.tot, 2)}R</code>`);
  lines.push(`<code>Ortalama   ${(st.avg > 0 ? '+' : '') + fmt(st.avg, 2)}R / işlem</code>`);
  if (st.pf) lines.push(`<code>Kâr faktörü ${fmt(st.pf, 2)}</code>`);
  lines.push(`<code>Max düşüş  ${fmt(st.mdd, 2)}R</code>`);
  lines.push('');
  lines.push('<b>DAĞILIM</b>');
  lines.push(`Hedef ${st.tpHit} · Stop ${st.stopHit} · Süre ${st.timeOut}`);
  lines.push(`Ort. kazanç +${fmt(st.avgWin, 2)}R · Ort. kayıp -${fmt(st.avgLoss, 2)}R`);
  lines.push('');

  const gKeys = ['A', 'B', 'C', 'D'].filter((g) => st.byGrade[g]);
  if (gKeys.length) {
    lines.push('<b>SINIFA GÖRE</b>');
    gKeys.forEach((g) => {
      const x = st.byGrade[g];
      lines.push(`<code>${g}  ${String(x.n).padStart(3)} işlem  %${String(Math.round((x.win / x.n) * 100)).padStart(3)}  ${(x.r > 0 ? '+' : '') + fmt(x.r, 2)}R</code>`);
    });
    lines.push('');
  }
  const dKeys = Object.keys(st.byDir);
  if (dKeys.length > 1) {
    lines.push('<b>YÖNE GÖRE</b>');
    dKeys.forEach((d) => {
      const x = st.byDir[d];
      lines.push(`<code>${d.padEnd(6)} ${String(x.n).padStart(3)} işlem  %${String(Math.round((x.win / x.n) * 100)).padStart(3)}  ${(x.r > 0 ? '+' : '') + fmt(x.r, 2)}R</code>`);
    });
    lines.push('');
  }
  if (st.best) {
    lines.push(`En iyi: <b>${sym(st.best.symbol)}</b> ${st.best.dir === 'L' ? 'LONG' : 'SHORT'} ${fmt(st.best.r_net ?? st.best.r, 2)}R`);
  }
  if (st.worst && st.worst !== st.best) {
    lines.push(`En kötü: ${sym(st.worst.symbol)} ${st.worst.dir === 'L' ? 'LONG' : 'SHORT'} ${fmt(st.worst.r_net ?? st.worst.r, 2)}R`);
  }
  lines.push('');
  lines.push(`<b>$${shortn(CFG.acct)} hesap · %${fmt(CFG.riskPct, 0)} risk → ${usd > 0 ? '+' : ''}$${fmt(usd, 0)}</b>`);
  lines.push('');
  lines.push('<i>R = riske edilen birim. 1R, stop mesafesi kadar zarardır.');
  lines.push('Tüm sonuçlar komisyon ve kayma düşülmüş NET değerlerdir.</i>');

  if (forFree) {
    lines.push('');
    lines.push('Bu işlemlerin <b>hepsi VIP kanalda, açılmadan önce</b> giriş-stop-hedefiyle paylaşıldı.');
    if (memberCount) lines.push(`${memberCount} üye aynı anda gördü.`);
    lines.push('');
    lines.push(`<i>${UYARI}</i>`);
    return { text: lines.join('\n'), reply_markup: vipBtn('perf') };
  }
  lines.push('');
  lines.push(`<i>${UYARI}</i>`);
  return { text: lines.join('\n') };
}

/* ============================================================
   FREE: günlük kapanış özeti (akşam) — satış vitrinimiz
   ============================================================ */
export function dailyRecapFree(st, openN) {
  const lines = [];
  lines.push(`🌙 <b>GÜN KAPANIŞI</b> · ${trShort(Date.now())}`);
  lines.push('');
  if (!st.n) {
    lines.push('Bugün kapanan işlem olmadı.');
    lines.push(openN ? `${openN} pozisyon hâlâ açık, VIP kanalda takip ediliyor.` : 'Sistem kurulum bulamadı — zorlamadık.');
  } else {
    lines.push(`İşlem: <b>${st.n}</b> · Kazanan: <b>${st.win}</b> · İsabet: <b>%${fmt(st.winPct, 0)}</b>`);
    lines.push(`Günün neti: <b>${st.tot > 0 ? '+' : ''}${fmt(st.tot, 2)}R</b> (${st.usd > 0 ? '+' : ''}$${fmt(st.usd, 0)} · $${shortn(CFG.acct)} hesapta)`);
    if (st.best) lines.push(`Günün en iyisi: <b>${sym(st.best.symbol)}</b> ${fmt(st.best.r_net ?? st.best.r, 2)}R`);
    if (openN) lines.push(`${openN} pozisyon açık kaldı.`);
  }
  lines.push('');
  lines.push('Bu sinyallerin tamamı <b>VIP kanalda anında</b>, girişiyle birlikte verildi.');
  lines.push('Free kanalda sonucu görüyorsun — VIP\'te işlemi görüyorsun.');
  lines.push('');
  lines.push(`<i>${UYARI}</i>`);
  return { text: lines.join('\n'), reply_markup: vipBtn('recap') };
}

/* ============================================================
   DM / komut yanıtları
   ============================================================ */
export function startMsg(name) {
  return [
    `Merhaba ${name || ''}! 👋`,
    '',
    '<b>FADE sinyal sistemi</b> — pump ve dump\'ların tükendiği yeri avlar.',
    '',
    'Sistem her coin için üç fazlı onay arar:',
    '• <b>Tip</b> — hareketi spot mu taşıyor, kaldıraç mı (OI analizi)',
    '• <b>Tükenme</b> — fitil, hacim sönümü, CVD dönüşü, OI erimesi (5 kontrol)',
    '• <b>Tetik</b> — likidite süpürmesi, başarısız retest, yapı kırılımı (4 kontrol)',
    '',
    'Onay gelmezse <b>işlem açılmaz</b>. Veto varsa coine dokunulmaz.',
    '',
    '<b>Komutlar</b>',
    '/vip — VIP üyelik ve fiyatlar',
    '/durum — üyeliğim ne zaman bitiyor',
    '/performans — son 30 günün net sonucu',
    '/nasil — sistem nasıl çalışır',
    '/id — Telegram ID\'mi göster',
    '',
    `Ücretsiz kanal: ${ENV.freeLink}`,
  ].join('\n');
}

export function vipMsg(plans) {
  const lines = [];
  lines.push('⭐ <b>VIP ÜYELİK</b>');
  lines.push('');
  lines.push('<b>VIP\'te ne var?</b>');
  lines.push('• Sinyal <b>anında</b> — giriş, stop, TP1, TP2, R:R');
  lines.push('• <b>Pozisyon boyutu</b> — hesabına göre kaç lot, kaç dolar risk');
  lines.push('• Günlük brifing — izleme listesi, tetik bekleyen kurulumlar, rejim filtreleri');
  lines.push('• Açık pozisyon takibi ve kısmi çıkış bildirimleri');
  lines.push('• Haftalık + aylık detaylı performans dökümü');
  lines.push('');
  lines.push('<b>Free kanalda ne var?</b>');
  lines.push(`• Sinyaller ${ENV.freeDelayMin} dk gecikmeli ve <b>plansız</b> (sadece coin + yön)`);
  lines.push('• Günlük piyasa analizi ve kapanış özeti');
  lines.push('• Sonuç kartları ve performans tabloları');
  lines.push('');
  lines.push('<b>FİYATLAR</b> (kripto ile ödeme — USDT, BTC, ETH ve 100+ coin)');
  plans.forEach((p) => {
    const aylik = p.price / (p.days / 30);
    lines.push(`• <b>${p.name}</b> — $${p.price}${p.days > 31 ? `  <i>(ayda $${fmt(aylik, 0)})</i>` : ''}`);
  });
  lines.push('');
  lines.push('Ödeme sonrası <b>tek kullanımlık davet linki</b> otomatik gelir.');
  lines.push('');
  lines.push(`<i>${UYARI} Geçmiş performans gelecek sonuçların garantisi değildir.</i>`);
  return lines.join('\n');
}

export function planKeyboard(plans) {
  return {
    inline_keyboard: plans.map((p) => [{
      text: `${p.name} — $${p.price}`,
      callback_data: 'buy:' + p.name,
    }]),
  };
}

export function invoiceMsg(plan, url) {
  return [
    `💳 <b>${plan.name} VIP — $${plan.price}</b>`,
    '',
    'Ödeme sayfasında istediğin kripto parayı seçebilirsin (USDT TRC20 en düşük komisyonlu).',
    '',
    `<a href="${url}">👉 Ödemeyi aç</a>`,
    '',
    'Ödeme ağda onaylandığı anda VIP davet linki buraya otomatik gelir.',
    'Bu genelde 1-10 dakika sürer. Sayfayı kapatabilirsin.',
  ].join('\n');
}

export function grantMsg(plan, expiresAt, link) {
  return [
    '✅ <b>Ödeme alındı — VIP üyeliğin aktif!</b>',
    '',
    `Plan: <b>${plan}</b>`,
    `Bitiş: <b>${trDateTime(expiresAt)}</b>`,
    '',
    `<a href="${link}">⭐ VIP kanala katıl</a>`,
    '',
    '<i>Bu link sana özel ve tek kullanımlık. Başkasıyla paylaşırsan sen giremezsin.</i>',
    '',
    'Hoş geldin. Sinyaller anında düşmeye başlayacak.',
  ].join('\n');
}

export function expireSoonMsg(days, link) {
  return [
    `⏰ <b>VIP üyeliğin ${days} gün sonra bitiyor.</b>`,
    '',
    'Kesintisiz devam etmek için /vip yazıp yenileyebilirsin.',
    'Süre bitince kanaldan otomatik çıkarılırsın; yenilersen tekrar eklenirsin.',
  ].join('\n');
}

export function expiredMsg() {
  return [
    '⌛️ <b>VIP üyeliğin sona erdi.</b>',
    '',
    'VIP kanaldan çıkarıldın. Tekrar katılmak için /vip yaz.',
    '',
    `Ücretsiz kanala devam edebilirsin: ${ENV.freeLink}`,
  ].join('\n');
}

export function statusMsg(v) {
  if (!v || v.status !== 'aktif') {
    return ['Aktif VIP üyeliğin yok.', '', '/vip yazarak planları görebilirsin.'].join('\n');
  }
  const kalan = Math.ceil((Date.parse(v.expires_at) - Date.now()) / 864e5);
  return [
    '⭐ <b>VIP üyelik aktif</b>',
    '',
    `Plan: <b>${v.plan || '—'}</b>`,
    `Bitiş: <b>${trDateTime(Date.parse(v.expires_at))}</b>`,
    `Kalan: <b>${kalan} gün</b>`,
  ].join('\n');
}

export function nasilMsg() {
  return [
    '<b>FADE SİSTEMİ NASIL ÇALIŞIR?</b>',
    '',
    'Sistem trend takip etmez. <b>Aşırıya giden hareketin tükendiği</b> yeri arar.',
    '',
    '<b>1. FAZ — Hareketi kim taşıyor?</b>',
    'Open Interest (OI) eriyorken fiyat yükseliyorsa bu bir <i>short squeeze</i>: zorunlu alımlar. Yakıt bitince düşer.',
    'OI şişiyorsa bu kaldıraçlı trend — sistem <b>dokunmaz</b>, veto verir.',
    '',
    '<b>2. FAZ — Tükendi mi? (5 kontrol, en az 3 şart)</b>',
    '• Tepe mumunda üst fitil (alıcı reddedildi)',
    '• Hacim sönümü (ilgi bitti)',
    '• CVD dönüşü (taker alımı eriyor)',
    '• OI tepeden eriyor (pozisyonlar kapanıyor)',
    '• Taker alım oranı soğuyor',
    '',
    '<b>3. FAZ — Tetik var mı? (4 kontrol, en az 1 şart)</b>',
    '• <b>Likidite süpürmesi</b> — önceki tepeyi kırıp altında kapanmak. En kaliteli tetik.',
    '• Başarısız retest',
    '• Yapı kırılımı (ilk HL kırıldı)',
    '• aVWAP reddi',
    '',
    '<b>VETOLAR — biri varsa işlem yok</b>',
    'OI şişmesi · BTC ters impulsta · makro olay penceresi/BTC şoku · coin 30 günden yeni',
    '',
    '<b>STOP ve HEDEF</b>',
    'Stop yapısal seviyeden alınır ama coinin ATR\'siyle sınırlanır — hem çok dar hem çok geniş olamaz.',
    'Hedef uydurulmaz: POC, value area, emir defteri duvarı, likidasyon kaskad durağı, fib, aVWAP, EMA ve D/D seviyelerinden <b>ulaşılabilir</b> olan seçilir.',
    'Hedefin tipik süresi stopun süresinin 3 katını geçemez — yoksa R:R kâğıt üstünde kalır.',
    '',
    '<b>RİSK</b>',
    `İşlem başına %${fmt(CFG.riskPct, 0)} risk · aynı anda en fazla ${CFG.maxOpen} pozisyon · gün ${fmt(CFG.dailyStopR, 0)}R'ye inerse sistem durur.`,
    '',
    'Tüm performans sonuçları komisyon ve kayma düşülmüş <b>net</b> değerlerdir.',
    '',
    `<i>${UYARI}</i>`,
  ].join('\n');
}

/* ============================================================
   EĞİTİM POSTU
   Free'de sonunda VIP çağrısı var, VIP'te yok (üye zaten içeride).
   ============================================================ */
export function eduPost(lesson, { forFree = false, idx = null, total = null } = {}) {
  const lines = [];
  lines.push(`📚 <b>${lesson.title}</b>`);
  lines.push(`<i>${lesson.tag}${idx && total ? ` · ders ${idx}/${total}` : ''}</i>`);
  lines.push('');
  lines.push(lesson.body);

  if (forFree) {
    lines.push('');
    lines.push('—');
    lines.push('Bu kontrolleri <b>elle takip etmek</b> 400 coinde mümkün değil.');
    lines.push('Sistem bunu 7/24 tarayıp sadece üçü hizalandığında haber veriyor ⤵️');
    return { text: lines.join('\n'), reply_markup: vipBtn('edu') };
  }
  return { text: lines.join('\n') };
}

/* ============================================================
   HABER — flaş haber ve günlük özet
   Haber bir "haber dökümü" değil: her zaman SİSTEMLE ilişkilendirilir.
   ============================================================ */
export function newsFlash(item, ctx = {}) {
  const lines = [];
  const yas = dur(Date.now() - item.at);
  lines.push(`🚨 <b>ÖNEMLİ HABER</b>${item.tags?.length ? ` · ${item.tags[0]}` : ''}`);
  lines.push('');
  lines.push(`<b>${item.title}</b>`);
  lines.push(`<i>${item.source} · ${yas} önce</i>`);
  if (item.url) lines.push(`<a href="${item.url}">haberi oku →</a>`);
  lines.push('');

  if (item.why) {
    lines.push('<b>Neden önemli?</b>');
    lines.push(item.why);
    lines.push('');
  }

  // sistemin o anki durumu — haberi bağlama oturtur
  const d = [];
  if (ctx.btc15 != null) d.push(`BTC 15dk <b>${pct(ctx.btc15)}</b>`);
  if (ctx.rejim) d.push(ctx.rejim);
  if (ctx.shock != null && ctx.shock > 2.5) d.push(`⚡ şok ${fmt(ctx.shock, 1)}× ATR`);
  if (d.length) {
    lines.push('<b>Şu an piyasa</b>');
    lines.push(d.join(' · '));
    if (ctx.shock > 2.5) {
      lines.push('Sistem <b>yeni pozisyon açmıyor</b> — şok hareketinde teknik yapı güvenilmez.');
    } else if (ctx.openN) {
      lines.push(`${ctx.openN} açık pozisyon takip ediliyor.`);
    }
    lines.push('');
  }

  if (item.lang === 'en') {
    lines.push('<i>Başlık kaynağın özgün dilinde bırakıldı — çeviride anlam kaymasın diye.</i>');
    lines.push('');
  }
  lines.push(`<i>${UYARI}</i>`);
  return { text: lines.join('\n') };
}

export function newsDigest(items, ctx = {}) {
  const lines = [];
  lines.push(`📰 <b>GÜNÜN KRİPTO GÜNDEMİ</b> · ${trShort(Date.now())}`);
  lines.push('');
  if (!items.length) {
    lines.push('Bugün piyasayı etkileyecek öne çıkan bir gelişme yakalanmadı.');
    lines.push('Sessiz gün, kötü gün değildir — sistem kurulum beklemeye devam ediyor.');
  } else {
    items.forEach((it, i) => {
      lines.push(`<b>${i + 1}.</b> ${it.title}`);
      lines.push(`<i>${it.source}${it.tags?.length ? ' · ' + it.tags.join(', ') : ''}</i>`);
      if (it.url) lines.push(`<a href="${it.url}">oku →</a>`);
      lines.push('');
    });
  }
  const d = [];
  if (ctx.btc15 != null) d.push(`BTC 15dk ${pct(ctx.btc15)}`);
  if (ctx.rejim) d.push(ctx.rejim);
  if (ctx.breadth) d.push(`${ctx.breadth.up}↑/${ctx.breadth.dn}↓`);
  if (d.length) {
    lines.push('<b>Piyasa durumu:</b> ' + d.join(' · '));
    lines.push('');
  }
  lines.push(`<i>${UYARI}</i>`);
  return { text: lines.join('\n') };
}
