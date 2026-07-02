import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Vercel Serverless Function: /api/webhook/shopier
// Shopier'in "Otomatik Sipariş Bildirimi (OSB)" sistemi içindir.
//
// Shopier isteği bazen application/x-www-form-urlencoded, bazen
// multipart/form-data olarak gönderebiliyor. Vercel'in otomatik body-parser'ı
// multipart'ı parse edemediği için (req.body = {} boş geliyor), body'yi
// ham (raw) olarak okuyup içeriğe göre kendimiz parse ediyoruz.

export const config = {
  api: {
    bodyParser: false,
  },
};

function readRawBody(req: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseUrlEncoded(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  const params = new URLSearchParams(raw);
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}

function parseMultipart(raw: Buffer, contentType: string): Record<string, string> {
  const result: Record<string, string> = {};
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  const boundary = boundaryMatch ? (boundaryMatch[1] || boundaryMatch[2]) : null;
  if (!boundary) return result;

  const parts = raw.toString('latin1').split(`--${boundary}`);
  for (const part of parts) {
    const nameMatch = part.match(/name="([^"]+)"/);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    const valueStart = part.indexOf('\r\n\r\n');
    if (valueStart === -1) continue;
    let value = part.slice(valueStart + 4);
    value = value.replace(/\r\n--$/, '').replace(/\r\n$/, '');
    result[name] = Buffer.from(value, 'latin1').toString('utf8');
  }
  return result;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const contentType = (req.headers['content-type'] || '') as string;
    const rawBuffer = await readRawBody(req);
    const rawString = rawBuffer.toString('utf8');

    let body: Record<string, string> = {};

    if (contentType.includes('multipart/form-data')) {
      body = parseMultipart(rawBuffer, contentType);
    } else if (contentType.includes('application/json')) {
      try {
        body = JSON.parse(rawString);
      } catch {
        body = {};
      }
    } else {
      // application/x-www-form-urlencoded veya content-type belirtilmemiş
      body = parseUrlEncoded(rawString);
    }

    const resField = body.res;
    const hashField = body.hash;

    if (!resField || !hashField) {
      console.error('Shopier OSB: missing res/hash fields. content-type=', contentType, 'raw=', rawString.slice(0, 500), 'parsed=', body);
      return res.status(200).send('missing parameter');
    }

    // --- 1. İmza (hash) doğrulaması ---
    const osbUsername = process.env.SHOPIER_OSB_USERNAME;
    const osbPassword = process.env.SHOPIER_OSB_PASSWORD;

    if (osbUsername && osbPassword) {
      const expectedHash = crypto
        .createHmac('sha256', osbPassword)
        .update(resField + osbUsername)
        .digest('hex');

      if (expectedHash !== hashField) {
        console.error('Shopier OSB: hash mismatch. expected=', expectedHash, 'got=', hashField);
        return res.status(200).send('invalid hash');
      }
    } else {
      console.warn('Shopier OSB: SHOPIER_OSB_USERNAME/PASSWORD not set, skipping signature check');
    }

    // --- 2. Veriyi çöz (base64 JSON) ---
    const payload = JSON.parse(Buffer.from(resField, 'base64').toString('utf8'));
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
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error('Supabase env vars missing');
      return res.status(200).send('server configuration missing');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    let businessId: string | null = null;

    if (customernote && /^[0-9a-fA-F-]{36}$/.test(String(customernote).trim())) {
      businessId = String(customernote).trim();
    }

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
      await supabase.from('payment_logs').insert([
        {
          business_id: null,
          amount: Number(price) || 0,
          currency: currency === 1 ? 'USD' : currency === 2 ? 'EUR' : 'TRY',
          status: istest ? 'test_unmatched' : 'unmatched',
          paid_at: new Date().toISOString(),
        },
      ]);
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
        currency: currency === 1 ? 'USD' : currency === 2 ? 'EUR' : 'TRY',
        status: istest ? 'test_success' : 'success',
        paid_at: now.toISOString(),
      },
    ]);

    console.log(`OSB: Subscription extended for business ${businessId} until ${newEndDate.toISOString()}`);

    return res.status(200).send('success');
  } catch (error) {
    console.error('Shopier OSB webhook error:', error);
    return res.status(200).send('error logged');
  }
}
