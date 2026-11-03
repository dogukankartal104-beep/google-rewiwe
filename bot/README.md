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
| Sinyal | **günde 1 tane**, `FREE_DELAY_MIN` dk gecikmeli, **sadece kârdaysa** | **hepsi, anında**, giriş/stop/TP1/TP2/R:R |
| Pozisyon boyutu | — | ✅ hesaba göre lot + $ risk |
| Giriş/stop/hedef fiyatı | ❌ **asla** | ✅ |
| Sonuç kartı | ✅ (vitrine çıkanın sonucu, kaybetse de) | ✅ hepsi |
| Günlük analiz | rejim, genişlik, hareketliler, sistem durumu | + izleme listesi **seviyeleriyle**, açık pozisyonlar, filtre detayı |
| Gün kapanışı | ✅ vitrin | — |
| Eğitim içeriği | ✅ (sonunda VIP çağrısı) | ✅ (çağrısız) |
| Haftalık/aylık tablo | ✅ | ✅ (daha detaylı) |

### Free vitrin kuralları

Free kanala giden sinyal **seçilir**, akmaz:

1. Gecikme dolar (`FREE_DELAY_MIN`, vars. 40 dk)
2. Sınıf eşiği geçer (`MIN_GRADE_FREE`, vars. B)
3. **Pozisyon kârda olmalı** (`FREE_ONLY_WINNING`, min `FREE_MIN_OPEN_R` = +0.5R)
4. Kârda değilse hemen vazgeçmez — `FREE_PENDING_MAX_H` saat boyunca bekler,
   o sürede kâra geçerse yayınlar. Geçmezse sessizce atlar.
5. Birden fazla aday varsa **en iyisi** seçilir
6. Günde en fazla `FREE_SIGNALS_PER_DAY` (vars. 1)

Mesaj şöyle gider: *"🔥 Şu an kazanan pozisyon — WIF SHORT, +1.35R önde.
Bunu 1 sa 20 dk önce VIP'te girişiyle açtık. Yön doğru çıktı, ama nereden
girip nerede çıkacağını bilmeden yön tek başına para kazandırmaz."*

> **Dürüstlük notu — önemli.** Vitrine sadece kazananlar çıkar, ama vitrine
> çıkan pozisyonun **sonucu kaybetse bile free kanala gönderilir**. Kazananı
> gösterip sonucu saklamak yapmadığımız bir şey. Ayrıca haftalık/aylık
> tablolar **tüm** işlemleri içerir — zarar edenler dahil. Vitrin bir seçki,
> tablo ise tam kayıttır; kanalın güvenilirliği o tablodan gelir, kaldırma.

Testler free şablonlarının giriş/stop/TP fiyatlarını sızdırmadığını ve kapı
mantığının her dalını doğruluyor (`test/free-dashboard.test.js`).

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

### 2) Veritabanı — Railway Postgres

Harici hiçbir servise kaydolman gerekmez. Railway içinde:

1. Projende **+ New → Database → PostgreSQL**
2. Bot servisinin **Variables** kısmına şunu ekle:
   `DATABASE_URL=${{Postgres.DATABASE_URL}}`
   (Railway bunu otomatik doldurur)

**Tabloları bot kendisi kurar.** Açılışta `migrate()` çalışır ve eksik tablo
varsa oluşturur. Elle SQL çalıştırman gerekmez, bir dosya yapıştırman gerekmez.
Yeni sürümde yeni tablo gelirse de aynı şekilde otomatik eklenir.

