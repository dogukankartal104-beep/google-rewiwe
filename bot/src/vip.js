// VIP üyelik yaşam döngüsü: erişim ver, hatırlat, süresi dolanı çıkar.
import { ENV } from './config.js';
import * as db from './db.js';
import * as tg from './telegram.js';
import * as M from './messages.js';
import { log, warn, trDateTime } from './util.js';

export const planByName = (name) =>
  ENV.plans.find((p) => p.name.toLowerCase() === String(name).toLowerCase()) || null;

/* Ödeme onaylandıktan sonra erişim ver.
   Zaten aktifse süreyi mevcut bitişin üstüne ekler (yenileme). */
export async function grant(tgId, plan, { amount = 0, orderId = null } = {}) {
  const p = typeof plan === 'string' ? planByName(plan) : plan;
  if (!p) throw new Error('plan bulunamadı: ' + plan);

  const existing = await db.vipGet(tgId).catch(() => null);
  const now = Date.now();
  const base = existing && existing.status === 'aktif' && Date.parse(existing.expires_at) > now
    ? Date.parse(existing.expires_at)
    : now;
  const expires = base + p.days * 864e5;

  // Tek kullanımlık davet linki
  let link = ENV.vipInviteLink;
  try {
    const inv = await tg.createInvite(ENV.vipChat, {
      name: `vip-${tgId}`,
      expireSec: 3 * 86400,
      limit: 1,
    });
    if (inv?.invite_link) link = inv.invite_link;
  } catch (e) {
    warn(`davet linki üretilemedi (${tgId}): ${e.message} — sabit link kullanılıyor`);
  }

  await db.vipUpsert({
    telegram_id: tgId,
    status: 'aktif',
    plan: p.name,
    started_at: existing?.started_at || new Date().toISOString(),
    expires_at: new Date(expires).toISOString(),
    total_paid: (existing?.total_paid || 0) + (amount || 0),
    last_payment_at: new Date().toISOString(),
    invite_link: link,
    reminded_at: null,
    kicked_at: null,
  });

  try {
    await tg.send(tgId, M.grantMsg(p.name, expires, link));
  } catch (e) {
    warn(`grant DM gönderilemedi (${tgId}): ${e.message}`);
  }

  log(`VIP verildi: ${tgId} · ${p.name} · bitis ${trDateTime(expires)}${orderId ? ' · ' + orderId : ''}`);
  await notifyAdmins(`💰 Yeni VIP: <code>${tgId}</code> · ${p.name} · $${amount} · bitiş ${trDateTime(expires)}`);
  return { expires, link, plan: p };
}

/* Süresi dolanları çıkar, 3 gün kalanlara hatırlatma at.
   Her turda idempotent çalışır. */
export async function sweep() {
  const out = { kicked: 0, reminded: 0 };
  if (!ENV.vipChat) return out;

  // 1) süresi dolmuşlar
  let expired = [];
  try { expired = (await db.vipExpiring(new Date().toISOString())) || []; }
  catch (e) { warn('vip sweep okuma:', e.message); return out; }

  for (const v of expired) {
    try {
      await tg.kick(ENV.vipChat, v.telegram_id);
      await db.vipPatch(v.telegram_id, {
        status: 'süresi_doldu',
        kicked_at: new Date().toISOString(),
      });
      await tg.send(v.telegram_id, M.expiredMsg()).catch(() => {});
      out.kicked++;
      log(`VIP suresi doldu, cikarildi: ${v.telegram_id}`);
    } catch (e) {
      warn(`cikarma basarisiz (${v.telegram_id}): ${e.message}`);
      // Kanalda değilse de kaydı kapat, sonsuz denemeyi önle
      if (/not found|not a member|PARTICIPANT_ID_INVALID/i.test(e.message)) {
        await db.vipPatch(v.telegram_id, { status: 'süresi_doldu', kicked_at: new Date().toISOString() })
          .catch(() => {});
      }
    }
  }

  // 2) 3 gün içinde bitecekler — bir kez hatırlat
  try {
    const soon = (await db.vipExpiring(new Date(Date.now() + 3 * 864e5).toISOString())) || [];
    for (const v of soon) {
      if (v.reminded_at) continue;
      if (Date.parse(v.expires_at) <= Date.now()) continue;
      const days = Math.max(1, Math.ceil((Date.parse(v.expires_at) - Date.now()) / 864e5));
      try {
        await tg.send(v.telegram_id, M.expireSoonMsg(days, ENV.vipInviteLink));
        await db.vipPatch(v.telegram_id, { reminded_at: new Date().toISOString() });
        out.reminded++;
      } catch (e) {
        // DM kapalıysa tekrar denemeyelim
        await db.vipPatch(v.telegram_id, { reminded_at: new Date().toISOString() }).catch(() => {});
        warn(`hatirlatma gonderilemedi (${v.telegram_id}): ${e.message}`);
      }
    }
  } catch (e) { warn('hatirlatma taramasi:', e.message); }

  return out;
}

export async function notifyAdmins(text) {
  for (const id of ENV.adminIds) {
    try { await tg.send(id, text); } catch { /* yoksay */ }
  }
}

export async function isActive(tgId) {
  const v = await db.vipGet(tgId).catch(() => null);
  return Boolean(v && v.status === 'aktif' && Date.parse(v.expires_at) > Date.now());
}

export async function activeCount() {
  try { return ((await db.vipActive()) || []).length; }
  catch { return null; }
}
