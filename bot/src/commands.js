// DM komutları + inline buton akışı + admin komutları.
import { ENV, CFG } from './config.js';
import * as db from './db.js';
import * as tg from './telegram.js';
import * as M from './messages.js';
import * as np from './payments.js';
import * as vip from './vip.js';
import { applyBranding, reportText } from './brand.js';
import { makeLimiter } from './ratelimit.js';
import {
  perfLastDays, publishDaily, publishWeekly, publishMonthly,
  publishDailyRecap, publishEducation, publishBreakingNews, publishNewsDigest,
} from './publisher.js';
import { MARKET, buildRow } from './scanner.js';
import { shadowReport } from './tracker.js';
import { runBacktest, backtestRunning } from './backtest.js';
import { fmt, log, warn, trDateTime, dur, trDayStart } from './util.js';

// at most 6 payment pages per person per hour: keeps NOWPayments and the database clean
const invoiceLimit = makeLimiter({ max: 6, windowMs: 3600e3 });

let OFFSET = 0;
let loaded = false;

async function loadOffset() {
  if (loaded) return;
  OFFSET = (await db.getState('tg_offset', 0)) || 0;
  loaded = true;
}

export async function pollLoop(ctx) {
  await loadOffset();
  for (;;) {
    try {
      const ups = await tg.getUpdates(OFFSET ? OFFSET + 1 : undefined, 50);
      for (const u of ups || []) {
        OFFSET = Math.max(OFFSET, u.update_id);
        try { await handle(u, ctx); }
        catch (e) { warn('update islenemedi:', e.message); }
      }
      if (ups?.length) await db.setState('tg_offset', OFFSET);
    } catch (e) {
      warn('poll:', e.message);
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}

async function handle(u, ctx) {
  if (u.callback_query) return onCallback(u.callback_query);
  if (u.my_chat_member) return onMyChatMember(u.my_chat_member);
  if (u.chat_member) return onChatMember(u.chat_member);
  const msg = u.message;
  if (!msg?.text || !msg.from) return;
  if (msg.chat?.type !== 'private') return;   // sadece DM

  const from = msg.from;
  const txt = msg.text.trim();
  db.userSeen(from);

  const cmd = txt.split(/\s+/)[0].toLowerCase().replace(/@.*$/, '');
  const args = txt.split(/\s+/).slice(1);

  // ---- admin ----
  // KURULUM MODU: ADMIN_IDS henüz boşsa /kanallar herkese açıktır, yoksa
  // "admin olmak için ADMIN_IDS lazım, ADMIN_IDS için kanal ID lazım" kısır
  // döngüsüne girilir. ADMIN_IDS girilince kilitlenir.
  const kurulumModu = ENV.adminIds.length === 0;
  if (tg.isAdmin(from.id) || (kurulumModu && cmd === '/kanallar')) {
    if (await adminCmd(cmd, args, from, ctx)) return;
  }

  const lang = await db.getUserLang(from.id);

  switch (cmd) {
    case '/id':
      return tg.send(from.id, [
        M.L(lang, '<b>Your Telegram ID:</b>', '<b>Telegram ID\'n:</b>'),
        `<code>${from.id}</code>`,
        '',
        M.L(lang, 'Tap it to copy.', 'Üstüne dokunarak kopyalayabilirsin.'),
        M.L(lang, 'Railway → Variables → <code>ADMIN_IDS</code>',
                  'Railway → Variables → <code>ADMIN_IDS</code> alanına yaz.'),
        '',
        ENV.adminIds.length
          ? (tg.isAdmin(from.id)
              ? M.L(lang, '✅ You are registered as an admin.', '✅ Admin olarak tanımlısın.')
              : '')
          : M.L(lang,
              '⚠️ <code>ADMIN_IDS</code> is empty. Set it, then /panel unlocks the admin commands.',
              '⚠️ <code>ADMIN_IDS</code> boş. Girince /panel ile yönetim komutları açılır.'),
      ].filter(Boolean).join('\n'));

    case '/start': {
      // Every public "Join VIP" button lands here as /start vip_<source>
      const payload = String(args[0] || '');
      if (/^vip(_|$)/.test(payload)) {
        db.clickAdd({ kind: 'open', source: payload.slice(4) || 'direct', signal_key: null, ua: null });
        return sendVipMenu(from, lang);
      }
      return tg.send(from.id, M.startMsg(from.first_name, lang),
        { reply_markup: M.languageKeyboard() });
    }

    case '/language':
    case '/lang':
    case '/dil':
      return tg.send(from.id, M.languageMsg(lang), { reply_markup: M.languageKeyboard() });

    case '/vip':
      return sendVipMenu(from, lang);

    case '/join': {
      const v = await db.vipGet(from.id).catch(() => null);
      const active = Boolean(v && v.status === 'aktif' && Date.parse(v.expires_at) > Date.now());
      if (!active) return tg.send(from.id, M.joinNoAccessMsg(lang),
        { reply_markup: M.planKeyboard(vip.publicPlans()) });
      try {
        const link = await vip.issueInvite(from.id, { previous: v.invite_link });
        await db.vipPatch(from.id, { invite_link: link });
        return tg.send(from.id, M.joinMsg(link, lang));
      } catch (e) {
        warn(`/join failed (${from.id}): ${e.message}`);
        await vip.notifyAdmins(`⚠️ /join failed for <code>${from.id}</code>: ${tg.esc(e.message)}`);
        return tg.send(from.id, M.joinFailedMsg(lang));
      }
    }

    case '/status':
    case '/durum': {
      const v = await db.vipGet(from.id).catch(() => null);
      return tg.send(from.id, M.statusMsg(v, lang));
    }

    case '/performance':
    case '/performans': {
      const aktif = await vip.isActive(from.id);
      const st = await perfLastDays(30);
      const { text, reply_markup } = M.perfTable(st, {
        title: M.L(lang, 'LAST 30 DAYS', 'SON 30 GÜN'),
        periodLabel: M.L(lang, 'all closed trades · net', 'kapanan tüm işlemler · net'),
        forFree: !aktif,
      });
      return tg.send(from.id, text, reply_markup ? { reply_markup } : {});
    }

    case '/how':
    case '/nasil':
    case '/nasıl':
      return tg.send(from.id, M.howMsg(lang));

    case '/help':
    case '/yardim':
      return tg.send(from.id, M.startMsg(from.first_name, lang));

    default:
      if (txt.startsWith('/')) {
        return tg.send(from.id, M.L(lang,
          'Unknown command. Send /start to see what I can do.',
          'Bilinmeyen komut. /start yazarak komutları görebilirsin.'));
      }
      return tg.send(from.id, M.L(lang,
        'I got your message, but I am an automated bot. Send /start for the command list.',
        'Mesajını aldım ama ben otomatik bir botum. Komutlar için /start yaz.'));
  }
}

async function onCallback(cq) {
  const data = String(cq.data || '');
  const from = cq.from;

  // dil seçimi
  if (data.startsWith('lang:')) {
    const lang = data.slice(5) === 'tr' ? 'tr' : 'en';
    await db.userSeen(from);
    await db.setUserLang(from.id, lang);
    await tg.answerCb(cq.id, lang === 'tr' ? 'Türkçe' : 'English');
    await tg.send(from.id, M.languageSet(lang));
    return;
  }

  if (data.startsWith('buy:')) {
    const planName = data.slice(4);
    const plan = vip.planByName(planName);
    if (!plan || (vip.isHiddenPlan(plan) && !tg.isAdmin(from.id))) {
      await tg.answerCb(cq.id, 'Plan not found'); return;
    }
    if (!invoiceLimit(String(from.id))) {
      await tg.answerCb(cq.id, 'Too many attempts — try again in a while'); return;
    }

    if (!np.configured()) {
      await tg.answerCb(cq.id, 'Payment system not ready yet');
      await tg.send(from.id,
        'The payment system is not live yet. Please contact the channel admin.');
      return;
    }

    await tg.answerCb(cq.id, 'Preparing your payment page…');
    const orderId = np.makeOrderId(from.id, plan.name);
    // returning members (anyone who has ever had VIP) get RENEW_DISCOUNT_PCT off, if set
    const prior = await db.vipGet(from.id).catch(() => null);
    const discountPct = prior && ENV.renewDiscountPct > 0 ? Math.min(90, ENV.renewDiscountPct) : 0;
    const price = discountPct ? Math.round(plan.price * (100 - discountPct)) / 100 : plan.price;
    try {
      const inv = await np.createInvoice({
        amount: price,
        orderId,
        description: `VIP ${plan.name} — ${plan.days} days`,
        plan: plan.name,
      });
      await db.payInsert({
        order_id: orderId,
        np_invoice_id: inv.id || null,
        telegram_id: from.id,
        plan: plan.name,
        days: plan.days,
        amount: price,
        currency: ENV.npCurrency,
        status: 'waiting',
        raw: inv.raw || null,
      });
      await tg.send(from.id, M.invoiceMsg({ ...plan, price }, inv.url,
        await db.getUserLang(from.id), { discountPct, listPrice: plan.price }));
      log(`fatura olusturuldu ${orderId} (${from.id}, ${plan.name})`);
    } catch (e) {
      warn('fatura hatasi:', e.message);
      await tg.send(from.id,
        'Could not create the payment page. Please try again in a few minutes — ' +
        'if it keeps failing, message the admin.');
      await vip.notifyAdmins(`⚠️ Fatura hatası (${from.id}): ${e.message}`);
    }
    return;
  }

  await tg.answerCb(cq.id);
}

/* ---------------- admin komutları ---------------- */
async function adminCmd(cmd, args, from, ctx) {
  switch (cmd) {
    case '/panel':
      await tg.send(from.id, [
        '<b>ADMIN</b>',
        '/panel — bu menü',
        '/stats — sistem durumu',
        '/backtest [days] — replay the engine on the last 2-14 days (runs on Railway)',
        '/lab — engine lab: published vs shadow trades by grade, side, session, type',
        '/uyeler — aktif VIP listesi',
        '/ver &lt;telegram_id&gt; &lt;plan&gt; — elle VIP ver',
        '/al &lt;telegram_id&gt; — VIP\'i bitir ve çıkar',
        '/brand — channel names, bios, logos, pinned posts (re-apply)',
        '/kanallar — keşfedilen kanallar ve ID\'leri',
        '/dash — dashboard linki',
        '/tiklama — VIP link tıklama istatistiği',
        '/tara — şimdi bir tarama turu çalıştır',
        '/egitim — eğitim postunu şimdi yayınla',
        '/haber — haber taraması (puanlarıyla, yayınlamaz)',
        '/haberat — flaş haberi şimdi yayınla',
        '/haberozet — günlük haber özetini şimdi yayınla',
        '/gunluk — günlük analizi şimdi yayınla',
        '/kapanis — gün kapanışını şimdi yayınla',
        '/haftalik — haftalık tabloyu şimdi yayınla',
        '/aylik — aylık tabloyu şimdi yayınla',
        '/izleme — izleme listesi',
      ].join('\n'));
      return true;

    case '/stats': {
      const open = (await db.openSignals().catch(() => [])) || [];
      const act = await vip.activeCount();
      const st = await perfLastDays(30);
      await tg.send(from.id, [
        '<b>SİSTEM DURUMU</b>',
        `Son tarama: ${MARKET.lastScan ? dur(Date.now() - MARKET.lastScan) + ' önce' : '—'}`,
        `Taranan: ${MARKET.scanned} · izlemede ${MARKET.watchlist.length}`,
        `Açık pozisyon: ${open.length} / ${CFG.maxOpen}`,
        `BTC 15m: ${fmt(MARKET.btc15, 2)}% · şok ${fmt(MARKET.shock, 1)}×`,
        `Rejim: ${MARKET.reg?.label || '—'}${MARKET.dvol ? ` · DVOL ${fmt(MARKET.dvol.pctl, 0)}p` : ''}`,
        `Genişlik: ${MARKET.breadth?.up ?? '—'}↑ / ${MARKET.breadth?.dn ?? '—'}↓`,
        '',
        `Aktif VIP: <b>${act ?? '—'}</b>`,
        `30 gün: ${st.n} işlem · ${st.tot > 0 ? '+' : ''}${fmt(st.tot, 2)}R · isabet %${fmt(st.winPct, 0)}`,
        '',
        `Ödeme sistemi: ${np.configured() ? '✅ hazır' : '⚠️ eksik ayar'}`,
        `DRY_RUN: ${ENV.dryRun ? 'AÇIK (hiçbir şey yayınlanmıyor)' : 'kapalı'}`,
      ].join('\n'));
      return true;
    }

    case '/uyeler': {
      const act = (await db.vipActive().catch(() => [])) || [];
      if (!act.length) { await tg.send(from.id, 'Aktif VIP üye yok.'); return true; }
      const lines = act.slice(0, 50).map((v) => {
        const kalan = Math.ceil((Date.parse(v.expires_at) - Date.now()) / 864e5);
        return `<code>${v.telegram_id}</code> ${v.username ? '@' + tg.esc(v.username) : ''} · ${v.plan || '—'} · ${kalan}g`;
      });
      await tg.send(from.id, `<b>AKTİF VIP (${act.length})</b>\n` + lines.join('\n'));
      return true;
    }

    case '/ver': {
      const [id, plan] = args;
      if (!id || !plan) { await tg.send(from.id, 'Kullanım: /ver &lt;telegram_id&gt; &lt;plan&gt;'); return true; }
      try {
        const r = await vip.grant(Number(id), plan, { amount: 0, orderId: 'manuel' });
        await tg.send(from.id, `✅ ${id} -> ${r.plan.name}, bitiş ${trDateTime(r.expires)}`);
      } catch (e) { await tg.send(from.id, '❌ ' + e.message); }
      return true;
    }

    case '/al': {
      const [id] = args;
      if (!id) { await tg.send(from.id, 'Kullanım: /al &lt;telegram_id&gt;'); return true; }
      try {
        await db.vipPatch(Number(id), {
          status: 'iptal', expires_at: new Date().toISOString(),
          kicked_at: new Date().toISOString(),
        });
        if (ENV.vipChat) await tg.kick(ENV.vipChat, Number(id));
        await tg.send(from.id, `✅ ${id} VIP'ten çıkarıldı.`);
      } catch (e) { await tg.send(from.id, '❌ ' + e.message); }
      return true;
    }

    case '/tara':
      await tg.send(from.id, 'Tarama başlatıldı…');
      try {
        const r = await ctx.runScan();
        await tg.send(from.id, `✅ ${r.scanned} aday · ${r.fired.length} sinyal · ${r.watch.length} izlemede · ${(r.ms / 1000).toFixed(0)}sn`);
      } catch (e) { await tg.send(from.id, '❌ ' + e.message); }
      return true;

    case '/brand': {
      await tg.send(from.id, 'Applying channel branding…');
      try {
        const r = await applyBranding({ force: true });
        await tg.send(from.id, reportText(r));
      } catch (e) { await tg.send(from.id, '❌ ' + tg.esc(e.message)); }
      return true;
    }

    case '/kanallar': {
      const liste = (await db.getState('kesfedilen_kanallar', [])) || [];
      if (!liste.length) {
        await tg.send(from.id, [
          'Henüz hiçbir kanal keşfedilmedi.',
          '',
          'Botu kanala <b>yönetici</b> olarak ekle — ID\'yi otomatik yakalayıp',
          'buraya yazacağım. Zaten ekliysen, yöneticilikten çıkarıp tekrar ekle.',
        ].join('\n'));
        return true;
      }
      const satir = liste.map((k) => {
        const ayarli =
          String(ENV.vipChat) === String(k.id) ? ' ✓ VIP'
          : (String(ENV.freeChat) === String(k.id)
             || (k.kullanici_adi && ENV.freeChat === '@' + k.kullanici_adi)) ? ' ✓ FREE'
          : '';
        return `<b>${tg.esc(k.baslik || '—')}</b>${ayarli}\n` +
          `<code>${k.id}</code>` +
          `${k.kullanici_adi ? ' · @' + tg.esc(k.kullanici_adi) : ' · özel'}` +
          `${k.yetkili ? '' : ' · ⚠️ yönetici değil'}`;
      });
      await tg.send(from.id, [
        '<b>KEŞFEDİLEN KANALLAR</b>', '', satir.join('\n\n'), '',
        '<i>Ayarlı olmayanları Railway → Variables\'a yaz.</i>',
        ...(ENV.adminIds.length ? [] : [
          '',
          '⚠️ <b>Kurulum modu:</b> <code>ADMIN_IDS</code> boş olduğu için bu komut',
          'herkese açık. /id ile kendi numaranı alıp ADMIN_IDS\'e yazınca kilitlenir.',
        ]),
      ].join('\n'));
      return true;
    }

    case '/dash': {
      if (!ENV.dashKey) {
        await tg.send(from.id,
          'Dashboard kapalı. Railway Variables\'a <code>DASHBOARD_KEY</code> ekle ' +
          '(uzun, rastgele bir metin) ve yeniden deploy et.');
        return true;
      }
      if (!ENV.publicUrl) {
        await tg.send(from.id,
          'Dashboard açık ama <code>PUBLIC_URL</code> ayarlı değil — linki üretemiyorum.');
        return true;
      }
      const u = `${ENV.publicUrl}/dash?key=${encodeURIComponent(ENV.dashKey)}`;
      await tg.send(from.id,
        `📊 <b>Panel</b>\n\n<a href="${u}">${u}</a>\n\n` +
        '<i>Bu link anahtarını içeriyor — kimseyle paylaşma.</i>');
      return true;
    }

    case '/haber': {
      await tg.send(from.id, 'Haber kaynakları taranıyor…');
      try {
        const news = await import('./news.js');
        const items = await news.collect({ hours: 12 });
        if (!items.length) {
          await tg.send(from.id,
            '❌ Hiç başlık alınamadı. Kaynaklar erişilemiyor olabilir — ' +
            '<code>NEWS_FEEDS</code> ile değiştirebilirsin.');
          return true;
        }
        const kaynak = [...new Set(items.map((x) => x.source))];
        const list = items.slice(0, 10).map((x) =>
          `${String(x.score).padStart(3)} ${x.score >= ENV.newsMinScore ? '🚨' : '  '} ` +
          `<b>${tg.esc(x.title.slice(0, 70))}</b>\n     <i>${tg.esc(x.source)}` +
          `${x.tags.length ? ' · ' + x.tags.join(',') : ''}</i>`);
        await tg.send(from.id, [
          `<b>HABER TARAMASI</b> (son 12 saat)`,
          `${items.length} başlık · kaynaklar: ${kaynak.join(', ')}`,
          `Flaş eşiği: ${ENV.newsMinScore} puan`,
          '',
          ...list,
        ].join('\n'));
      } catch (e) { await tg.send(from.id, '❌ ' + e.message); }
      return true;
    }

    case '/haberat':
      await tg.send(from.id, 'Flaş haber yayınlanıyor…');
      try {
        const n = await publishBreakingNews();
        await tg.send(from.id, n ? `✅ ${n} kanala yayınlandı` : 'ℹ️ Eşiği geçen yeni haber yok');
      } catch (e) { await tg.send(from.id, '❌ ' + e.message); }
      return true;

    case '/egitim':
      await tg.send(from.id, 'Eğitim postu yayınlanıyor…');
      try {
        const n = await publishEducation();
        await tg.send(from.id, n ? `✅ ${n} kanala yayınlandı` : 'ℹ️ Yayınlanacak yeni ders kalmamış');
      } catch (e) { await tg.send(from.id, '❌ ' + e.message); }
      return true;

    case '/tiklama': {
      try {
        const since = new Date(Date.now() - 7 * 864e5).toISOString();
        const cl = (await db.clicksSince(since)) || [];
        const d0 = trDayStart();
        const bugun = cl.filter((x) => Date.parse(x.created_at) >= d0).length;
        const src = {};
        cl.forEach((x) => { src[x.source || '?'] = (src[x.source || '?'] || 0) + 1; });
        const lines = Object.entries(src).sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `<code>${k.padEnd(10)} ${v}</code>`);
        await tg.send(from.id, [
          '<b>VIP LİNK TIKLAMALARI</b>',
          `Bugün: <b>${bugun}</b> · 7 gün: <b>${cl.length}</b>`,
          '',
          lines.length ? lines.join('\n') : 'henüz tıklama yok',
          '',
          '<i>Telegram gönderi görüntülenmesi vermiyor; tıklama dönüşüm için daha anlamlı.</i>',
        ].join('\n'));
      } catch (e) { await tg.send(from.id, '❌ ' + e.message); }
      return true;
    }

    case '/gunluk':
      await publishDaily(); await tg.send(from.id, '✅ günlük analiz denendi'); return true;
    case '/kapanis':
      await publishDailyRecap(); await tg.send(from.id, '✅ gün kapanışı denendi'); return true;
    case '/haftalik':
      await publishWeekly(); await tg.send(from.id, '✅ haftalık tablo denendi'); return true;
    case '/aylik':
      await publishMonthly(); await tg.send(from.id, '✅ aylık tablo denendi'); return true;
    case '/haberozet':
      await publishNewsDigest(); await tg.send(from.id, '✅ haber özeti denendi'); return true;

    case '/backtest': {
      if (backtestRunning()) { await tg.send(from.id, 'A backtest is already running.'); return true; }
      const days = Math.min(14, Math.max(2, parseInt(args[0], 10) || 7));
      await tg.send(from.id, `🧪 Backtest started: last ${days} days, top 40 coins by volume. It runs in the background and takes a few minutes. Results arrive here and in /lab.`);
      runBacktest({ days, tickers: MARKET.tick || [], buildRow })
        .then((s) => tg.send(from.id, `🧪 Backtest done in ${s.sec}s · ${s.symbols} coins · ${s.analyses} moments checked · ${s.setups} setups · ${s.stored} finished · ${s.errors} errors.\nSend /lab to see the breakdown.`))
        .catch((e) => tg.send(from.id, '🧪 Backtest failed: ' + e.message));
      return true;
    }

    case '/lab': {
      const since = new Date(Date.now() - 30 * 864e5).toISOString();
      const [real, sh] = await Promise.all([db.signalsBetween(since, new Date(Date.now() + 864e5).toISOString()), db.shadowSince(since)]);
      await tg.send(from.id, shadowReport(real || [], sh || []));
      return true;
    }

    case '/izleme': {
      if (!MARKET.watchlist.length) { await tg.send(from.id, 'İzleme listesi boş.'); return true; }
      const lines = MARKET.watchlist.slice(0, 20).map((w) =>
        `${w.dir === 'L' ? '▲' : '▼'} ${w.symbol.replace('USDT', '')} ${w.verdict} ${w.grade} · ${w.ex_n}/5 · ${w.tr_n}/4`);
      await tg.send(from.id, '<b>İZLEME</b>\n' + lines.join('\n'));
      return true;
    }

    default:
      return false;
  }
}

/* ============================================================
   KANAL KEŞFİ
   Bot bir kanala yönetici yapıldığında Telegram "my_chat_member"
   güncellemesi gönderir. Kanal ID'sini buradan yakalayıp kaydediyoruz —
   böylece kimsenin getUpdates'i elle açıp JSON içinden ID araması gerekmiyor.
   ============================================================ */
async function onMyChatMember(ev) {
  const chat = ev.chat || {};
  if (!['channel', 'supergroup', 'group'].includes(chat.type)) return;

  const yeni = ev.new_chat_member?.status;
  const yetkili = yeni === 'administrator' || yeni === 'creator';

  // keşfedilen kanalları sakla (dashboard ve /kanallar için)
  try {
    const liste = (await db.getState('kesfedilen_kanallar', [])) || [];
    const i = liste.findIndex((x) => String(x.id) === String(chat.id));
    const kayit = {
      id: chat.id,
      baslik: chat.title || '',
      kullanici_adi: chat.username || null,
      tur: chat.type,
      yetkili,
      durum: yeni,
      gorulme: new Date().toISOString(),
    };
    if (i >= 0) liste[i] = kayit; else liste.push(kayit);
    await db.setState('kesfedilen_kanallar', liste.slice(-20));
  } catch (e) { warn('kanal kaydı:', e.message); }

  log(`kanal güncellemesi: ${chat.title || chat.id} (${chat.id}) -> ${yeni}`);

  if (!yetkili) return;

  // Hangi env'e yazılacağını tahmin et: public ise free, özel ise VIP
  const ozel = !chat.username;
  const oneri = ozel ? 'VIP_CHANNEL_ID' : 'FREE_CHANNEL_ID';
  const zatenAyarli =
    String(ENV.vipChat) === String(chat.id) || String(ENV.freeChat) === String(chat.id) ||
    (chat.username && ENV.freeChat === '@' + chat.username);

  const mesaj = [
    '✅ <b>Kanala yönetici olarak eklendim</b>',
    '',
    `<b>${tg.esc(chat.title || '—')}</b>`,
    chat.username ? `@${tg.esc(chat.username)} · herkese açık` : 'özel kanal',
    '',
    '<b>Kanal ID\'si:</b>',
    `<code>${chat.id}</code>`,
    '',
    zatenAyarli
      ? '✓ Bu kanal zaten ayarlı, bir şey yapmana gerek yok.'
      : `Railway → Variables → <code>${oneri}</code> alanına yukarıdaki sayıyı yaz.`,
  ].join('\n');

  let gonderildi = 0;
  for (const id of ENV.adminIds) {
    try { await tg.send(id, mesaj); gonderildi++; }
    catch (e) {
      // Telegram, kendisine hiç yazmamış bir kullanıcıya botun DM atmasına
      // izin vermez. Sebebi net yazalım ki kullanıcı ne yapacağını bilsin.
      const sebep = /chat not found|bot can't initiate|blocked/i.test(e.message)
        ? `kullanıcı ${id} bota hiç /start yazmamış (veya botu engellemiş)`
        : e.message;
      warn(`kanal bilgisi DM gönderilemedi: ${sebep}`);
    }
  }
  // DM gidemediyse (veya admin yoksa) bilgiyi log'a tam olarak yaz —
  // kullanıcı Railway loglarından okuyabilsin.
  if (!gonderildi) {
    log(`>>> KURULUM: ${oneri} = ${chat.id}   («${chat.title || ''}»)`);
    if (!ENV.adminIds.length) {
      log('>>> ADMIN_IDS boş. Bota /id yazıp numaranı al, Railway\'e ekle.');
    } else {
      log('>>> Admin\'e DM gidemedi. Telegram\'da bota önce /start yaz, sonra /kanallar.');
    }
  }
}


/* ============================================================
   VIP MENU
   Members see their status plus the extend options; everyone else sees the pitch.
   ============================================================ */
async function sendVipMenu(from, lang) {
  const plans = vip.plansFor(from.id);
  if (!plans.length) {
    return tg.send(from.id, M.L(lang, 'No plans configured yet.', 'Planlar henüz tanımlanmadı.'));
  }
  const v = await db.vipGet(from.id).catch(() => null);
  const active = Boolean(v && v.status === 'aktif' && Date.parse(v.expires_at) > Date.now());
  const text = active ? M.vipActiveMsg(v, lang) : M.vipMsg(plans, lang);
  return tg.send(from.id, text, { reply_markup: M.planKeyboard(plans) });
}

/* ============================================================
   PAYWALL GUARD
   Anyone who joins the VIP channel without an active membership is removed —
   for example a friend using a paying member's link. The link is single-use,
   so the member just sends /join to get a new one.
   Fails OPEN: if the database cannot be read nobody is removed by mistake.
   ============================================================ */
async function onChatMember(ev) {
  const chat = ev.chat || {};
  if (!ENV.vipChat || String(chat.id) !== String(ENV.vipChat)) return;

  const userId = ev.new_chat_member?.user?.id;
  if (!userId) return;

  let row = null;
  try {
    row = await db.vipGet(userId);
  } catch (e) {
    warn(`paywall guard: could not read membership for ${userId}, not removing: ${e.message}`);
    return;
  }
  const activeVip = Boolean(row && row.status === 'aktif' && Date.parse(row.expires_at) > Date.now());

  const remove = vip.shouldRemoveJoiner({
    chatId: chat.id,
    vipChatId: ENV.vipChat,
    oldStatus: ev.old_chat_member?.status,
    newStatus: ev.new_chat_member?.status,
    userId,
    actorId: ev.from?.id,
    isBot: Boolean(ev.new_chat_member?.user?.is_bot),
    adminIds: ENV.adminIds,
    activeVip,
  });
  if (!remove) return;

  try {
    await tg.kick(ENV.vipChat, userId);
    log(`paywall guard: removed unauthorised joiner ${userId}`);
    const lang = await db.getUserLang(userId);
    tg.send(userId, M.unauthorizedJoinMsg(lang), { reply_markup: M.planKeyboard(vip.publicPlans()) }).catch(() => {});
    const name = [ev.new_chat_member.user.first_name, ev.new_chat_member.user.username && '@' + ev.new_chat_member.user.username]
      .filter(Boolean).join(' ');
    await vip.notifyAdmins(`🛡 Removed an unauthorised joiner from VIP: <code>${userId}</code> ${tg.esc(name)}`);
  } catch (e) {
    warn(`paywall guard: could not remove ${userId}: ${e.message}`);
    await vip.notifyAdmins(`⚠️ Someone without VIP joined the VIP channel and I could not remove them: <code>${userId}</code> — ${tg.esc(e.message)}`);
  }
}
