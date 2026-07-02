import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Vercel Serverless Function: /api/webhook/shopier
// Bu, Shopier'in "Otomatik Sipariş Bildirimi (OSB)" sistemi içindir.
// (developer.shopier.com'daki modern "Webhooks" değil — OSB, Shopier panelinde
//  Ayarlar > Bildirim URL alanına bu endpoint'in adresi girilerek aktif edilir.)
//
// OSB isteği şu formatta gelir (form-urlencoded, indeksli array):
//   body[0][name] = "data"   body[0][value] = "<base64 JSON>"
//   body[1][name] = "hash"   body[1][value] = "<hmac sha256 hex>"
//
// Vercel'in body-parser'ı bunu genelde şu şekilde nesneye çevirir:
//   req.body = { '0': { name: 'data', value: '...' }, '1': { name: 'hash', value: '...' } }
// Bu yüzden hem array hem obje formatını destekleyecek şekilde okuyoruz.

function getField(body: any, index: number) {
  if (Array.isArray(body)) return body[index];
  if (body && typeof body === 'object') return body[String(index)] ?? body[index];
  return undefined;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;

    const dataField = getField(body, 0);
    const hashField = getField(body, 1);

    if (!dataField?.value || !hashField?.value) {
      console.error('Shopier OSB: missing data/hash fields', body);
      return res.status(401).json({ message: 'Missing parameter', code: 401 });
    }

    // --- 1. İmza (hash) doğrulaması ---
    // Shopier panelinde aldığın OSB Kullanıcı Adı + OSB Şifresi kullanılır.
    const osbUsername = process.env.SHOPIER_OSB_USERNAME;
    const osbPassword = process.env.SHOPIER_OSB_PASSWORD;

    if (osbUsername && osbPassword) {
      const expectedHash = crypto
        .createHmac('sha256', osbPassword)
        .update(dataField.value + osbUsername)
        .digest('hex');

      if (expectedHash !== hashField.value) {
        console.error('Shopier OSB: hash mismatch');
        return res.status(401).json({ message: 'Unauthorized', code: 401 });
      }
    } else {
      console.warn('Shopier OSB: SHOPIER_OSB_USERNAME/PASSWORD not set, skipping signature check');
    }

    // --- 2. Veriyi çöz (base64 JSON) ---
    const payload = JSON.parse(Buffer.from(dataField.value, 'base64').toString('utf8'));
    const {
      orderid,
      currency,
      price,
      buyername,
      buyersurname,
      productid,
      customernote,
      istest,
    } = payload;

    // --- 3. İşletmeyi bul ---
    // Eşleştirme önceliği: customernote içine business_id yazılmışsa onu kullan,
    // yoksa "cards" tablosunda shopier_product_id alanı productid'ye eşit olan kaydı ara.
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error('Supabase env vars missing');
      return res.status(500).send('Server configuration missing');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    let businessId: string | null = null;

    // a) customernote içinde business_id geçiyor mu? (müşteriye ödeme linkini gönderirken
    //    "Sipariş notuna bu ID'yi yapıştırın" diyerek bunu manuel sağlayabilirsin,
    //    ya da Shopier ürün linkini oluştururken not alanına default değer koyabiliyorsan onu kullan)
    if (customernote && /^[0-9a-fA-F-]{36}$/.test(customernote.trim())) {
      businessId = customernote.trim();
    }

    // b) productid eşleştirmesi: businesses tablosunda shopier_product_id sütunu varsa ara
    if (!businessId && productid) {
      const { data: matched } = await supabase
        .from('businesses')
        .select('id')
        .eq('shopier_product_id', String(productid))
        .single();
      if (matched) businessId = matched.id;
    }

    if (!businessId) {
      console.error('Shopier OSB: could not match business. orderid=', orderid, 'productid=', productid, 'note=', customernote);
      // Yine de 200 dönmek gerekir, Shopier aksi halde tekrar tekrar dener.
      // Ama abonelik güncellemesi yapmadan kaydı logluyoruz ki manuel kontrol edebilesin.
      await supabase.from('payment_logs').insert([
        {
          business_id: null,
          amount: Number(price) || 0,
          currency: currency || 'TRY',
          status: istest ? 'test_unmatched' : 'unmatched',
          paid_at: new Date().toISOString(),
        },
      ]).select();
      return res.status(200).send('success');
    }

    // --- 4. Aboneliği 30 gün uzat ---
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('business_id', businessId)
      .single();

    const now = new Date();
    const currentEnd = sub?.current_period_end ? new Date(sub.current_period_end) : now;
    const baseDate = currentEnd > now ? currentEnd : now;
    const newEndDate = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000);

    if (sub) {
      await supabase
        .from('subscriptions')
        .update({
          status: 'active',
          current_period_start: now.toISOString(),
          current_period_end: newEndDate.toISOString(),
        })
        .eq('business_id', businessId);
    } else {
      await supabase.from('subscriptions').insert([
        {
          business_id: businessId,
          status: 'active',
          monthly_fee: Number(price) || 0,
          current_period_start: now.toISOString(),
          current_period_end: newEndDate.toISOString(),
        },
      ]);
    }

    // --- 5. Ödeme kaydını logla ---
    await supabase.from('payment_logs').insert([
      {
        business_id: businessId,
        amount: Number(price) || 0,
        currency: currency || 'TRY',
        status: istest ? 'test_success' : 'success',
        paid_at: now.toISOString(),
      },
    ]);

    console.log(`OSB: Subscription extended for business ${businessId} until ${newEndDate.toISOString()}`);

    // Shopier'in OSB'si "success" cevabı beklemektedir.
    return res.status(200).send('success');
  } catch (error) {
    console.error('Shopier OSB webhook error:', error);
    return res.status(500).send('Internal Server Error');
  }
}
