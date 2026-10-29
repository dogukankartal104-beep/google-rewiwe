# Social Bot

Videoyu yükle, saat seç; Instagram Reels, YouTube (Shorts) ve TikTok'a otomatik paylaşır.

## Railway kurulumu
1. Railway'de yeni proje → bu repo, **Root Directory = `social-bot`**.
2. **Postgres** ekle (DATABASE_URL otomatik gelir).
3. **Volume** ekle, mount path `/data` (videolar burada durur).
4. Settings → Networking → Generate Domain; çıkan adresi `BASE_URL` yap.
5. `.env.example`'daki değişkenleri Variables'a gir.

## Platform anahtarları (hepsi ücretsiz, ama kurulum şart)
Redirect URI'leri: `BASE_URL/oauth/instagram/callback`, `/oauth/youtube/callback`, `/oauth/tiktok/callback`

- **Instagram:** developers.facebook.com → uygulama → Instagram API with Instagram Login. Hesap Business/Creator olmalı. Kendi hesabın için uygulamayı "Development" modunda bırakıp kendini test kullanıcısı ekleyebilirsin; review gerekmez.
- **YouTube:** console.cloud.google.com → YouTube Data API v3 aç → OAuth client (Web). Denetimden geçmemiş projede yüklenen videolar **private** kilitlenir; yayın için API compliance audit formu gerekir.
- **TikTok:** developers.tiktok.com → uygulama → Content Posting API. Denetim geçene kadar sadece `SELF_ONLY` paylaşılır (`TIKTOK_PRIVACY`).
