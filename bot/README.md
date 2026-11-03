# FADE Bot — Telegram Sinyal & Analiz Sistemi

`fade-hud.html` dosyasındaki analiz motorunun Railway'de 7/24 çalışan Telegram
botu hâline getirilmiş sürümü. Free kanala vitrin, VIP kanala tam plan atar,
NOWPayments ile kripto ödeme alıp VIP erişimi otomatik yönetir.

---

## Sistem ne yapıyor?

Motor **trend takip etmez**. Aşırıya giden hareketin *tükendiği* yeri arar (fade).

Her tur Binance Futures'ta 24 saatte `SCAN_MIN_CHG`%'den fazla hareket eden
coinleri alır ve her biri için üç fazlı onay arar:

| Faz | Ne sorar | Geçme şartı |
|---|---|---|
| **1 — Tip** | Hareketi spot mu taşıyor, kaldıraç mı? (Open Interest analizi) | OI eriyorsa *short squeeze* / *long likidasyonu* → ideal. OI şişiyorsa *kaldıraçlı trend* → **veto** |
| **2 — Tükenme** | Fitil, hacim sönümü, CVD dönüşü, OI erimesi, taker soğuması | 5 kontrolden **≥3** |
| **3 — Tetik** | Likidite süpürmesi, başarısız retest, yapı kırılımı, aVWAP reddi | 4 kontrolden **≥1** |

**Hard vetolar** (biri varsa işlem yok): OI şişmesi · BTC ters impulsta ·
makro olay/BTC şoku · coin 30 günden yeni.

Sonra plan çıkar:
- **Stop**: yapısal seviyeden (yerel tepe / süpürme fitiği / asıl tepe — en darı),
  ama coinin ATR'siyle sınırlanır (`minStopAtr`–`maxStopAtr` arası).
- **Hedef**: uydurulmaz. POC, value area, emir defteri duvarı, likidasyon kaskad
  durağı, %50 fib, aVWAP, EMA21/50 ve D/D seviyelerinden **ulaşılabilir** olan seçilir.
  Hedefin tipik süresi stopun süresinin `tpBarRatio` katını geçemez.
- **Boyut**: `riskPct` / stop mesafesi.
- **Teyit skoru**: emir defteri + canlı tape + bağlam (DVOL, beta, RVOL, genişlik,
  seans, funding) → sınıfı (A/B/C/D) bir kademe yükseltir veya düşürür.

Sinyal verildikten sonra mum mum **yeniden oynatılır** (replay): stop/TP1/TP2/süre
hangisi önce gerçekleşti, kısmi çıkış yapıldı mı, net R ne oldu. Mum içi sıra
bilinmediği için **muhafazakâr** davranır: aynı mumda hem stop hem hedef varsa
**stop** sayılır. Tüm sonuçlara komisyon + kayma düşülür (`feeBps`, `extraSlipBps`).

---

## Free ↔ VIP içerik ayrımı

Para kazandıran kısım bu ayrım. Free kanal **değeri gösterir, kullanılabilirliği vermez.**

| | FREE | VIP |
|---|---|---|
| Sinyal | `FREE_DELAY_MIN` dk **gecikmeli**, coin + yön + sınıf + gerekçe | **Anında**, giriş/stop/TP1/TP2/R:R |
| Pozisyon boyutu | — | ✅ hesaba göre lot + $ risk |
| Giriş/stop/hedef fiyatı | ❌ **asla** | ✅ |
| Sonuç kartı | ✅ (VIP vurgusuyla) | ✅ |
| Günlük analiz | rejim, genişlik, hareketliler, sistem durumu | + izleme listesi **seviyeleriyle**, açık pozisyonlar, filtre detayı |
| Gün kapanışı | ✅ vitrin | — |
| Haftalık/aylık tablo | ✅ | ✅ (daha detaylı) |

