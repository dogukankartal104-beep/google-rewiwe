// DM komutları + inline buton akışı + admin komutları.
import { ENV, CFG } from './config.js';
import * as db from './db.js';
import * as tg from './telegram.js';
import * as M from './messages.js';
import * as np from './payments.js';
import * as vip from './vip.js';
import {
  perfLastDays, publishDaily, publishWeekly, publishMonthly,
  publishDailyRecap, publishEducation, publishBreakingNews, publishNewsDigest,
} from './publisher.js';
import { MARKET } from './scanner.js';
import { fmt, log, warn, trDateTime, dur, trDayStart } from './util.js';

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
  const msg = u.message;
  if (!msg?.text || !msg.from) return;
  if (msg.chat?.type !== 'private') return;   // sadece DM

  const from = msg.from;
  const txt = msg.text.trim();
  db.userSeen(from);

  const cmd = txt.split(/\s+/)[0].toLowerCase().replace(/@.*$/, '');
  const args = txt.split(/\s+/).slice(1);

  // ---- admin ----
  if (tg.isAdmin(from.id)) {
    if (await adminCmd(cmd, args, from, ctx)) return;
  }

  switch (cmd) {
    case '/id':
      return tg.send(from.id, [
        '<b>Senin Telegram ID\'n:</b>',
        `<code>${from.id}</code>`,
        '',
        'Üstüne dokunarak kopyalayabilirsin.',
        'Railway → Variables → <code>ADMIN_IDS</code> alanına bunu yaz.',
      ].join('\n'));

    case '/start':
      return tg.send(from.id, M.startMsg(from.first_name));

    case '/vip': {
      if (!ENV.plans.length) return tg.send(from.id, 'Planlar henüz tanımlanmadı.');
      return tg.send(from.id, M.vipMsg(ENV.plans), { reply_markup: M.planKeyboard(ENV.plans) });
    }

    case '/durum': {
      const v = await db.vipGet(from.id).catch(() => null);
      return tg.send(from.id, M.statusMsg(v));
    }

    case '/performans': {
      const st = await perfLastDays(30);
      const { text } = M.perfTable(st, {
        title: 'SON 30 GÜN', periodLabel: 'kapanan tüm işlemler · net',
        forFree: !(await vip.isActive(from.id)),
      });
      return tg.send(from.id, text, !(await vip.isActive(from.id))
        ? { reply_markup: { inline_keyboard: [[{ text: '⭐ VIP\'e katıl', url: ENV.vipInviteLink }]] } }
        : {});
    }

    case '/nasil':
    case '/nasıl':
      return tg.send(from.id, M.nasilMsg());

    case '/yardim':
    case '/help':
      return tg.send(from.id, M.startMsg(from.first_name));

    default:
      if (txt.startsWith('/')) {
        return tg.send(from.id, 'Bilinmeyen komut. /start yazarak komutları görebilirsin.');
      }
      return tg.send(from.id,
        'Mesajını aldım ama ben otomatik bir botum. Komutlar için /start yaz.\n\n' +
        (ENV.adminIds.length ? 'Soru için kanal yöneticisine yazabilirsin.' : ''));
  }
}

async function onCallback(cq) {
  const data = String(cq.data || '');
  const from = cq.from;

  if (data.startsWith('buy:')) {
    const planName = data.slice(4);
    const plan = vip.planByName(planName);
    if (!plan) { await tg.answerCb(cq.id, 'Plan bulunamadı'); return; }

    if (!np.configured()) {
      await tg.answerCb(cq.id, 'Ödeme sistemi henüz hazır değil');
      await tg.send(from.id,
        'Ödeme sistemi şu an kapalı. Kanal yöneticisiyle iletişime geçebilirsin.');
      return;
    }

    await tg.answerCb(cq.id, 'Ödeme sayfası hazırlanıyor…');
    const orderId = np.makeOrderId(from.id, plan.name);
    try {
      const inv = await np.createInvoice({
        amount: plan.price,
        orderId,
        description: `VIP ${plan.name} — ${plan.days} gün`,
        plan: plan.name,
      });
      await db.payInsert({
        order_id: orderId,
        np_invoice_id: inv.id || null,
        telegram_id: from.id,
        plan: plan.name,
        days: plan.days,
        amount: plan.price,
        currency: ENV.npCurrency,
        status: 'waiting',
        raw: inv.raw || null,
      });
      await tg.send(from.id, M.invoiceMsg(plan, inv.url));
      log(`fatura olusturuldu ${orderId} (${from.id}, ${plan.name})`);
    } catch (e) {
      warn('fatura hatasi:', e.message);
      await tg.send(from.id,
        'Ödeme sayfası oluşturulamadı. Birkaç dakika sonra tekrar dene, ' +
        'sorun sürerse yöneticiye yaz.');
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
        '/uyeler — aktif VIP listesi',
        '/ver &lt;telegram_id&gt; &lt;plan&gt; — elle VIP ver',
        '/al &lt;telegram_id&gt; — VIP\'i bitir ve çıkar',
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

  for (const id of ENV.adminIds) {
    try { await tg.send(id, mesaj); } catch { /* yoksay */ }
  }
  // Admin tanımlı değilse en azından log'a tam olarak yaz
  if (!ENV.adminIds.length) {
    log(`>>> ${oneri} = ${chat.id}  (${chat.title || ''})`);
  }
}
