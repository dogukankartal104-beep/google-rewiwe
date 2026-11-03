// Dashboard: toplu veri (JSON) + tek sayfa HTML.
// Mevcut bot container'ında çalışır — ayrı Railway servisi yok.
// Toplu veri 60 sn önbelleklenir, böylece sayfa yenilendikçe Supabase yorulmaz.
import crypto from 'node:crypto';
import { ENV, CFG } from './config.js';
import * as db from './db.js';
import * as tg from './telegram.js';
import { stats } from './tracker.js';
import { MARKET } from './scanner.js';
import { dayKey } from './publisher.js';
import { trDayStart, trDate, fmt, warn } from './util.js';

export function keyOk(given) {
  if (!ENV.dashKey) return false;
  const a = Buffer.from(String(given || ''), 'utf8');
  const b = Buffer.from(ENV.dashKey, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

let CACHE = { t: 0, data: null };
const TTL = 60_000;

export async function aggregate({ force = false } = {}) {
  if (!force && CACHE.data && Date.now() - CACHE.t < TTL) return CACHE.data;

  const now = Date.now();
  const d0 = trDayStart();
  const iso = (t) => new Date(t).toISOString();

  const safe = async (p, dflt) => { try { return (await p) ?? dflt; } catch (e) { warn('dash:', e.message); return dflt; } };

  const [
    vipActive, openSig, closed30, closedToday, pays30, joinedToday,
    clicks7, chStats, recentSig, recentPays, users, eduFree, eduVip,
  ] = await Promise.all([
    safe(db.vipActive(), []),
    safe(db.openSignals(), []),
    safe(db.closedBetween(iso(now - 30 * 864e5), iso(now + 6e4)), []),
    safe(db.closedBetween(iso(d0), iso(d0 + 864e5)), []),
    safe(db.paySince(iso(now - 30 * 864e5)), []),
    safe(db.vipJoinedSince(iso(d0)), []),
    safe(db.clicksSince(iso(now - 7 * 864e5)), []),
    safe(db.statsHistory(30), []),
    safe(db.signalsRecent(25), []),
    safe(db.payRecent(15), []),
    safe(db.usersCount(), 0),
    safe(db.eduLast('free'), null),
    safe(db.eduLast('vip'), null),
  ]);

  const st30 = stats(closed30);
  const stToday = stats(closedToday);

  // --- ödemeler ---
  const credited = pays30.filter((p) => p.credited);
  const paidToday = credited.filter((p) => Date.parse(p.credited_at || p.created_at) >= d0);
  const revenue30 = credited.reduce((a, p) => a + (p.amount || 0), 0);
  const revenueToday = paidToday.reduce((a, p) => a + (p.amount || 0), 0);
  const pending = pays30.filter((p) => !p.credited && ['waiting', 'confirming', 'sending'].includes(p.status));

  // --- tıklamalar ---
  const clicksToday = clicks7.filter((c) => Date.parse(c.created_at) >= d0);
  const bySource = {};
  clicks7.forEach((c) => { bySource[c.source || '?'] = (bySource[c.source || '?'] || 0) + 1; });

  // --- abone sayısı + değişim ---
  const chanNow = {}, chanPrev = {};
  for (const ch of ['free', 'vip']) {
    const rows = chStats.filter((x) => x.channel === ch).sort((a, b) => (a.day < b.day ? 1 : -1));
    chanNow[ch] = rows[0]?.members ?? null;
    chanPrev[ch] = rows.find((x) => x.day !== rows[0]?.day)?.members ?? null;
  }

  // --- günlük R eğrisi (son 30 gün) ---
  const daily = {};
  closed30.forEach((s) => {
    if (!s.closed_at) return;
    const d = trDate(Date.parse(s.closed_at));
    const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const v = db.netOf(s);
    if (!Number.isFinite(v)) return;
    daily[k] = daily[k] || { r: 0, n: 0 };
    daily[k].r += v; daily[k].n++;
  });
  const curve = [];
  let cum = 0;
  for (let i = 29; i >= 0; i--) {
    const d = trDate(now - i * 864e5);
    const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const v = daily[k]?.r || 0;
    cum += v;
    curve.push({ day: k.slice(5), r: +v.toFixed(2), cum: +cum.toFixed(2), n: daily[k]?.n || 0 });
  }

  // --- VIP süre dağılımı ---
  const expiring7 = vipActive.filter((v) =>
    Date.parse(v.expires_at) < now + 7 * 864e5).length;

  const riskUsd = (CFG.acct * CFG.riskPct) / 100;

  const data = {
    ts: new Date().toISOString(),
    gun: dayKey(),
    sistem: {
      sonTarama: MARKET.lastScan || null,
      taranan: MARKET.scanned,
      izlemede: MARKET.watchlist.length,
      btc15: MARKET.btc15,
      sok: MARKET.shock,
      rejim: MARKET.reg?.label || null,
      btcFiyat: MARKET.reg?.btc?.p ?? null,
      dvol: MARKET.dvol?.pctl ?? null,
      genislik: MARKET.breadth,
      dryRun: ENV.dryRun,
      acikMax: CFG.maxOpen,
      riskPct: CFG.riskPct,
      acct: CFG.acct,
    },
    para: {
      aktifVip: vipActive.length,
      bugunGiren: joinedToday.length,
      bugunGelir: +revenueToday.toFixed(2),
      gelir30: +revenue30.toFixed(2),
      bekleyenOdeme: pending.length,
      yakindaBitecek7: expiring7,
      dmKullanici: users,
      ortalamaUyelik: vipActive.length
        ? +(revenue30 / Math.max(1, credited.length)).toFixed(2) : 0,
    },
    kanal: {
      freeUye: chanNow.free, freeOnceki: chanPrev.free,
      vipUye: chanNow.vip, vipOnceki: chanPrev.vip,
      tiklamaBugun: clicksToday.length,
      tiklama7: clicks7.length,
      tiklamaKaynak: bySource,
      donusum7: clicks7.length
        ? +((joinedToday.length / clicks7.length) * 100).toFixed(1) : null,
    },
    performans: {
      bugun: {
        n: stToday.n, r: +stToday.tot.toFixed(2), isabet: +stToday.winPct.toFixed(0),
        usd: +(stToday.tot * riskUsd).toFixed(0),
      },
      g30: {
        n: st30.n, r: +st30.tot.toFixed(2), isabet: +st30.winPct.toFixed(0),
        ortalama: +st30.avg.toFixed(2), pf: st30.pf ? +st30.pf.toFixed(2) : null,
        mdd: +st30.mdd.toFixed(2), usd: +(st30.tot * riskUsd).toFixed(0),
        tp: st30.tpHit, stop: st30.stopHit, zaman: st30.timeOut,
        sinif: st30.byGrade, yon: st30.byDir,
      },
      egri: curve,
    },
    acik: openSig.map((s) => ({
      sembol: s.symbol, yon: s.dir, sinif: s.grade,
      r: s.open_r ?? 0, maxR: s.max_r, giris: s.entry, stop: s.stop,
      tp1: s.tp1, dec: s.decimals, kismi: s.partial,
      acilis: s.created_at,
    })),
    sonSinyaller: recentSig.map((s) => ({
      sembol: s.symbol, yon: s.dir, sinif: s.grade, tip: s.type,
      durum: s.status, r: s.r_net ?? s.r ?? s.open_r ?? null,
      rr: s.rr, tarih: s.created_at,
      freeGitti: Boolean(s.free_posted_at), freeTur: s.free_kind,
      atlandi: s.free_skipped ? s.free_skip_why : null,
    })),
    sonOdemeler: recentPays.map((p) => ({
      plan: p.plan, tutar: p.amount, durum: p.status,
      islendi: p.credited, tg: p.telegram_id,
      para: p.pay_currency, tarih: p.created_at,
    })),
    egitim: {
      freeSon: eduFree?.lesson_id || null, freeTarih: eduFree?.posted_at || null,
      vipSon: eduVip?.lesson_id || null, vipTarih: eduVip?.posted_at || null,
    },
  };

  CACHE = { t: Date.now(), data };
  return data;
}

/* ============================================================
   HTML — FADE HUD görsel diliyle uyumlu, tek dosya, bağımlılıksız.
   Veriyi /api/dash'ten çeker, 60 sn'de bir yeniler.
   ============================================================ */
export function dashHtml() {
  return `<!doctype html>
<html lang="tr"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FADE Panel</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Oxanium:wght@600;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#070a0e;--panel:#0c1116;--soft:#101820;--line:#18222d;--txt:#dbe5f0;
 --dim:#65788c;--faint:#33424f;--short:#ff3b5c;--long:#16e0a0;--wait:#ffb020;--scan:#38bdf8}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--txt);
 font:13px/1.45 'IBM Plex Mono',ui-monospace,monospace}
body{padding:12px 14px 40px}
.d{font-family:'Oxanium',sans-serif;letter-spacing:.05em}
a{color:var(--scan)}
::-webkit-scrollbar{width:7px;height:7px}::-webkit-scrollbar-thumb{background:#1b2733;border-radius:4px}
.bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;
 padding:10px 13px;background:linear-gradient(180deg,#0e141b,var(--panel));
 border:1px solid var(--line);border-radius:5px}
.logo{font-family:'Oxanium';font-weight:800;font-size:16px;letter-spacing:.2em}
.logo i{color:var(--short);font-style:normal}
.mini{color:var(--dim);font-size:10px;letter-spacing:.14em;text-transform:uppercase}
.card{background:var(--panel);border:1px solid var(--line);border-radius:5px;overflow:hidden;margin-top:10px}
.hd{padding:8px 12px;font-family:'Oxanium';font-weight:600;font-size:10px;letter-spacing:.18em;
 text-transform:uppercase;color:var(--dim);border-bottom:1px solid var(--line);
 display:flex;justify-content:space-between;gap:8px}
.kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(142px,1fr))}
.k{padding:10px 12px;border-right:1px solid #0f161d;border-bottom:1px solid #0f161d}
.k u{text-decoration:none;display:block;color:var(--faint);font-size:9px;
 letter-spacing:.11em;text-transform:uppercase}
.k b{font-family:'Oxanium';font-size:20px;font-weight:600;display:block;margin-top:3px}
.k s{text-decoration:none;display:block;font-size:10px;color:var(--dim);margin-top:2px}
.up{color:var(--long)}.dn{color:var(--short)}.nt{color:var(--txt)}.hot{color:var(--wait)}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.g3{display:grid;grid-template-columns:2fr 1fr;gap:10px}
@media(max-width:900px){.g2,.g3{grid-template-columns:1fr}}
table{width:100%;border-collapse:collapse;font-size:11.5px}
th{text-align:left;padding:6px 10px;color:var(--faint);font-size:9px;
 letter-spacing:.1em;text-transform:uppercase;border-bottom:1px solid var(--line);font-weight:400}
td{padding:6px 10px;border-bottom:1px solid #0f161d}
tr:hover td{background:#111a23}
.tag{font-size:9.5px;padding:2px 6px;border:1px solid var(--line);border-radius:99px;color:var(--dim)}
.bars{display:flex;align-items:flex-end;gap:2px;height:90px;padding:10px 12px}
.bars div{flex:1;min-width:2px;position:relative;border-radius:1px 1px 0 0}
.curve{padding:10px 12px}
.row2{display:grid;grid-template-columns:auto 1fr auto;gap:4px 10px;padding:7px 12px;
 font-size:11.5px;border-bottom:1px solid #0f161d}
.row2 span:first-child{color:var(--dim)}
.warn{padding:9px 12px;color:var(--wait);font-size:11.5px}
#err{padding:9px 12px;color:var(--short);font-size:11.5px;display:none}
.lbl{color:var(--faint);font-size:10px}
</style></head><body>

<div class="bar">
  <div>
    <div class="logo d">FADE <i>PANEL</i></div>
    <div class="mini" id="sub">yükleniyor…</div>
  </div>
  <div style="text-align:right">
    <div class="mini" id="clock">—</div>
    <div class="mini" id="scan">—</div>
  </div>
</div>

<div id="err"></div>
<div class="card"><div class="hd"><span>para</span><span id="dry"></span></div>
  <div class="kpi" id="kpara"></div></div>

<div class="g2">
  <div class="card"><div class="hd">performans</div><div class="kpi" id="kperf"></div></div>
  <div class="card"><div class="hd">kanal & ilgi</div><div class="kpi" id="kkanal"></div></div>
</div>

<div class="card"><div class="hd"><span>günlük net R — son 30 gün</span>
  <span class="lbl" id="curvesum"></span></div>
  <div class="bars" id="bars"></div></div>

<div class="g3">
  <div class="card"><div class="hd">son sinyaller</div>
    <div style="max-height:340px;overflow:auto"><table id="tsig"></table></div></div>
  <div class="card"><div class="hd">açık pozisyonlar</div>
    <div id="topen"></div></div>
</div>

<div class="g2">
  <div class="card"><div class="hd">son ödemeler</div>
    <div style="max-height:280px;overflow:auto"><table id="tpay"></table></div></div>
  <div class="card"><div class="hd">sistem & dağılım</div><div id="tsys"></div></div>
</div>

<div class="card"><div class="hd">notlar</div>
<div class="warn" id="notes"></div></div>

<script>
const KEY = new URLSearchParams(location.search).get('key') || '';
const $ = s => document.querySelector(s);
const f = (v,d=2) => (v===null||v===undefined||isNaN(v)) ? '—' : Number(v).toFixed(d);
const sgn = (v,d=2) => (v===null||v===undefined||isNaN(v)) ? '—' : (v>0?'+':'')+Number(v).toFixed(d);
const cls = v => (v>0?'up':v<0?'dn':'nt');
const esc = s => String(s??'').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const sym = s => String(s||'').replace('USDT','');
const ago = t => {
  if(!t) return '—';
  const m = Math.round((Date.now()-new Date(t).getTime())/60000);
  if(m<1) return 'şimdi';
  if(m<60) return m+' dk önce';
  const h=Math.floor(m/60); if(h<24) return h+' sa önce';
  return Math.floor(h/24)+' gün önce';
};
const K = (u,b,s,c) => '<div class="k"><u>'+u+'</u><b class="'+(c||'nt')+'">'+b+'</b><s>'+(s||'')+'</s></div>';

async function load(){
  try{
    const r = await fetch('/api/dash?key='+encodeURIComponent(KEY));
    if(!r.ok){ throw new Error('yetki yok veya sunucu hatası ('+r.status+')'); }
    render(await r.json());
    $('#err').style.display='none';
  }catch(e){
    $('#err').textContent = 'Veri alınamadı: '+e.message;
    $('#err').style.display='';
  }
}

function render(d){
  $('#clock').textContent = new Date(d.ts).toLocaleString('tr-TR');
  $('#sub').textContent = d.gun + ' · $'+d.sistem.acct+' hesap · %'+d.sistem.riskPct+' risk';
  $('#scan').textContent = 'tarama '+ago(d.sistem.sonTarama)+' · '+d.sistem.taranan+' aday · '+d.sistem.izlemede+' izlemede';
  $('#dry').innerHTML = d.sistem.dryRun ? '<span class="hot">DRY_RUN AÇIK — yayın yok</span>' : '';

  // --- para ---
  const p = d.para;
  $('#kpara').innerHTML =
    K('aktif vip', p.aktifVip, p.yakindaBitecek7+' tanesi 7 gün içinde bitiyor', p.aktifVip>0?'up':'nt')
  + K('bugün giren', p.bugunGiren, p.bugunGiren?'🎉 yeni üye':'henüz yok', p.bugunGiren>0?'up':'nt')
  + K('bugün gelir', '$'+f(p.bugunGelir,0), 'son 30 gün $'+f(p.gelir30,0), p.bugunGelir>0?'up':'nt')
  + K('30 gün gelir', '$'+f(p.gelir30,0), 'ort. üyelik $'+f(p.ortalamaUyelik,0), p.gelir30>0?'up':'nt')
  + K('bekleyen ödeme', p.bekleyenOdeme, p.bekleyenOdeme?'onay bekliyor':'yok', p.bekleyenOdeme?'hot':'nt')
  + K('bota yazan', p.dmKullanici, 'toplam /start', 'nt');

  // --- performans ---
  const a = d.performans.bugun, b = d.performans.g30;
  $('#kperf').innerHTML =
    K('bugün', sgn(a.r)+'R', a.n+' işlem · isabet %'+a.isabet, cls(a.r))
  + K('30 gün net', sgn(b.r)+'R', '$'+sgn(b.usd,0)+' · '+b.n+' işlem', cls(b.r))
  + K('isabet oranı', b.n? '%'+b.isabet : '—', 'TP '+b.tp+' / stop '+b.stop+' / süre '+b.zaman, b.isabet>=50?'up':'nt')
  + K('işlem başına', sgn(b.ortalama)+'R', b.pf?('kâr faktörü '+f(b.pf)):'—', cls(b.ortalama))
  + K('max düşüş', f(b.mdd)+'R', '30 günlük en kötü seyir', b.mdd<-3?'dn':'nt')
  + K('açık pozisyon', d.acik.length+'/'+d.sistem.acikMax, d.sistem.rejim||'—', 'nt');

  // --- kanal ---
  const c = d.kanal;
  const delta = (n,o) => (n==null||o==null) ? '' : (n-o>0?'+':'')+(n-o)+' dün';
  $('#kkanal').innerHTML =
    K('free abone', c.freeUye ?? '—', delta(c.freeUye,c.freeOnceki), 'nt')
  + K('vip abone', c.vipUye ?? '—', delta(c.vipUye,c.vipOnceki), 'nt')
  + K('vip tıklama bugün', c.tiklamaBugun, '7 günde '+c.tiklama7, c.tiklamaBugun>0?'up':'nt')
  + K('tıklama kaynağı',
      Object.keys(c.tiklamaKaynak).length
        ? Object.entries(c.tiklamaKaynak).sort((x,y)=>y[1]-x[1])[0][0]
        : '—',
      Object.entries(c.tiklamaKaynak).sort((x,y)=>y[1]-x[1]).slice(0,3)
        .map(([k,v])=>k+' '+v).join(' · ') || 'veri yok', 'nt');

  // --- R grafigi ---
  const e = d.performans.egri;
  const mx = Math.max(0.5, ...e.map(x=>Math.abs(x.r)));
  $('#bars').innerHTML = e.map(x=>{
    const h = Math.max(2, Math.abs(x.r)/mx*70);
    const col = x.r>0?'var(--long)':x.r<0?'var(--short)':'#1b2733';
    return '<div title="'+x.day+' · '+sgn(x.r)+'R · '+x.n+' işlem" '
      + 'style="height:'+h+'px;background:'+col+'"></div>';
  }).join('');
  const son = e[e.length-1];
  $('#curvesum').textContent = 'kümülatif '+sgn(son?son.cum:0)+'R';

  // --- son sinyaller ---
  const durCol = s => s==='kazanç'?'up':s==='kayıp'?'dn':s==='atlandı'?'':'nt';
  $('#tsig').innerHTML =
    '<tr><th>coin</th><th>sınıf</th><th>durum</th><th>R</th><th>free</th><th>zaman</th></tr>'
  + d.sonSinyaller.map(s=>
      '<tr><td><b>'+esc(sym(s.sembol))+'</b> <span class="'+(s.yon==='L'?'up':'dn')+'">'
        +(s.yon==='L'?'▲':'▼')+'</span></td>'
    + '<td><span class="tag">'+esc(s.sinif||'—')+'</span></td>'
    + '<td class="'+durCol(s.durum)+'">'+esc(s.durum)+'</td>'
    + '<td class="'+cls(s.r)+'">'+(s.r==null?'—':sgn(s.r))+'</td>'
    + '<td class="lbl">'+(s.freeGitti?('✓ '+esc(s.freeTur||'')):(s.atlandi?('✕ '+esc(s.atlandi)):'bekliyor'))+'</td>'
    + '<td class="lbl">'+ago(s.tarih)+'</td></tr>').join('')
  + (d.sonSinyaller.length?'':'<tr><td colspan="6" class="lbl">henüz sinyal yok</td></tr>');

  // --- acik pozisyonlar ---
  $('#topen').innerHTML = d.acik.length
    ? d.acik.map(o=>
        '<div class="row2"><span>'+(o.yon==='L'?'▲':'▼')+' <b>'+esc(sym(o.sembol))+'</b></span>'
      + '<span class="lbl">'+esc(o.sinif||'')+(o.kismi?' · kısmi alındı':'')+' · '+ago(o.acilis)+'</span>'
      + '<span class="'+cls(o.r)+'"><b>'+sgn(o.r)+'R</b></span></div>').join('')
    : '<div class="warn">açık pozisyon yok</div>';

  // --- odemeler ---
  $('#tpay').innerHTML =
    '<tr><th>plan</th><th>tutar</th><th>durum</th><th>tg</th><th>zaman</th></tr>'
  + d.sonOdemeler.map(x=>
      '<tr><td>'+esc(x.plan||'—')+'</td><td>$'+f(x.tutar,0)+'</td>'
    + '<td class="'+(x.islendi?'up':'hot')+'">'+esc(x.durum)+(x.islendi?' ✓':'')+'</td>'
    + '<td class="lbl">'+esc(x.tg||'—')+'</td>'
    + '<td class="lbl">'+ago(x.tarih)+'</td></tr>').join('')
  + (d.sonOdemeler.length?'':'<tr><td colspan="5" class="lbl">henüz ödeme yok</td></tr>');

  // --- sistem ---
  const s = d.sistem, g = s.genislik||{};
  const gr = d.performans.g30.sinif||{}, yn = d.performans.g30.yon||{};
  const grRows = Object.keys(gr).sort().map(k=>
    '<div class="row2"><span>sınıf '+esc(k)+'</span><span class="lbl">'+gr[k].n+' işlem · isabet %'
    + Math.round(gr[k].win/gr[k].n*100)+'</span><span class="'+cls(gr[k].r)+'">'+sgn(gr[k].r)+'R</span></div>').join('');
  const ynRows = Object.keys(yn).map(k=>
    '<div class="row2"><span>'+esc(k)+'</span><span class="lbl">'+yn[k].n+' işlem · isabet %'
    + Math.round(yn[k].win/yn[k].n*100)+'</span><span class="'+cls(yn[k].r)+'">'+sgn(yn[k].r)+'R</span></div>').join('');
  $('#tsys').innerHTML =
    '<div class="row2"><span>BTC</span><span class="lbl">'+(s.btcFiyat?'$'+f(s.btcFiyat,0):'—')
      +' · 15dk '+sgn(s.btc15)+'%</span><span class="'+cls(s.btc15)+'">'+esc(s.rejim||'—')+'</span></div>'
  + '<div class="row2"><span>BTC şok</span><span class="lbl">ATR katı</span><span class="'
      +(s.sok>2.5?'dn':'nt')+'">'+f(s.sok,1)+'×</span></div>'
  + '<div class="row2"><span>DVOL dilim</span><span class="lbl">panik eşiği 75</span><span class="'
      +(s.dvol>75?'dn':'nt')+'">'+(s.dvol==null?'—':f(s.dvol,0)+'p')+'</span></div>'
  + '<div class="row2"><span>genişlik</span><span class="lbl">'+esc(g.note||'')+'</span><span>'
      +'<span class="up">'+(g.up??'—')+'↑</span> / <span class="dn">'+(g.dn??'—')+'↓</span></span></div>'
  + grRows + ynRows;

  // --- notlar ---
  const n = [];
  if(s.dryRun) n.push('⚠️ DRY_RUN açık: hiçbir mesaj yayınlanmıyor, sadece log\\'a yazılıyor.');
  if(d.performans.g30.n < 20) n.push('ℹ️ Henüz '+d.performans.g30.n+' kapanmış işlem var. İstatistik anlam kazanması için ~100 işlem gerekir — bu sayılara şimdilik temkinli bak.');
  if(p.bekleyenOdeme) n.push('⏳ '+p.bekleyenOdeme+' ödeme onay bekliyor (ağ onayı sürüyor olabilir).');
  if(p.yakindaBitecek7) n.push('🔔 '+p.yakindaBitecek7+' VIP üyeliği 7 gün içinde bitiyor. Bot 3 gün kalınca otomatik hatırlatıyor.');
  if(d.egitim.freeSon) n.push('📚 Son eğitim postu (free): '+esc(d.egitim.freeSon)+' · '+ago(d.egitim.freeTarih));
  n.push('Telegram Bot API gönderi görüntülenme sayısı vermiyor. Onun yerine VIP butonu tıklamaları ölçülüyor — dönüşüm için daha anlamlı bir metrik.');
  $('#notes').innerHTML = n.join('<br>');
}

load();
setInterval(load, 60000);
</script></body></html>`;
}