Free'ye giden en düşük sınıf `MIN_GRADE_FREE` ile ayarlanır. Testler, free
şablonlarının giriş/stop/TP fiyatlarını sızdırmadığını doğruluyor
(`test/messages.test.js` → *"freeTeaser: plan fiyatlarını SIZDIRMAZ"*).

---

## Kurulum

### 0) Önce test modunda başla
`.env.example`'da `DRY_RUN=true` geliyor. Bu modda bot hiçbir şey yayınlamaz,
sadece ne yayınlayacağını log'a yazar. Her şeyi doğrulayınca `false` yap.

### 1) Telegram botu
1. [@BotFather](https://t.me/BotFather) → `/newbot` → token'ı al → `TELEGRAM_BOT_TOKEN`
2. Botu **iki kanala da yönetici** yap. Gereken yetkiler:
   - **Mesaj gönderme** (her iki kanal)
   - **Mesaj sabitleme** (haftalık/aylık tabloyu sabitlemek için)
   - **Üye ekleme/çıkarma + davet linki oluşturma** (sadece VIP kanal — süre
     yönetimi bunu gerektirir)
3. `/newbot` sonrası BotFather'da `/setprivacy` → **Disable** (DM'leri alabilmesi için).

#### VIP kanal id'si nasıl bulunur?
Özel kanalın `@kullaniciadi`'sı olmadığı için sayısal id gerekir:
1. Botu VIP kanala yönetici yap.
2. Kanala herhangi bir mesaj at.
3. Tarayıcıda şunu aç (token'ını koy):
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. `"chat":{"id":-1001234567890` → bu sayı `VIP_CHANNEL_ID`.

Alternatif: mesajı [@userinfobot](https://t.me/userinfobot)'a ilet.

Kendi id'ni de [@userinfobot](https://t.me/userinfobot) ile bul → `ADMIN_IDS`.

### 2) Supabase
1. [supabase.com](https://supabase.com) → yeni proje (ücretsiz katman yeter).
2. **SQL Editor** → `sql/schema.sql` dosyasının tamamını yapıştır → **Run**.
3. **Project Settings → API**:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` anahtarı → `SUPABASE_SERVICE_ROLE_KEY`

> `service_role` anahtarı tüm tabloya yazabilir. Sadece Railway'in Variables
> kısmında dursun, hiçbir yere commit etme, kimseyle paylaşma.

### 3) Railway
1. [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**
   → bu repoyu seç.
2. **Settings → Root Directory → `bot`** ⚠️ Bu şart; yoksa Railway kök dizindeki
   React projesini kurmaya çalışır.
3. **Settings → Networking → Generate Domain** → çıkan adresi `PUBLIC_URL`'e yaz
   (sonunda `/` olmasın).
4. **Variables → Raw Editor** → `.env.example` içeriğini yapıştır, değerleri doldur.
5. Deploy.

> Railway'de 7/24 çalışması için **Hobby planı ($5/ay)** gerekir. Ücretsiz deneme
> kredisi bitince servis durur. HTTP sunucusu (`/health`) hem Railway'in
> healthcheck'i hem NOWPayments IPN adresi için zaten açık.

### 4) NOWPayments
1. [nowpayments.io](https://nowpayments.io) → kayıt → **ödeme alacağın cüzdanı ekle**
   (öneri: USDT TRC20 — en düşük ağ komisyonu).
2. **Settings → Payments → API keys** → `NOWPAYMENTS_API_KEY`
3. **Settings → Payments → Instant Payment Notifications**:
   - IPN secret key'i üret → `NOWPAYMENTS_IPN_SECRET`
   - Callback URL: `https://<senin-domain>.up.railway.app/ipn/nowpayments`
4. `PLANS` değişkenini kendi fiyatlarınla ayarla: `ad:fiyatUSD:gün`

#### Ödeme güvenliği — nasıl çalışıyor
IPN imzası doğrulanır, **ama VIP erişimi tek başına imzaya dayanarak verilmez.**
Her IPN'den sonra ödeme NOWPayments API'sinden **sunucu-sunucu yeniden sorgulanır**
(`GET /v1/payment/{id}`) ve erişim yalnızca o yanıt `finished`/`confirmed`
derse açılır. `order_id` de API yanıtından okunur, isteğin gövdesinden değil.

Böylece:
- Uydurma bir IPN isteği VIP kazandırmaz (API teyidi geçmez).
- Aynı ödeme iki kez işlenmez (`payments.credited` bayrağı).
- `partially_paid` otomatik erişim **vermez** — sana DM atar, `/ver` ile elle karar verirsin.

`NOWPAYMENTS_REQUIRE_SIG=true` yaparsan imza da zorunlu olur (daha sıkı, ama
imza hesabında bir sapma olursa gerçek ödemeler de reddedilir).

### 5) Doğrula
Railway'de deploy bitince **Deployments → Logs**'a bak. Ya da yerelde:

```bash
cd bot && npm install && npm run selftest
```

Şunları görmelisin:

```
✅ zorunlu ayarlar tamam
✅ Supabase bağlantısı çalışıyor
✅ Telegram botu: @senin_botun
✅ FREE kanalı erişilebilir (N üye)
✅ VIP kanalı erişilebilir (N üye)
✅ NOWPayments: {"message":"OK"}
✅ Binance verisi: 400+ sembol · BTC 15m ...
```

Sonra Telegram'dan botuna DM at: `/panel` → `/stats` → `/tara`.
Her şey tamamsa `DRY_RUN=false` yap.

---

## Komutlar

### Kullanıcı (DM)
| Komut | Ne yapar |
|---|---|
| `/start` | Tanıtım + komut listesi |
| `/vip` | Planlar + ödeme butonları |
| `/durum` | Üyeliğim ne zaman bitiyor |
| `/performans` | Son 30 günün net sonucu |
| `/nasil` | Sistem nasıl çalışır (uzun anlatım) |

### Admin (`ADMIN_IDS` içindeysen)
| Komut | Ne yapar |
|---|---|
| `/panel` | Admin menüsü |
| `/stats` | Sistem durumu, aktif VIP sayısı, 30 gün özeti |
| `/uyeler` | Aktif VIP listesi + kalan gün |
| `/ver <id> <plan>` | Elle VIP ver (ödeme almadan / eksik ödemede) |
| `/al <id>` | VIP'i bitir ve kanaldan çıkar |
| `/tara` | Şimdi bir tarama turu çalıştır |
| `/izleme` | Tetik bekleyen kurulumlar |
| `/gunluk` `/kapanis` `/haftalik` `/aylik` | İlgili yayını şimdi tetikle |

---

## Zamanlama

| Ne | Ne zaman | Nereye |
|---|---|---|
| Tarama + takip + free teaser | her `SCAN_INTERVAL_SEC` (vars. 90sn) | VIP anında, free gecikmeli |
| Sonuç kartı | pozisyon kapanır kapanmaz | VIP + free |
| Günlük analiz | `DAILY_HOUR`:00 (TR) | ikisi (ayrı içerik) |
| Gün kapanışı | 23:00 (TR) | free |
| Haftalık tablo | `WEEKLY_DAY`, `DAILY_HOUR`:10 | ikisi + sabitlenir |
| Aylık tablo | ayın `MONTHLY_DAY`'i, `DAILY_HOUR`:20 | ikisi + sabitlenir |
| VIP süre/hatırlatma taraması | her saat başı | DM |

Her yayın `posts` tablosundaki tekillik kısıtıyla korunur — Railway yeniden
başlasa veya aynı dakikada iki tur dönse bile **aynı gönderi iki kez atılmaz.**

---

## Önemli davranışlar

**Performans sayıları uydurulmaz.** Haftalık/aylık tablolar yalnızca `signals`
tablosunda gerçekten kapanmış kayıtlardan hesaplanır. Dönemde işlem yoksa tablo
"kapanan işlem yok" der — sahte sayı üretmez. Zarar eden dönem de olduğu gibi
yayınlanır. Botu yeni kurduysan **ilk hafta tablosu boş çıkar, bu normaldir**;
gerçek geçmiş birikmeden tablo paylaşmak istersen `POST_FREE=false` ile başla.

**Risk kapıları.** Gün `CFG_dailyStopR`'ye inerse veya `CFG_maxOpen` pozisyon
açıksa yeni sinyal **kaydedilir ama yayınlanmaz** (`status='atlandı'`). Böylece
"kaçırdığım fırsat" da görünür, istatistik de şişmez.

**Soğuma.** Aynı coin+yön için `CFG_reSignalMin` dakika geçmeden ikinci sinyal çıkmaz.

**Fail-safe tasarım.** Emir defteri çekilemezse, CoinGecko rate limit verirse veya
WebSocket açılmazsa ilgili kontroller "bilinmiyor" sayılır ve sistem REST verisiyle
devam eder — çökmez, ama teyit skoru düşer, dolayısıyla sınıf da düşebilir.

**Supabase erişilemezse** bot sinyal yayınlamaz (kayıt tutamadığı için takip de
edemez) ama çökmez; bağlantı dönünce kaldığı yerden devam eder.

---

## Yerelde çalıştırma

```bash
cd bot
npm install
cp .env.example .env    # değerleri doldur
```

```bash
node --env-file=.env src/index.js --selftest
```

```bash
node --env-file=.env src/index.js --once
```

```bash
npm test
```

---

## Dosya düzeni

```
bot/
├── src/
│   ├── index.js        giriş noktası, ana döngü, zamanlayıcı
│   ├── config.js       CFG (sistem parametreleri) + ENV
│   ├── binance.js      fapi/spot veri, emir defteri, DVOL, beta, RVOL
│   ├── indicators.js   ema, atr, cvd, zigzag, setup bulucu, D/D, hacim profili
│   ├── analyze.js      tek coin için tüm ölçümler
│   ├── decide.js       3 fazlı karar + vetolar + teyit skoru + sınıf
│   ├── plan.js         stop, hedef adayları, R:R, pozisyon boyutu, kaskad
│   ├── tracker.js      mum mum replay, net R, istatistik
│   ├── scanner.js      aday bulma, ön eleme, derin teyit
│   ├── tape.js         kısa süreli canlı tape teyidi (WebSocket)
│   ├── sector.js       CoinGecko sektör davranışı (cache'li)
│   ├── messages.js     tüm Telegram şablonları (free/VIP ayrımı burada)
│   ├── publisher.js    kanallara yayın + dönem anahtarları
│   ├── commands.js     DM komutları + admin paneli
│   ├── payments.js     NOWPayments fatura + IPN imza
│   ├── vip.js          üyelik ver/hatırlat/çıkar
│   ├── server.js       IPN webhook + /health
│   ├── db.js           Supabase (PostgREST) katmanı
│   └── util.js         biçimleme, TR saat, seans, havuz
├── sql/schema.sql      Supabase şeması
├── test/               86 test (ağ gerektirmez)
├── railway.json
└── .env.example
```

Bağımlılık: sadece `ws` (WebSocket teyidi için). Telegram, Binance, NOWPayments
ve Supabase çağrıları yerleşik `fetch` ile yapılır.

---

## Uyarı

Bu sistem yatırım tavsiyesi üretmez. Kaldıraçlı kripto işlemleri sermayenin
tamamının kaybıyla sonuçlanabilir. Ücretli sinyal hizmeti sunmak bulunduğun
ülkede lisans/kayıt gerektirebilir ve vergiye tabi olabilir — bunu kendin
araştırmalısın. Tüm mesaj şablonlarında "yatırım tavsiyesi değildir" uyarısı
otomatik eklenir; kaldırma.