> Supabase kullanmak istersen de çalışır: Supabase'in verdiği bağlantı
> dizesini (Settings → Database → Connection string) `DATABASE_URL`'e koyman
> yeterli. Kod tek bir Postgres yolu kullanıyor.

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
✅ Postgres bağlantısı çalışıyor, tablolar hazır
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
| `/dash` | Dashboard linkini DM'le gönderir |
| `/tiklama` | VIP link tıklama istatistiği |
| `/tara` | Şimdi bir tarama turu çalıştır |
| `/egitim` | Eğitim postunu şimdi yayınla |
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
| Eğitim postu | `EDU_HOUR`:00 (vars. 13:00) | ikisi (free'de VIP çağrısı var) |
| Flaş haber | eşiği geçen haber çıkınca (max `NEWS_MAX_PER_DAY`/gün) | ikisi |
| Haber özeti | `NEWS_DIGEST_HOUR`:00 (vars. 19:00) | ikisi |
| Abone fotoğrafı | 09:00 ve 21:00 | — (dashboard için) |
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

**Veritabanı erişilemezse** bot sinyal yayınlamaz (kayıt tutamadığı için takip
de edemez) ama çökmez; bağlantı dönünce kaldığı yerden devam eder.

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
│   ├── lessons.js      25 derslik eğitim kütüphanesi
│   ├── dashboard.js    panel: toplu veri + tek sayfa HTML
│   ├── publisher.js    kanallara yayın + dönem anahtarları
│   ├── commands.js     DM komutları + admin paneli
│   ├── payments.js     NOWPayments fatura + IPN imza
│   ├── vip.js          üyelik ver/hatırlat/çıkar
│   ├── server.js       IPN webhook + /health
│   ├── db.js           Postgres katmanı + otomatik tablo kurulumu
│   └── util.js         biçimleme, TR saat, seans, havuz
├── test/               139 test (ağ gerektirmez)
├── railway.json
└── .env.example
```

Bağımlılık: `pg` (Postgres) ve `ws` (opsiyonel, WebSocket teyidi — Node 22'de
yerleşik WebSocket kullanılır). Telegram, Binance, NOWPayments ve RSS çağrıları
yerleşik `fetch` ile yapılır.

---

## Uyarı

Bu sistem yatırım tavsiyesi üretmez. Kaldıraçlı kripto işlemleri sermayenin
tamamının kaybıyla sonuçlanabilir. Ücretli sinyal hizmeti sunmak bulunduğun
ülkede lisans/kayıt gerektirebilir ve vergiye tabi olabilir — bunu kendin
araştırmalısın. Tüm mesaj şablonlarında "yatırım tavsiyesi değildir" uyarısı
otomatik eklenir; kaldırma.

---

## Dashboard

Ayrı bir Railway servisi **yok** — panel botun kendi HTTP sunucusunda çalışır,
ek maliyeti yoktur. Veri 60 saniye önbelleklenir, böylece sayfa yenilendikçe
veritabanı yorulmaz.

**Açmak için:** `DASHBOARD_KEY` değişkenine uzun ve rastgele bir metin yaz.
Sonra Telegram'da bota `/dash` yaz — linki sana gönderir.
Doğrudan adres: `https://<domain>/dash?key=<DASHBOARD_KEY>`

Panelde ne var:

| Bölüm | İçerik |
|---|---|
| **Para** | Aktif VIP · bugün giren üye · bugünün ve 30 günün geliri · bekleyen ödeme · bota yazan kişi |
| **Performans** | Bugünün ve 30 günün net R'si · isabet oranı · işlem başına R · kâr faktörü · max düşüş · açık pozisyon |
| **Kanal & ilgi** | Free/VIP abone sayısı ve günlük değişim · VIP butonu tıklamaları · hangi mesaj türü en çok tıklanıyor |
| **Günlük net R** | Son 30 günün gün gün çubuk grafiği + kümülatif |
| **Son sinyaller** | Coin · sınıf · durum · R · free'ye gitti mi (gitmediyse neden) |
| **Açık pozisyonlar** | Anlık R, kısmi çıkış yapıldı mı |
| **Son ödemeler** | Plan · tutar · durum · hangi Telegram kullanıcısı |
| **Sistem & dağılım** | BTC/rejim/DVOL/şok · sınıfa ve yöne göre performans kırılımı |

### "Kaç kişi gördü?" sorusu

Telegram **Bot API gönderi görüntülenme sayısı vermiyor** — bu bir eksiklik
değil, API'de böyle bir alan yok (görüntülenme yalnızca Telegram uygulamasının
arayüzünde ve MTProto kullanıcı API'sinde var, bot hesabında yok).

Onun yerine daha anlamlı bir şey ölçülüyor: **VIP butonuna kaç kişi tıkladı.**
Free kanaldaki butonlar `PUBLIC_URL/go/vip` üzerinden geçip davet linkine
yönlendiriyor, her tıklama kaydediliyor. Dashboard bunu hem toplam hem de
kaynağına göre (`showcase`, `recap`, `perf`, `daily`, `edu`) gösteriyor —
yani **hangi içerik türü müşteri getiriyor** sorusunun cevabı.

Görüntülenme bir gösterge, tıklama ise niyettir. Dönüşümü optimize etmek için
ikincisi gerekir: "sonuç kartları %40 daha çok tıklanıyor" bilgisi, ham
görüntülenme sayısından çok daha işe yarar.

Ayrıca abone sayısı günde iki kez kaydedilir, böylece kanal büyümesi ve
hangi içeriğin abone getirdiği zaman içinde görülebilir.

---

## Eğitim içeriği

`src/lessons.js` içinde **25 ders** var: Open Interest, likidite süpürmesi,
CVD, aVWAP, ATR, POC/Value Area, funding, likidasyon kaskadı, pozisyon boyutu,
stop yerleştirme, R:R ve süre ilişkisi, komisyon/kayma, kaldıraç gerçeği,
seans etkisi, günlük zarar limiti, performans tablosu okuma...

Hepsi sistemin **gerçekten kullandığı** kavramları anlatır — dolgu içerik yok.
Günde bir tane sırayla yayınlanır ve tekrar etmez (`edu_log` tekilliği).
Free sürümünün sonunda VIP çağrısı var, VIP sürümünde yok.

25 ders ≈ 25 gün. Bittiğinde bot log'a yazar; `lessons.js`'e yeni ders
eklemen yeterli, id'leri değiştirme (değiştirirsen eskiler tekrar yayınlanır).

---

## Railway maliyeti

Bot tek container'da çalışır: tarayıcı, Telegram dinleyicisi, IPN sunucusu ve
dashboard hepsi aynı serviste. Ek servis yok.

Maliyeti düşük tutan ayarlar:

- `SCAN_INTERVAL_SEC=120` — tur arası 2 dakika (90'dan yükseltildi)
- `ECO_MODE=true` — TR 00:00–04:00 arası tarama aralığı ×3 olur.
  O saatlerde likidite ince, sistem zaten sinyal üretmiyor.
- `SCAN_TOP=60` — her yönde incelenen coin sayısı. Düşürürsen CPU düşer.
- `WS_CONFIRM` sadece ön elemeyi geçen birkaç aday için açılır, hepsi için değil
- Dashboard verisi 60 sn önbellekli
- Sektör sorgusu 6 saat önbellekli ve sadece sinyal adayları için

Daha da kısmak istersen: `SCAN_INTERVAL_SEC=180`, `SCAN_TOP=40`,
`WS_CONFIRM=false`, `SECTOR_CHECK=false`. Bunlar sinyal kalitesini bir miktar
düşürür (teyit skoru azalır → sınıf düşebilir), tarama sıklığını azaltır.

---

## Haber motoru

API anahtarı **gerekmez** — RSS ile çalışır.

**Nasıl çalışır:**
1. Her `NEWS_CHECK_MIN` dakikada kaynaklar taranır (varsayılan 20 dk)
2. Her başlık anahtar kelimelere göre **puanlanır**
3. `NEWS_MIN_SCORE` üstü = **flaş haber**, anında iki kanala da gider
4. Günde en fazla `NEWS_MAX_PER_DAY` flaş haber (spam koruması)
5. Kalanlar akşam `NEWS_DIGEST_HOUR`'da tek özet mesajda toplanır
6. Aynı haber iki kez yayınlanmaz (`news_log`)

**Puanlama mantığı** — dikkat çekmesi *ve* piyasayı gerçekten etkilemesi:

| Puan | Kategori | Örnek |
|---|---|---|
| 50 | GÜVENLİK | hack, siber saldırı, fon çalınması, güvenlik açığı |
| 45 | İFLAS | iflas, çekimlerin durması, konkordato |
| 42 | LİKİDASYON | milyar dolarlık likidasyon dalgası |
| 40 | MAKRO | Fed, FOMC, faiz, enflasyon, CPI, NFP |
| 38 | DÜZENLEME | SEC, dava, soruşturma, yasak, SPK |
| 36 | ETF | ETF giriş/çıkışları |
| 30 | BORSA | listeleme, listeden çıkarma |
| 25 | AĞ | halving, güncelleme, token kilidi açılımı |
| 24 | BALİNA | büyük transferler |
| 22 | RUG | dolandırıcılık iddiaları |
| 18 | PİYASA | rekor, sert düşüş, ralli |

Büyük isim (BTC, ETH, Binance...) geçiyorsa **+10**. Birden fazla kural
eşleşirse puanlar **toplanır** — "SEC soruşturması sonrası iflas başvurusu"
gibi bir haber 80+ alır.

**Haber dökümü değil, bağlam.** Her flaş haber sistemin o anki durumuyla
birlikte gider: *"BTC 15dk −2.1% · ⚡ şok 3.2× ATR · Sistem yeni pozisyon
açmıyor — şok hareketinde teknik yapı güvenilmez."* Amaç haber vermek değil,
haberi işlem kararına bağlamak.

**Çeviri:** Türkçe kaynaklar önceliklidir (İngilizce kaynak puanından −8 düşer).
İngilizce bir haber flaş eşiğini geçerse başlık **özgün dilinde** bırakılır ve
altına Türkçe "neden önemli" açıklaması eklenir. Uydurma çeviri yapılmaz.

### Türkçe metin notu (teknik)

JavaScript'te `\b` kelime sınırı yalnızca `[A-Za-z0-9_]` tanır. Yani
`/\bçalın/` ifadesi " çalındı" içinde **eşleşmez** — ç harfi `\w` değildir.
Bu yüzden kurallar Unicode sınırı (`(?<![\p{L}\p{N}])`) ile yazıldı. Yeni
anahtar kelime eklerken `\b` kullanma, `W(...)` yardımcısını kullan.

**Kaynakları değiştirmek:** `NEWS_FEEDS` env'ine virgülle ayrılmış RSS adresleri
yaz. Boş bırakırsan varsayılan Türkçe + İngilizce kaynaklar kullanılır.
`/haber` komutu taramayı puanlarıyla gösterir (yayınlamadan) — kaynakların
çalışıp çalışmadığını buradan görebilirsin.

---

## Eğitim kütüphanesi

**36 ders**, 21 farklı kategoride. Hepsi sistemin gerçekten kullandığı
kavramlar üzerine — ve hepsi aynı kalıpta değil:

- **Kavram dersleri** — OI, CVD, aVWAP, ATR, POC/value area, funding,
  likidasyon kaskadı, emir defteri, beta
- **Risk dersleri** — pozisyon boyutu, stop yerleştirme, R:R ve süre,
  komisyon/kayma, kaldıraç gerçeği
- **"Başına gelebilir" uyarı hikâyeleri** — stop avı, ortalama düşürme,
  borsa çökmesi, haber pumpı, intikam işlemi
- **Efsane yıkma** — gizli indikatör yok, sinyal kanalı nasıl ayıklanır
  (bu kanal dahil), "100 dolardan 10 bin" hikâyeleri
- **Kontrol listeleri** — işlem öncesi 60 saniye, haftalık gözden geçirme,
  yeni başlayanlar için ilk 30 gün

Günde 1 ders ≈ 36 gün içerik. Sırayla gider, tekrar etmez.
Bittiğinde bot log'a yazar; `lessons.js`'e yeni ders ekle, **id'leri değiştirme**.


---

## Security model

**Who can reach VIP.** Only a single-use invite link that the bot creates for one paying member.
There is no static VIP link anywhere (a test fails if one is ever wired back in). Every "Join VIP"
button opens the *bot*, never an invite link. Anyone who joins VIP without an active membership is
removed (for example a friend using a paying member's link), and VIP posts are sent with
`protect_content` so they cannot be forwarded or saved.

**Payments.** The IPN body is never trusted for money decisions; it only tells us a `payment_id`.
The payment is re-fetched from NOWPayments with our own API key and *everything* (status, order,
amount, currency) is read from that response. Access is granted at most once per order through an
atomic database claim (`UPDATE ... WHERE credited=false`), so concurrent or repeated notifications
cannot double-grant. The amount must cover the invoice. Underpaid, failed and reversed payments are
never granted automatically; they alert the admins instead.

**The public endpoints** (`/ipn/nowpayments`, `/go/vip`, `/dash`) are size-capped and rate-limited.
Garbage requests are dropped quietly and never reach the admins; alerts only fire for things that
involve a real payment, and each alert is throttled. The dashboard key is compared in constant time,
a client is locked out after 10 wrong tries, and the page sets `Referrer-Policy: no-referrer` so the
key in its URL cannot leak.

**Secrets** live only in Railway variables. The repository and its full git history contain none.
Treat `TELEGRAM_BOT_TOKEN`, `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`, `DASHBOARD_KEY` and
`DATABASE_URL` as passwords: if any of them was ever pasted into a chat or a screenshot, rotate it
(BotFather `/revoke`, NOWPayments dashboard, a new random `DASHBOARD_KEY`).

**Known limits.** A member can always screenshot a signal. The IPN signature algorithm has not yet
been exercised with real NOWPayments traffic; the API re-check above is what protects payments, and
the bot alerts you if a genuine payment arrives with a signature that does not verify. Run one
end-to-end test purchase (see the hidden `_test` plan) before selling to real customers.

## News: VIP and free are different products

- **VIP** gets a fresh flash story (at most `NEWS_MAX_PER_DAY` a day) with a *desk view*: how to
  trade around it, the live market state, the coins it names and the open book.
- **Free** gets only big stories (`NEWS_FREE_MIN_SCORE`), at most one a day, `NEWS_FREE_DELAY_MIN`
  minutes after VIP, without the desk view, with a pointer to VIP.
- The same event is never posted twice: duplicates are caught by story id, headline similarity and
  a per-topic cooldown (`NEWS_TAG_COOLDOWN_H`). A story older than `NEWS_BREAKING_MINUTES` is not
  "breaking"; it waits for the evening digest.

## Macro window

The decision engine vetoes every new position inside a macro window (30 minutes before to 15 after a
release). NFP is computed automatically (first Friday, 08:30 New York time with real DST rules); add
FOMC, CPI and others with `MACRO_EVENTS`. A high-scoring macro headline also switches the veto on for
30 minutes.
