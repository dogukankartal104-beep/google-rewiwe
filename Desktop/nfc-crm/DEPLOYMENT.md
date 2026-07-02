# Vercel'e Deploy Rehberi

## 1) Supabase Hazırlığı
1. supabase.com'da proje oluştur (zaten yoksa).
2. `supabase/migrations/` klasöründeki SQL dosyalarını Supabase SQL Editor'de sırayla çalıştır.
3. RLS politikalarını ekle (geliştirme için "allow all" kullandıysan, gerçek launch öncesi gözden geçir).
4. Project Settings > API'den şu 3 değeri kopyala:
   - Project URL → `VITE_SUPABASE_URL`
   - anon public key → `VITE_SUPABASE_ANON_KEY`
   - service_role key → `SUPABASE_SERVICE_ROLE_KEY` (GİZLİ TUT, asla frontend'e koyma)

## 2) Shopier Otomatik Sipariş Bildirimi (OSB) Kurulumu

Bu, Shopier'in **legacy "OSB"** sistemidir (developer.shopier.com'daki modern Webhook
değil). Shopier panelinde sana otomatik olarak bir OSB Kullanıcı Adı ve Şifresi verilir;
yeni bir şey üretmene gerek yok, panelde "Entegrasyonlar > Otomatik Sipariş Bildirimi"
sayfasında hazır görünür.

1. Shopier panelinde OSB sayfasına git, **Bildirim URL** alanına şunu yaz:
   `https://senin-domainin.vercel.app/api/webhook/shopier`
   Protokol olarak **https://** seç, kaydet.
2. **OSB Kullanıcı Adı** ve **OSB Şifresi**'ni kopyala → Vercel environment variables'a:
   - `SHOPIER_OSB_USERNAME`
   - `SHOPIER_OSB_PASSWORD`
3. "Bildirim Testi" bölümünden test gönderimi yap, 200 + "success" cevabı dönmeli.
4. Test başarılıysa OSB'yi aktifleştir.

### Müşteri eşleştirmesi (ÖNEMLİ)
Shopier OSB'si ödeme bildiriminde senin sistemindeki `business_id`'yi otomatik göndermez.
Hangi müşterinin ödediğini anlayabilmek için iki yoldan biri gerekir:

- **Yöntem A (önerilen):** Her müşteri için Shopier'de ayrı bir ürün/ödeme linki oluştur.
  O ürünün Shopier panelindeki **Ürün ID**'sini, CRM'de müşteriyi düzenlerken
  "Shopier Ürün ID" alanına gir. Sistem ödeme geldiğinde bu ID ile müşteriyi otomatik bulur.
- **Yöntem B:** Müşteriden ödeme yaparken "Sipariş Notu" alanına kendi `business_id`'sini
  yapıştırmasını iste (pratik değil, B yöntemini önermiyoruz).

Eşleşme bulunamazsa ödeme `payment_logs` tablosuna `unmatched` durumuyla kaydedilir,
abonelik otomatik uzamaz — panelden elle "Ödendi" işaretlemen gerekir.


## 3) Vercel'e Deploy
1. Bu projeyi GitHub'a push et (veya Vercel CLI ile direkt deploy et).
2. vercel.com'da "New Project" → GitHub reponu seç.
3. Framework Preset: **Vite** (Vercel otomatik algılar).
4. Environment Variables kısmına şunları ekle (Production + Preview + Development hepsine):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SHOPIER_OSB_USERNAME`
   - `SHOPIER_OSB_PASSWORD`
5. Deploy'a bas.

## 4) Test Et
- `https://senin-domainin.vercel.app/` → Login ekranı gelmeli (admin / freestyle12.)
- `https://senin-domainin.vercel.app/card/{business_id}` → Google Review linkine yönlendirmeli
- Shopier'den test ödemesi yap → aboneliğin 30 gün uzadığını panelden kontrol et

## Mimari Notu
- `/card/:id` yönlendirmesi **client-side React route** olarak çalışır (CardRedirect.tsx),
  ayrı bir backend sunucusuna ihtiyaç yoktur.
- `/api/webhook/shopier` tek bir Vercel Serverless Function'dır (`api/webhook/shopier.ts`),
  Shopier'in OSB ödeme bildirimini alır, HMAC ile doğrular ve Supabase'i günceller.
- Local geliştirme için: `npm run dev` (sade Vite dev server, backend gerekmez).
