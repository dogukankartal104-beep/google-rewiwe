/* Telegram message templates.
   CHANNEL content is English only — the channels are positioned globally.
   DM content is bilingual (EN/TR); the user picks with /language.

   Honesty rules baked in here, do not remove:
   - No invented performance numbers. Every figure comes from closed trades.
   - No profit guarantees or "signals that always win" language.
   - The risk disclaimer ships on every public message. */
import { ENV, CFG, botLink } from './config.js';
import { fmt, pct, shortn, trDateTime, trShort, dur, seans } from './util.js';

const RISK = 'Not financial advice. Leveraged trading can lose your entire capital.';
const RISK_TR = 'Yatırım tavsiyesi değildir. Kaldıraçlı işlem sermayenizin tamamını kaybettirebilir.';

const sym = (s) => String(s || '').replace('USDT', '');
// Telegram HTML mode: &, < and > in user/internet text must be escaped or the whole message is rejected
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (t) => esc(t).replace(/"/g, '&quot;');
// account size reads better plain: $1,000 not $1.00K
const acct = () => Number(CFG.acct).toLocaleString('en-US');
const dirIcon = (d) => (d === 'L' ? '🟢 LONG' : '🔴 SHORT');
const dirArrow = (d) => (d === 'L' ? '▲' : '▼');

// pick a string by language, falling back to English
export const L = (lang, en, tr) => (lang === 'tr' ? tr : en);

/* VIP button. It must NEVER point at a VIP invite link — that would let anyone
   skip the payment. Order of preference:
   1. PUBLIC_URL/go/vip  (tracked redirect, which lands in the bot)
   2. the bot deep link directly
   3. the free channel (harmless fallback if the bot username is not known yet) */
export function vipUrl(source = 'free', signalKey = null) {
  if (ENV.publicUrl) {
    const u = new URL(ENV.publicUrl + '/go/vip');
    u.searchParams.set('s', source);
    if (signalKey) u.searchParams.set('k', signalKey);
    return u.toString();
  }
  return botLink('vip_' + source) || ENV.freeLink;
}

const vipBtn = (source = 'free', signalKey = null, text = '⭐ Join VIP') => ({
  inline_keyboard: [[{ text, url: vipUrl(source, signalKey) }]],
});

// percent move relative to entry
const rel = (v, en) => (v == null || en == null ? '' : ` <i>(${pct(((v - en) / en) * 100)})</i>`);

/* ============================================================
   VIP SIGNAL — full plan, instant
   ============================================================ */
export function vipSignal(s) {
  const D = s.decimals ?? 4;
  const p = (v) => (v == null ? '—' : fmt(v, D));
  const usdRisk = (CFG.acct * CFG.riskPct) / 100;

  const lines = [];
  lines.push(`${dirIcon(s.dir)}  <b>${sym(s.symbol)}</b> · ${s.tf}`);
  lines.push(`Grade <b>${s.grade}</b> · ${String(s.type || '').toLowerCase()} · confirmations ${s.teyit_ps}/${s.teyit_av}`);
  lines.push('');
  lines.push('<b>TRADE PLAN</b>');
  lines.push(`<code>Entry   ${p(s.entry)}</code>`);
  lines.push(`<code>Stop    ${p(s.stop)}</code>${rel(s.stop, s.entry)}`);
  lines.push(`<code>TP1     ${p(s.tp1)}</code>${rel(s.tp1, s.entry)}`);
  if (s.tp2) lines.push(`<code>TP2     ${p(s.tp2)}</code>${rel(s.tp2, s.entry)}`);
  lines.push(`<code>R:R     ${s.rr ? fmt(s.rr, 2) : '—'}</code>`);
  lines.push('');
  lines.push('<b>POSITION SIZE</b>');
  lines.push(`${fmt(CFG.riskPct, 0)}% risk → <b>$${fmt(usdRisk, 0)}</b> on a $${acct()} account`);
  lines.push(`Size ≈ <b>${fmt(s.qty, s.qty > 100 ? 0 : 2)}</b> ${sym(s.symbol)}`);
  if (s.tp1_label) lines.push(`TP1 is based on: ${s.tp1_label}`);
  lines.push('');
  lines.push('<b>WHY THIS TRADE</b>');
  lines.push(`Exhaustion <b>${s.ex_n}/5</b> · Trigger <b>${s.tr_n}/4</b>`);
  if (s.trg) lines.push(`Trigger: ${s.trg}`);
  if (s.why) lines.push(`Data: ${s.why}`);
  const bits = [];
  if (s.atr_pct != null) bits.push(`ATR ${fmt(s.atr_pct, 2)}%`);
  if (s.vol_ratio != null) bits.push(`volatility ${fmt(s.vol_ratio, 2)}×`);
  if (s.bars_stop != null && s.bars_tp != null) bits.push(`~${s.bars_tp} bars to target (stop ~${s.bars_stop})`);
  if (bits.length) lines.push(bits.join(' · '));
  lines.push(`Session: ${sessionEn(s.session)} · ${trDateTime(Date.parse(s.created_at))}`);
  lines.push('');
  lines.push(`<i>${RISK}</i>`);
  return lines.join('\n');
}

/* ============================================================
   FREE TEASER — delayed, no levels
   ============================================================ */
export function freeTeaser(s, { openR = null } = {}) {
  const ago = dur(Date.now() - Date.parse(s.created_at));
  const lines = [];
  lines.push(`📡 <b>SIGNAL FIRED</b> · ${ago} ago`);
  lines.push(`${dirArrow(s.dir)} <b>${sym(s.symbol)}</b> · ${s.dir === 'L' ? 'LONG' : 'SHORT'} · Grade <b>${s.grade}</b>`);
  lines.push('');
  lines.push('The system cleared all three phases:');
  lines.push(`• Type: ${String(s.type || '').toLowerCase()}`);
  lines.push(`• Exhaustion: <b>${s.ex_n}/5</b>`);
  lines.push(`• Trigger: ${s.trg || '—'}`);
  if (s.why) lines.push(`• Data: ${s.why}`);
  lines.push('');
  if (openR != null && Number.isFinite(openR)) {
    const em = openR > 0.1 ? '🟢' : openR < -0.1 ? '🔴' : '⚪️';
    lines.push(`Currently: <b>${openR > 0 ? '+' : ''}${fmt(openR, 2)}R</b> ${em}`);
    lines.push('');
  }
  lines.push(`Entry, stop, targets and position size went out to <b>VIP ${ago} ago</b>.`);
  lines.push('Get them the moment they fire ⤵️');
  lines.push('');
  lines.push(`<i>${RISK}</i>`);
  return { text: lines.join('\n'), reply_markup: vipBtn('teaser', s.key) };
}

/* ============================================================
   FREE SHOWCASE — "this position is winning right now"
   One per day, winners only. No levels.
   ============================================================ */
export function freeShowcase(s, openR) {
  const ago = dur(Date.now() - Date.parse(s.created_at));
  const lines = [];

  lines.push('🔥 <b>LIVE POSITION — IN PROFIT</b>');
  lines.push('');
  lines.push(`${dirIcon(s.dir)}  <b>${sym(s.symbol)}</b>`);
  lines.push(`Currently <b>+${fmt(openR, 2)}R in front</b> 🟢`);
  lines.push('');
  lines.push(`We opened this <b>${ago} ago</b> in the VIP channel —`);
  lines.push('with the exact entry, stop and targets.');
  lines.push('');
  lines.push('<b>What the system saw</b>');
  lines.push(`• Type: ${String(s.type || '').toLowerCase()}`);
  lines.push(`• Exhaustion confirmed: <b>${s.ex_n}/5</b>`);
  lines.push(`• Trigger: ${s.trg || '—'}`);
  if (s.why) lines.push(`• Data: ${s.why}`);
  lines.push('');
  lines.push('The direction was right. But direction alone does not pay —');
  lines.push('<b>knowing where to enter, where to stop and where to take profit does.</b>');
  lines.push('');
  lines.push('VIP members get every signal the second it fires ⤵️');
  lines.push('');
  lines.push(`<i>${RISK}</i>`);

  return { text: lines.join('\n'), reply_markup: vipBtn('showcase', s.key) };
}

/* ============================================================
   RESULT CARD
   ============================================================ */
export function resultCard(s, { forFree = false } = {}) {
  const D = s.decimals ?? 4;
  const net = s.r_net ?? s.r ?? 0;
  const won = net > 0;
  const head = s.status === 'kazanç' ? '✅ TARGET HIT'
    : s.status === 'kayıp' ? '🛑 STOPPED OUT'
    : '⏳ TIME EXIT';
  const held = dur(Date.parse(s.closed_at) - Date.parse(s.created_at));
  const usd = net * ((CFG.acct * CFG.riskPct) / 100);

  const lines = [];
  lines.push(`${head} · <b>${sym(s.symbol)}</b> ${s.dir === 'L' ? 'LONG' : 'SHORT'} · Grade ${s.grade}`);
  lines.push('');
  lines.push(`Result: <b>${net > 0 ? '+' : ''}${fmt(net, 2)}R</b>  (${net > 0 ? '+' : ''}$${fmt(usd, 0)} at ${fmt(CFG.riskPct, 0)}% risk)`);
  lines.push(`<code>entry ${fmt(s.entry, D)} → exit ${fmt(s.close_px, D)}</code>`);
  lines.push(`Held: ${held}${s.partial ? ' · partial exit taken' : ''}`);
  if (s.max_r != null) lines.push(`Path: max ${s.max_r > 0 ? '+' : ''}${fmt(s.max_r, 2)}R / min ${fmt(s.min_r, 2)}R`);
  lines.push('');

  if (forFree) {
    lines.push(`This went out in the <b>VIP channel ${held} ago</b>, with entry, stop and targets.`);
    lines.push(won
      ? 'VIP members were in this from the start.'
      : 'The stop was written in the plan before the trade opened. VIP members knew the risk up front — the system manages losses too.');
    return { text: lines.join('\n') + `\n\n<i>${RISK}</i>`, reply_markup: vipBtn('result', s.key) };
  }
  return { text: lines.join('\n') + `\n\n<i>${RISK}</i>` };
}

/* ============================================================
   DAILY ANALYSIS
   ============================================================ */
export function dailyFree(d) {
  const lines = [];
  lines.push(`🌅 <b>DAILY MARKET BRIEF</b> · ${trShort(Date.now())}`);
  lines.push('');
  if (d.reg) {
    lines.push('<b>REGIME</b>');
    lines.push(`BTC $${fmt(d.reg.btc.p, 0)} · 1h ${pct(d.reg.btc.h1)} · 4h ${pct(d.reg.btc.h4)} · 1d ${pct(d.reg.btc.d1)}`);
    lines.push(`ETH $${fmt(d.reg.eth.p, 2)} · 1h ${pct(d.reg.eth.h1)} · 4h ${pct(d.reg.eth.h4)}`);
    lines.push(`State: <b>${regimeEn(d.reg.label)}</b>${d.dvol ? ` · DVOL ${fmt(d.dvol.now, 1)} (${fmt(d.dvol.pctl, 0)}th pct)` : ''}`);
    lines.push('');
  }
  if (d.breadth) {
    lines.push('<b>MARKET BREADTH</b>');
    lines.push(`Up 5%+: <b>${d.breadth.up}</b> · Down 5%+: <b>${d.breadth.dn}</b> (of ${d.breadth.n})`);
    lines.push(`Read: ${breadthEn(d.breadth.note)}`);
    lines.push('');
  }
  if (d.movers?.length) {
    lines.push('<b>BIGGEST MOVERS</b>');
    d.movers.slice(0, 6).forEach((x) => {
      lines.push(`${x.c >= 0 ? '▲' : '▼'} ${sym(x.s)} ${pct(x.c)} · vol $${shortn(x.v)}`);
    });
    lines.push('');
  }
  lines.push('<b>WHAT THE SYSTEM IS DOING</b>');
  lines.push(`Scanned ${d.scanned ?? '—'} pairs · <b>${d.watching ?? 0}</b> setups on watch · <b>${d.openN ?? 0}</b> open`);
  if (d.yesterday) {
    lines.push(`Yesterday: ${d.yesterday.n} trades · <b>${d.yesterday.tot > 0 ? '+' : ''}${fmt(d.yesterday.tot, 2)}R</b> · hit rate ${fmt(d.yesterday.winPct, 0)}%`);
  }
  lines.push('');
  lines.push('The system hunts the point where a pump or dump <b>exhausts</b>:');
  lines.push('liquidity sweeps, open interest bleeding out, CVD rolling over.');
  lines.push('Live signals with entry, stop and targets go to VIP ⤵️');
  lines.push('');
  lines.push(`<i>${RISK}</i>`);
  return { text: lines.join('\n'), reply_markup: vipBtn('daily') };
}

export function dailyVip(d) {
  const lines = [];
  lines.push(`🌅 <b>VIP DAILY BRIEFING</b> · ${trShort(Date.now())}`);
  lines.push('');
  if (d.reg) {
    lines.push('<b>REGIME & FILTERS</b>');
    lines.push(`BTC $${fmt(d.reg.btc.p, 0)} · 15m ${pct(d.reg.btc.m15)} · 1h ${pct(d.reg.btc.h1)} · 4h ${pct(d.reg.btc.h4)} · 1d ${pct(d.reg.btc.d1)}`);
    lines.push(`Regime: <b>${regimeEn(d.reg.label)}</b>`);
    if (d.dvol) lines.push(`DVOL ${fmt(d.dvol.now, 1)} · ${fmt(d.dvol.pctl, 0)}th pct ${d.dvol.pctl > 75 ? '⚠️ panic zone — fading is risky' : '✓ normal'}`);
    if (d.shock != null) lines.push(`BTC shock: ${fmt(d.shock, 1)}× ATR ${d.shock > 2.5 ? '⚠️ NO NEW POSITIONS' : '✓ calm'}`);
    lines.push(`Session: ${sessionEn(seans())}`);
    lines.push('');
  }
  if (d.breadth) {
    lines.push(`<b>BREADTH</b> ${d.breadth.up}↑ / ${d.breadth.dn}↓ · ${breadthEn(d.breadth.note)}`);
    lines.push('');
  }
  if (d.watchlist?.length) {
    lines.push('<b>WATCHLIST</b> — setups awaiting their trigger');
    d.watchlist.slice(0, 8).forEach((w) => {
      lines.push(`${dirArrow(w.dir)} <b>${sym(w.symbol)}</b> ${verdictEn(w.verdict)} · ${w.grade} · exhaustion ${w.ex_n}/5 · trigger ${w.tr_n}/4`);
      lines.push(`   <code>zone ${fmt(w.entry, w.decimals)} · stop ${fmt(w.stop, w.decimals)}</code> · ${w.trg || 'no trigger yet'}`);
    });
    lines.push('');
  } else {
    lines.push('<b>WATCHLIST</b> — nothing qualifying right now. The system waits.');
    lines.push('');
  }
  if (d.open?.length) {
    lines.push('<b>OPEN POSITIONS</b>');
    d.open.forEach((o) => {
      const r = o.open_r ?? 0;
      lines.push(`${dirArrow(o.dir)} ${sym(o.symbol)} · <b>${r > 0 ? '+' : ''}${fmt(r, 2)}R</b> · stop ${fmt(o.stop, o.decimals)} · TP1 ${fmt(o.tp1, o.decimals)}`);
    });
    lines.push('');
  }
  if (d.yesterday) {
    lines.push('<b>YESTERDAY</b>');
    lines.push(`${d.yesterday.n} trades · <b>${d.yesterday.tot > 0 ? '+' : ''}${fmt(d.yesterday.tot, 2)}R</b> · hit rate ${fmt(d.yesterday.winPct, 0)}% · TP ${d.yesterday.tpHit} / stop ${d.yesterday.stopHit} / time ${d.yesterday.timeOut}`);
    lines.push('');
  }
  lines.push('<b>FOCUS TODAY</b>');
  lines.push(d.noteEn || 'Respect the regime filters. If the daily loss limit is hit, stop — the system is protecting you.');
  lines.push('');
  lines.push(`<i>${RISK}</i>`);
  return { text: lines.join('\n') };
}

const regimeEn = (t) => ({
  'yukarı rejim': 'risk-on', 'aşağı rejim': 'risk-off', yatay: 'range-bound',
}[t] || t || '—');

const breadthEn = (t) => ({
  'RİSK-ON · short fade tehlikeli': 'RISK-ON — fading shorts is dangerous',
  'RİSK-OFF · long fade tehlikeli': 'RISK-OFF — fading longs is dangerous',
  nötr: 'neutral',
}[t] || t || '—');

// seans() already returns English now; kept for older rows in the database
const sessionEn = (t) => ({
  'ölü saat': 'dead hours', asya: 'Asia', avrupa: 'Europe', abd: 'US',
}[t] || t);

const verdictEn = (t) => ({
  'TETİK BEKLE': 'AWAITING TRIGGER', 'TÜKENME BEKLE': 'AWAITING EXHAUSTION',
  SHORT: 'SHORT', LONG: 'LONG',
}[t] || t);

/* ============================================================
   PERFORMANCE TABLE
   ============================================================ */
export function perfTable(st, { title, periodLabel, forFree = false, memberCount = null }) {
  const lines = [];
  lines.push(`📊 <b>${title}</b>`);
  lines.push(`<i>${periodLabel}</i>`);
  lines.push('');
  if (!st.n) {
    lines.push('No trades closed in this period. When the system finds no valid setup');
    lines.push('it does not trade — refusing to force it is a decision too.');
    lines.push('');
    lines.push(`<i>${RISK}</i>`);
    return { text: lines.join('\n'), reply_markup: forFree ? vipBtn('perf') : undefined };
  }

  lines.push('<b>RESULT</b>');
  lines.push(`<code>Trades     ${String(st.n).padStart(6)}</code>`);
  lines.push(`<code>Winners    ${String(st.win).padStart(6)}  (${fmt(st.winPct, 0)}%)</code>`);
  lines.push(`<code>Losers     ${String(st.loss).padStart(6)}</code>`);
  lines.push(`<code>Total      ${(st.tot > 0 ? '+' : '') + fmt(st.tot, 2)}R</code>`);
  lines.push(`<code>Average    ${(st.avg > 0 ? '+' : '') + fmt(st.avg, 2)}R per trade</code>`);
  if (st.pf) lines.push(`<code>Profit factor ${fmt(st.pf, 2)}</code>`);
  lines.push(`<code>Max drawdown ${fmt(st.mdd, 2)}R</code>`);
  lines.push('');
  lines.push('<b>BREAKDOWN</b>');
  lines.push(`Target ${st.tpHit} · Stop ${st.stopHit} · Time ${st.timeOut}`);
  lines.push(`Avg win +${fmt(st.avgWin, 2)}R · Avg loss -${fmt(st.avgLoss, 2)}R`);
  lines.push('');

  const gKeys = ['A', 'B', 'C', 'D'].filter((g) => st.byGrade[g]);
  if (gKeys.length) {
    lines.push('<b>BY GRADE</b>');
    gKeys.forEach((g) => {
      const x = st.byGrade[g];
      lines.push(`<code>${g}  ${String(x.n).padStart(3)} trades  ${String(Math.round((x.win / x.n) * 100)).padStart(3)}%  ${(x.r > 0 ? '+' : '') + fmt(x.r, 2)}R</code>`);
    });
    lines.push('');
  }
  const dKeys = Object.keys(st.byDir);
  if (dKeys.length > 1) {
    lines.push('<b>BY DIRECTION</b>');
    dKeys.forEach((d) => {
      const x = st.byDir[d];
      lines.push(`<code>${d.padEnd(6)} ${String(x.n).padStart(3)} trades  ${String(Math.round((x.win / x.n) * 100)).padStart(3)}%  ${(x.r > 0 ? '+' : '') + fmt(x.r, 2)}R</code>`);
    });
    lines.push('');
  }
  if (st.best) {
    lines.push(`Best: <b>${sym(st.best.symbol)}</b> ${st.best.dir === 'L' ? 'LONG' : 'SHORT'} ${fmt(st.best.r_net ?? st.best.r, 2)}R`);
  }
  if (st.worst && st.worst !== st.best) {
    lines.push(`Worst: ${sym(st.worst.symbol)} ${st.worst.dir === 'L' ? 'LONG' : 'SHORT'} ${fmt(st.worst.r_net ?? st.worst.r, 2)}R`);
  }
  lines.push('');
  lines.push(`<b>$${acct()} account · ${fmt(CFG.riskPct, 0)}% risk → ${st.usd > 0 ? '+' : ''}$${fmt(st.usd, 0)}</b>`);
  lines.push('');
  lines.push('<i>R = the unit you risk. 1R is the distance from entry to stop.');
  lines.push('Every number here is NET — fees and slippage already deducted.');
  lines.push('Losing trades are included. Past results do not predict future ones.</i>');

  if (forFree) {
    lines.push('');
    lines.push('<b>Every one of these was posted in VIP before it opened</b>, with entry, stop and targets.');
    if (memberCount) lines.push(`${memberCount} members saw them in real time.`);
    lines.push('');
    lines.push(`<i>${RISK}</i>`);
    return { text: lines.join('\n'), reply_markup: vipBtn('perf') };
  }
  lines.push('');
  lines.push(`<i>${RISK}</i>`);
  return { text: lines.join('\n') };
}

/* ============================================================
   DAILY RECAP (free shop window)
   ============================================================ */
export function dailyRecapFree(st, openN) {
  const lines = [];
  lines.push(`🌙 <b>DAILY CLOSE</b> · ${trShort(Date.now())}`);
  lines.push('');
  if (!st.n) {
    lines.push('No trades closed today.');
    lines.push(openN ? `${openN} position(s) still running, tracked in VIP.` : 'The system found no qualifying setup — and did not force one.');
  } else {
    lines.push(`Trades: <b>${st.n}</b> · Winners: <b>${st.win}</b> · Hit rate: <b>${fmt(st.winPct, 0)}%</b>`);
    lines.push(`Net for the day: <b>${st.tot > 0 ? '+' : ''}${fmt(st.tot, 2)}R</b> (${st.usd > 0 ? '+' : ''}$${fmt(st.usd, 0)} on a $${acct()} account)`);
    if (st.best) lines.push(`Best of the day: <b>${sym(st.best.symbol)}</b> ${fmt(st.best.r_net ?? st.best.r, 2)}R`);
    if (openN) lines.push(`${openN} position(s) still open.`);
  }
  lines.push('');
  lines.push('Every one of these was called in <b>VIP in real time</b>, with the entry.');
  lines.push('Here you see the result. In VIP you see the trade.');
  lines.push('');
  lines.push(`<i>${RISK}</i>`);
  return { text: lines.join('\n'), reply_markup: vipBtn('recap') };
}

/* ============================================================
   DM MESSAGES — bilingual
   ============================================================ */
export function startMsg(name, lang = 'en') {
  if (lang === 'tr') {
    return [
      `Merhaba ${name || ''}! 👋`, '',
      '<b>FADE sinyal sistemi</b> — pump ve dump\'ların tükendiği yeri avlar.', '',
      'Her coin için üç fazlı onay arar:',
      '• <b>Tip</b> — hareketi spot mu taşıyor, kaldıraç mı (OI analizi)',
      '• <b>Tükenme</b> — fitil, hacim sönümü, CVD dönüşü, OI erimesi (5 kontrol)',
      '• <b>Tetik</b> — likidite süpürmesi, başarısız retest, yapı kırılımı (4 kontrol)', '',
      'Onay gelmezse <b>işlem açılmaz</b>.', '',
      '<b>Komutlar</b>',
      '/vip — VIP üyelik ve fiyatlar',
      '/join — taze VIP davet linki (üyeler)',
      '/status — üyeliğim ne zaman bitiyor',
      '/performance — son 30 günün net sonucu',
      '/how — sistem nasıl çalışır',
      '/id — Telegram numaram',
      '/language — dil değiştir', '',
      `Ücretsiz kanal: ${ENV.freeLink}`,
    ].join('\n');
  }
  return [
    `Hey ${name || 'there'}! 👋`, '',
    '<b>FADE signal system</b> — it hunts the point where pumps and dumps run out of fuel.', '',
    'Every coin has to clear three phases:',
    '• <b>Type</b> — is spot buying driving this move, or leverage? (open interest)',
    '• <b>Exhaustion</b> — wick, volume decay, CVD reversal, OI bleed (5 checks)',
    '• <b>Trigger</b> — liquidity sweep, failed retest, structure break (4 checks)', '',
    'No confirmation, <b>no trade</b>. A veto means the coin is left alone.', '',
    '<b>Commands</b>',
    '/vip — VIP membership and pricing',
    '/join — get a fresh VIP invite link (members)',
    '/status — when does my membership end',
    '/performance — net result of the last 30 days',
    '/how — how the system works',
    '/id — my Telegram ID',
    '/language — change language', '',
    `Free channel: ${ENV.freeLink}`,
  ].join('\n');
}

/* VIP sales message — confident, but no invented numbers and no guarantees. */
export function vipMsg(plans, lang = 'en') {
  const lines = [];
  if (lang === 'tr') {
    lines.push('⭐ <b>VIP ÜYELİK</b>', '');
    lines.push('<b>VIP\'te ne var?</b>');
    lines.push('• Sinyal <b>anında</b> — giriş, stop, TP1, TP2, R:R');
    lines.push('• <b>Pozisyon boyutu</b> — hesabına göre kaç lot, kaç dolar risk');
    lines.push('• Günlük brifing — izleme listesi, tetik bekleyen kurulumlar, rejim filtreleri');
    lines.push('• Açık pozisyon takibi ve kısmi çıkış bildirimleri');
    lines.push('• Haftalık + aylık detaylı performans dökümü', '');
    lines.push('<b>Ücretsiz kanalda ne var?</b>');
    lines.push(`• Günde 1 sinyal, ${ENV.freeDelayMin} dk gecikmeli ve <b>seviyesiz</b>`);
    lines.push('• Günlük analiz, kapanış özeti, performans tabloları', '');
  } else {
    lines.push('⭐ <b>VIP MEMBERSHIP</b>', '');
    lines.push('Most channels sell you a coin name and an arrow. This one sells you a <b>plan</b>.', '');
    lines.push('<b>What VIP gets</b>');
    lines.push('• Every signal <b>the second it fires</b> — entry, stop, TP1, TP2, R:R');
    lines.push('• <b>Position size</b> — how much to buy, how many dollars at risk, for your account');
    lines.push('• Daily briefing — watchlist with levels, setups awaiting their trigger, regime filters');
    lines.push('• Live tracking of open positions and partial-exit alerts');
    lines.push('• Weekly and monthly performance breakdown — <b>losses included</b>', '');
    lines.push('<b>What the free channel gets</b>');
    lines.push(`• One signal a day, ${ENV.freeDelayMin} min delayed, with <b>no levels</b>`);
    lines.push('• Daily analysis, the closing recap, performance tables', '');
    lines.push('<b>Why the system is different</b>');
    lines.push('It does not predict. It waits for a move to <b>exhaust</b> and measures it:');
    lines.push('open interest, taker flow, CVD, liquidity sweeps, order-book depth,');
    lines.push('liquidation cascades, volume profile. 400+ pairs, 24/7.');
    lines.push('Most days it finds <b>zero or one</b> setup. That is the point —');
    lines.push('a channel that fires ten signals a day has lowered its standards.', '');
  }

  lines.push(L(lang, '<b>PRICING</b> — pay in crypto (USDT, BTC, ETH and 100+ more)',
    '<b>FİYATLAR</b> (kripto ile ödeme — USDT, BTC, ETH ve 100+ coin)'));
  plans.forEach((p) => {
    const monthly = p.price / (p.days / 30);
    lines.push(`• <b>${p.name}</b> — $${p.price}${p.days > 31 ? `  <i>(${L(lang, '$' + fmt(monthly, 0) + '/mo', 'ayda $' + fmt(monthly, 0))})</i>` : ''}`);
  });
  lines.push('');
  lines.push(L(lang,
    'Your <b>single-use invite link</b> arrives automatically once the payment confirms.',
    'Ödeme sonrası <b>tek kullanımlık davet linki</b> otomatik gelir.'));
  lines.push('');
  lines.push(L(lang,
    `<i>${RISK} Past performance does not guarantee future results. Trading is risky — only risk what you can afford to lose.</i>`,
    `<i>${RISK_TR} Geçmiş performans gelecek sonuçların garantisi değildir.</i>`));
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

export function languageKeyboard() {
  return {
    inline_keyboard: [[
      { text: '🇬🇧 English', callback_data: 'lang:en' },
      { text: '🇹🇷 Türkçe', callback_data: 'lang:tr' },
    ]],
  };
}

export function languageMsg(lang = 'en') {
  return L(lang,
    '🌐 <b>Language</b>\n\nPick the language for your private messages with this bot.\nChannel posts stay in English — the channels are global.',
    '🌐 <b>Dil</b>\n\nBotla özel yazışma dilini seç.\nKanal gönderileri İngilizce kalır — kanallar global.');
}

export function languageSet(lang) {
  return L(lang,
    '✅ Language set to English.',
    '✅ Dil Türkçe olarak ayarlandı.');
}

export function invoiceMsg(plan, url, lang = 'en', { discountPct = 0, listPrice = null } = {}) {
  const priceLine = discountPct > 0 && listPrice
    ? L(lang, `<s>$${listPrice}</s> <b>$${plan.price}</b> — ${discountPct}% returning-member discount`,
      `<s>$${listPrice}</s> <b>$${plan.price}</b> — %${discountPct} geri dönen üye indirimi`)
    : `<b>$${plan.price}</b>`;
  return L(lang, [
    `💳 <b>${plan.name} VIP</b> — ${priceLine}`, '',
    'On the payment page you can pay with any coin you like (USDT TRC20 has the lowest network fee).', '',
    `<a href="${url}">👉 Open payment page</a>`, '',
    'The moment the payment confirms on-chain, your VIP invite link lands here automatically.',
    'That usually takes 1–10 minutes. You can close the page.',
  ].join('\n'), [
    `💳 <b>${plan.name} VIP</b> — ${priceLine}`, '',
    'Ödeme sayfasında istediğin kripto parayı seçebilirsin (USDT TRC20 en düşük komisyonlu).', '',
    `<a href="${url}">👉 Ödemeyi aç</a>`, '',
    'Ödeme ağda onaylandığı anda VIP davet linki buraya otomatik gelir.',
    'Bu genelde 1-10 dakika sürer.',
  ].join('\n'));
}

export function grantMsg(plan, expiresAt, link, lang = 'en') {
  const linkEn = link
    ? [`<a href="${link}">⭐ Join the VIP channel</a>`, '',
      '<i>This link is yours alone and works once. If someone else uses it they are removed, and you can get a new one with /join.</i>']
    : ['Your invite link could not be generated automatically.',
      'Send /join in a minute and it will be created — or message the admin.'];
  const linkTr = link
    ? [`<a href="${link}">⭐ VIP kanala katıl</a>`, '',
      '<i>Bu link sana özel ve tek kullanımlık. Başkası kullanırsa çıkarılır, sen de /join ile yenisini alırsın.</i>']
    : ['Davet linki otomatik üretilemedi.',
      'Bir dakika sonra /join yaz, link oluşturulur — ya da yöneticiye yaz.'];
  return L(lang, [
    '✅ <b>Payment received — your VIP access is live!</b>', '',
    `Plan: <b>${plan}</b>`,
    `Expires: <b>${trDateTime(expiresAt)}</b>`, '',
    ...linkEn, '',
    'Welcome aboard. Signals start landing the moment the next setup clears.',
  ].join('\n'), [
    '✅ <b>Ödeme alındı — VIP üyeliğin aktif!</b>', '',
    `Plan: <b>${plan}</b>`,
    `Bitiş: <b>${trDateTime(expiresAt)}</b>`, '',
    ...linkTr, '',
    'Hoş geldin.',
  ].join('\n'));
}

// reminder before expiry — always sent together with the plan buttons (renew in one tap)
export function expireSoonMsg(days, lang = 'en') {
  return L(lang, [
    `⏰ <b>Your VIP access ends in ${days} day${days === 1 ? '' : 's'}.</b>`, '',
    'Renew now and the new time is <b>added on top</b> of what you have left — you lose nothing by renewing early.',
    'If it lapses you are removed from the channel automatically; renewing puts you straight back.',
  ].join('\n'), [
    `⏰ <b>VIP üyeliğin ${days} gün sonra bitiyor.</b>`, '',
    'Şimdi yenilersen yeni süre kalan sürenin <b>üstüne eklenir</b> — erken yenilemekle bir şey kaybetmezsin.',
    'Süre biterse kanaldan otomatik çıkarılırsın; yenileyince hemen geri alınırsın.',
  ].join('\n'));
}

export function expiredMsg(lang = 'en') {
  return L(lang, [
    '⌛️ <b>Your VIP membership has ended.</b>', '',
    'You have been removed from the VIP channel. Pick a plan below to come back — your new invite link arrives the moment the payment confirms.', '',
    `You can stay in the free channel: ${ENV.freeLink}`,
  ].join('\n'), [
    '⌛️ <b>VIP üyeliğin sona erdi.</b>', '',
    'VIP kanaldan çıkarıldın. Geri dönmek için aşağıdan bir plan seç — ödeme onaylanınca yeni davet linkin gelir.', '',
    `Ücretsiz kanal: ${ENV.freeLink}`,
  ].join('\n'));
}

// one-time nudge a few days after the membership lapsed
export function winbackMsg(lang = 'en') {
  return L(lang, [
    '👋 <b>Still thinking about VIP?</b>', '',
    'Since you left, the system kept scanning 400+ pairs around the clock and posting every setup with its entry, stop and targets.',
    'Your seat is open whenever you want it back — pick a plan below.', '',
    '<i>This is the only reminder you will get.</i>',
  ].join('\n'), [
    '👋 <b>VIP\'i hâlâ düşünüyor musun?</b>', '',
    'Sen ayrıldıktan sonra da sistem 400+ pariteyi tarayıp her kurulumu giriş, stop ve hedefleriyle paylaştı.',
    'İstediğin zaman geri dönebilirsin — aşağıdan bir plan seç.', '',
    '<i>Bu, alacağın tek hatırlatma.</i>',
  ].join('\n'));
}

export function joinMsg(link, lang = 'en') {
  return L(lang, [
    '🔑 <b>Your VIP invite link</b>', '',
    `<a href="${link}">⭐ Join the VIP channel</a>`, '',
    '<i>Single-use and made for you. It expires in 3 days.</i>',
  ].join('\n'), [
    '🔑 <b>VIP davet linkin</b>', '',
    `<a href="${link}">⭐ VIP kanala katıl</a>`, '',
    '<i>Tek kullanımlık ve sana özel. 3 gün geçerli.</i>',
  ].join('\n'));
}

export const joinNoAccessMsg = (lang = 'en') => L(lang,
  'You have no active VIP membership, so there is no invite to give.\n\nSend /vip to see the plans.',
  'Aktif VIP üyeliğin yok, o yüzden verecek bir davet yok.\n\n/vip yazarak planları görebilirsin.');

export const joinFailedMsg = (lang = 'en') => L(lang,
  'Could not create the invite link right now. Please try again in a minute — the admin has been told.',
  'Davet linki şu an oluşturulamadı. Bir dakika sonra tekrar dene — yönetici bilgilendirildi.');

export const unauthorizedJoinMsg = (lang = 'en') => L(lang,
  'That VIP link belongs to a paying member, so you were removed from the channel.\nSend /vip to get your own access.',
  'O VIP linki ödeme yapan bir üyeye ait, bu yüzden kanaldan çıkarıldın.\nKendi erişimin için /vip yaz.');

export function statusMsg(v, lang = 'en') {
  if (!v || v.status !== 'aktif') {
    return L(lang,
      'You have no active VIP membership.\n\nSend /vip to see the plans.',
      'Aktif VIP üyeliğin yok.\n\n/vip yazarak planları görebilirsin.');
  }
  const left = Math.ceil((Date.parse(v.expires_at) - Date.now()) / 864e5);
  return L(lang, [
    '⭐ <b>VIP membership active</b>', '',
    `Plan: <b>${v.plan || '—'}</b>`,
    `Expires: <b>${trDateTime(Date.parse(v.expires_at))}</b>`,
    `Remaining: <b>${left} day(s)</b>`,
  ].join('\n'), [
    '⭐ <b>VIP üyelik aktif</b>', '',
    `Plan: <b>${v.plan || '—'}</b>`,
    `Bitiş: <b>${trDateTime(Date.parse(v.expires_at))}</b>`,
    `Kalan: <b>${left} gün</b>`,
  ].join('\n'));
}

// /vip for someone who already has VIP: status first, then the extend options
export function vipActiveMsg(v, lang = 'en') {
  return statusMsg(v, lang) + '\n\n' + L(lang,
    'Extend below — the new time is added to what you have left.\nLost your invite link? Send /join.',
    'Uzatmak için aşağıdan seç — yeni süre kalan sürenin üstüne eklenir.\nDavet linkini kaybettiysen /join yaz.');
}

export function howMsg(lang = 'en') {
  if (lang === 'tr') {
    return [
      '<b>FADE SİSTEMİ NASIL ÇALIŞIR?</b>', '',
      'Sistem trend takip etmez. <b>Aşırıya giden hareketin tükendiği</b> yeri arar.', '',
      '<b>1. FAZ — Hareketi kim taşıyor?</b>',
      'Open Interest eriyorken fiyat yükseliyorsa bu bir <i>short squeeze</i>: zorunlu alımlar. Yakıt bitince düşer.',
      'OI şişiyorsa kaldıraçlı trend — sistem <b>dokunmaz</b>.', '',
      '<b>2. FAZ — Tükendi mi? (5 kontrol, en az 3)</b>',
      'Üst fitil · hacim sönümü · CVD dönüşü · OI erimesi · taker soğuması', '',
      '<b>3. FAZ — Tetik var mı? (4 kontrol, en az 1)</b>',
      'Likidite süpürmesi · başarısız retest · yapı kırılımı · aVWAP reddi', '',
      '<b>VETOLAR</b>',
      'OI şişmesi · BTC ters impulsta · makro olay/şok · coin 30 günden yeni', '',
      `İşlem başına %${fmt(CFG.riskPct, 0)} risk · max ${CFG.maxOpen} pozisyon · gün ${fmt(CFG.dailyStopR, 0)}R'ye inerse durur.`, '',
      `<i>${RISK_TR}</i>`,
    ].join('\n');
  }
  return [
    '<b>HOW THE FADE SYSTEM WORKS</b>', '',
    'It does not follow trends. It hunts the point where an overextended move <b>runs out of fuel</b>.', '',
    '<b>PHASE 1 — Who is carrying this move?</b>',
    'If price is rising while open interest <i>falls</i>, the rally is being carried by shorts being forced to buy — a squeeze. That fuel is finite.',
    'If open interest is <i>swelling</i>, it is a leveraged trend. The system <b>does not touch it</b> — it vetoes.', '',
    '<b>PHASE 2 — Is it exhausted? (5 checks, 3 required)</b>',
    '• Long upper wick on the peak candle — buyers got rejected',
    '• Volume decay — interest is gone',
    '• CVD reversal — aggressive buying is drying up',
    '• Open interest bleeding from the top — positions closing',
    '• Taker buy ratio cooling', '',
    '<b>PHASE 3 — Is there a trigger? (4 checks, 1 required)</b>',
    '• <b>Liquidity sweep</b> — breaking the prior high then closing below it. The highest-quality trigger.',
    '• Failed retest · Structure break · Anchored VWAP rejection', '',
    '<b>VETOES — any one of these and there is no trade</b>',
    'Open interest swelling · BTC in a counter-impulse · macro event window or BTC shock · coin listed less than 30 days ago', '',
    '<b>STOPS AND TARGETS</b>',
    'The stop comes from structure but is bounded by the coin\'s own ATR — it can be neither too tight nor too wide.',
    'Targets are never invented. They are picked from real levels — POC, value area, order-book walls, the liquidation cascade stall, fib, anchored VWAP, EMAs, support/resistance — and only if they are <b>reachable</b>.',
    'A target\'s expected time cannot exceed 3× the stop\'s expected time, or the R:R only exists on paper.', '',
    '<b>RISK</b>',
    `${fmt(CFG.riskPct, 0)}% risk per trade · max ${CFG.maxOpen} positions at once · if the day hits ${fmt(CFG.dailyStopR, 0)}R the system stops.`, '',
    'All performance figures are <b>net</b> — fees and slippage deducted. Losing trades are published too.', '',
    `<i>${RISK}</i>`,
  ].join('\n');
}

/* ============================================================
   EDUCATION
   ============================================================ */
export function eduPost(lesson, { forFree = false, idx = null, total = null } = {}) {
  const lines = [];
  lines.push(`📚 <b>${lesson.title}</b>`);
  lines.push(`<i>${lesson.tag}${idx && total ? ` · lesson ${idx}/${total}` : ''}</i>`);
  lines.push('');
  lines.push(lesson.body);

  if (forFree) {
    lines.push('');
    lines.push('—');
    lines.push('Tracking these checks by hand across 400+ pairs is not possible.');
    lines.push('The system scans them 24/7 and only speaks when all three phases line up ⤵️');
    return { text: lines.join('\n'), reply_markup: vipBtn('edu') };
  }
  return { text: lines.join('\n') };
}

/* ============================================================
   NEWS
   ============================================================ */
/* One story, two products.
   VIP gets the "desk view": how to trade around it, the live market state, the coins it names
   and our open book. Free gets the story and why it matters, and a pointer to VIP.
   Everything in the desk view comes from live data or from general rules that match what the
   system actually does — nothing is predicted. */
/* News posts carry no numbers of our own: no scores, counters, percentages or market statistics. Only plain language. */
const sinceWords = (ms) => (ms <= 45 * 60e3 ? 'just now' : ms <= 6 * 3600e3 ? 'earlier today' : 'today');
const moodWords = (ctx) => {
  const out = [];
  if (ctx.rejim) out.push(regimeEn(ctx.rejim));
  if (ctx.shock != null) out.push(ctx.shock > 2.5 ? 'the market is jumpy right now ⚠️' : 'the market is calm');
  if (ctx.breadth && ctx.breadth.n) out.push(ctx.breadth.up > ctx.breadth.dn * 2 ? 'most coins are rising' : ctx.breadth.dn > ctx.breadth.up * 2 ? 'most coins are falling' : 'the market is mixed');
  return out;
};

export function newsFlash(item, ctx = {}, { forFree = false } = {}) {
  const age = Date.now() - item.at;
  const label = age <= 45 * 60e3 ? '🚨 <b>BREAKING</b>' : '📰 <b>NEWS</b>';
  const lines = [];
  lines.push(`${label}${item.tags?.length ? ` · ${esc(item.tags[0])}` : ''}`);
  lines.push('');
  lines.push(`<b>${esc(item.title)}</b>`);
  lines.push(`<i>${esc(item.source)} · ${sinceWords(age)}</i>`);
  if (item.url) lines.push(`<a href="${escAttr(item.url)}">read the story →</a>`);
  lines.push('');
  if (item.why) { lines.push('<b>Why it matters</b>'); lines.push(esc(item.why)); lines.push(''); }
  if (item.what?.length) { lines.push('<b>What could happen</b>'); item.what.forEach((w) => lines.push(`• ${esc(w)}`)); lines.push(''); }

  if (!forFree) {
    lines.push('<b>How to trade around it</b>');
    if (item.tip) lines.push(`• ${esc(item.tip)}`);
    const mood = moodWords(ctx);
    if (mood.length) lines.push(`• Market right now: ${mood.join(', ')}.`);
    if (ctx.coins?.length) lines.push('• Named in the story: ' + ctx.coins.map((c) => `${esc(c.base)}${c.watch ? ' (on our watchlist)' : ''}`).join(', '));
    if (ctx.open?.length) lines.push('• Open book: ' + ctx.open.slice(0, 3).map((o) => `${sym(o.symbol)} ${o.dir === 'L' ? 'long' : 'short'}`).join(', '));
    const macroRed = ctx.macro?.lvl === 'kırmızı';
    lines.push('• System stance: ' + (macroRed ? 'inside a macro window, no new positions until it passes.'
      : ctx.shock > 2.5 ? 'BTC is in shock, no new positions while the structure is unreliable.'
        : 'normal operation. A headline changes no rule; a setup still needs all three phases.'));
    lines.push('');
  } else {
    lines.push('VIP members also get how to trade around the story, the live market state and our open book ⤵️');
    lines.push('');
  }
  if (item.lang === 'tr') { lines.push('<i>Headline kept in the source language to avoid translation drift.</i>'); lines.push(''); }
  lines.push(`<i>${RISK}</i>`);
  return forFree ? { text: lines.join('\n'), reply_markup: vipBtn('news') } : { text: lines.join('\n') };
}

export function newsDigest(items, ctx = {}, { forFree = false } = {}) {
  const lines = [];
  lines.push('📰 <b>TODAY IN CRYPTO</b>');
  lines.push('');
  if (!items.length) {
    lines.push(ctx.flashToday ? 'The big story of the day was covered above, nothing else moved the market.' : 'Nothing market-moving surfaced today. A quiet day is not a bad day: the system keeps waiting for a setup.');
    lines.push('');
  } else {
    items.forEach((it) => {
      lines.push(`• ${esc(it.title)}`);
      lines.push(`<i>${esc(it.source)}${it.tags?.length ? ' · ' + esc(it.tags.join(', ')) : ''}</i>`);
      if (it.url) lines.push(`<a href="${escAttr(it.url)}">read →</a>`);
      lines.push('');
    });
  }
  const mood = moodWords(ctx);
  if (mood.length) { lines.push('<b>Market state:</b> ' + mood.join(', ') + '.'); lines.push(''); }
  if (!forFree && items[0]?.tip) { lines.push('<b>How to trade around it</b>'); lines.push(`• ${esc(items[0].tip)}`); lines.push(''); }
  if (forFree) { lines.push('VIP gets how to trade around every story and what our open book is doing ⤵️'); lines.push(''); }
  lines.push(`<i>${RISK}</i>`);
  return forFree ? { text: lines.join('\n'), reply_markup: vipBtn('news') } : { text: lines.join('\n') };
}

// kept for backward compatibility with older imports
export const nasilMsg = howMsg;


/* ============================================================
   v1k pump fade (experimental, live forward test). Honest wording: no performance claims, risk stated, every result posted.
   ============================================================ */
const utc = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
export function v1kSignal(row, key = null) {
  const f = row.features || {};
  const px = f.px, D = f.px >= 100 ? 2 : f.px >= 1 ? 4 : f.px >= 0.01 ? 5 : 7;
  const p = (v) => fmt(v, D);
  const t0 = Date.parse(row.sig_at);
  const lines = [];
  lines.push('🧪 <b>EXPERIMENTAL · extreme pump fade</b>');
  lines.push(`🔻 <b>${sym(row.symbol)}</b> · SHORT`);
  lines.push('');
  lines.push(`Entry: around <b>${p(px)}</b> (close of the signal candle)`);
  lines.push(`Stop: <b>${p(px * 1.5)}</b> (+50%)`);
  lines.push(`Exit: <b>${utc(t0 + 864e5)}</b> (24h), no take-profit`);
  lines.push('');
  lines.push(`Why: <b>${pct(f.chg24)}</b> in 24h, <b>${pct(f.r15)}</b> in the last 15m, BTC weak (${pct(f.btc24)} / 24h), new open interest is drying up (${f.oi15 == null ? 'n/a' : pct(f.oi15)} in 15m).`);
  lines.push('');
  lines.push('<b>Size: 1x leverage only, at most 5% of your account.</b> A stop-out costs about 2.5% of the account. A stop at +50% means 2x or more can be liquidated before it triggers.');
  lines.push('This rule is in a live forward test. Every result, wins and losses, is posted. It has no proven track record yet.');
  lines.push('');
  lines.push(`<i>${RISK}</i>`);
  return lines.join('\n');
}
const SHOWCASE_NOTE = 'Showcase: we show selected positions that are in profit when posted. Not every signal is shown. The final result of every showcased position is posted here, wins and losses.';
export function v1kShowcase(row, profitPct) {
  const f = row.features || {};
  const D = f.px >= 100 ? 2 : f.px >= 1 ? 4 : f.px >= 0.01 ? 5 : 7;
  const lines = [];
  lines.push('📈 <b>POSITION IN PROFIT</b> · extreme pump fade');
  lines.push(`🔻 <b>${sym(row.symbol)}</b> · SHORT`);
  lines.push('');
  lines.push(`The coin had already pumped hard, BTC was weak and new open interest was drying up when the system took the short around <b>${fmt(f.px, D)}</b>.`);
  lines.push(`It is currently <b>+${fmt(profitPct, 1)}%</b> in profit and still open. The result will be posted when it closes, whatever it is.`);
  lines.push('');
  lines.push('VIP members get more tools, analysis and the system\'s live signals ⤵️');
  lines.push('');
  lines.push(`<i>${SHOWCASE_NOTE}</i>`);
  lines.push(`<i>${RISK}</i>`);
  return { text: lines.join('\n'), reply_markup: vipBtn('v1k', row.key || null) };
}
export function v1kResult(row) {
  const v = row.variants.K1;
  const win = v.net > 0;
  const lines = [];
  lines.push(`${win ? '✅' : '🔴'} <b>RESULT · ${sym(row.symbol)}</b> · SHORT`);
  lines.push(`${v.exit === 'stop' ? 'Stopped out' : 'Closed after 24 hours'}: <b>${v.net > 0 ? '+' : ''}${fmt(v.net, 1)}%</b> of the position (after fees and funding).`);
  lines.push('');
  lines.push(`<i>${SHOWCASE_NOTE}</i>`);
  lines.push(`<i>${RISK}</i>`);
  return { text: lines.join('\n') };
}
