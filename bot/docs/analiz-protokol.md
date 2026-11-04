# Analiz protokolü: 3 aday sinyal motoru (v1k, kilit açılışı, G1)

Bu dosya, tek bir sonuç görülmeden ve tek satır analiz kodu yazılmadan önce yazıldı. Plan sonradan
değiştirilmez. Yeni fikir ya da zorunlu bir düzeltme en alttaki "EK" bölümüne tarihle eklenir; sonuçlar
görüldükten sonra yapılan her ek açıkça "sonuç sonrası" diye işaretlenir ve karar kurallarını değiştiremez.
Başka bir projeden gelen rakamlara (n, ortalama, kazanma oranı) güvenilmez; her şey bu depodaki
altyapıyla, Binance halka açık arşivinden yeniden ölçülür.

## 0. Veri ve erişim

- Binance arşivi (`data.binance.vision`, erişilemezse S3 aynası): USDT-M vadeli 1m ve 15m mumlar,
  günlük mumlar (1d), `fundingRate`. Mevcut `bt/archive.js` kullanılır (CDN, sonra S3; hatalar sayılır ve
  raporlanır, sessizce yutulmaz).
- Evren: arşivde mumu olan bütün `*USDT` sürekli vadeliler; kaldırılmış (delist) sözleşmeler dahil.
- DefiLlama (`api.llama.fi/emissions`, `/emission/{protokol}`) yalnız MOTOR 2 için gerekir. Bu oturumun
  ağ ilkesi `api.llama.fi` adresine izin vermiyor (bağlantı reddedildi). İzin verilmezse MOTOR 2 için
  rapora "ÖLÇÜLEMEDİ: veri kaynağına erişim yok" yazılır; yerine uydurma ya da tahmini veri konmaz.
- Finora alarmları kullanılmaz; v1k kuralı doğrudan Binance verisinden hesaplanır.

## 1. Ortak ölçüm kuralları (3 motor için)

1. İleriye bakma yok: karar yalnız sinyal anından ÖNCE kapanmış mumlarla verilir. Sinyal anı, kararı
   tetikleyen mumun kapanış zamanıdır.
2. Giriş: sinyal anından sonra başlayan ilk 1m mumun açılışı. Çıkış ve stop 1m mum yolundan:
   - SHORT stop: bir 1m mumun en yükseği ≥ stop fiyatı → stop fiyatından çıkış (ilk dokunan mum).
   - LONG stop: en düşüği ≤ stop fiyatı → stop fiyatından çıkış.
   - Aynı mumda hem stop hem hedef olursa stop sayılır (şu üç motorda hedef yok; kural yine de yazılı).
   - Zaman çıkışı: belirtilen anda (UTC) başlayan 1m mumun açılışı.
3. Masraf (notional'a göre): gidiş-dönüş komisyon %0.10 + kayma %0.05 = %0.15 toplam; stop dolumunda
   ek %0.20; funding (arşivdeki gerçek `fundingRate`, pozisyon açıkken geçen her zaman damgası için;
   SHORT pozitif funding alır, LONG öder).
4. Donmuş ve hacmi sıfır mumlar: 1m yolunda hacmi 0 olan mumlar stop tetikleyemez ve çıkış fiyatı için
   son geçerli (hacmi > 0) kapanış kullanılır. Sinyal mumunun hacmi 0 ya da yüksek = düşük ise sinyal
   atılır. 24 saatlik hacim koşulu `quote_volume` toplamıyla ölçülür.
5. Kapsam raporu: denenen coin sayısı, veri bulunamayan sembol/ay sayısı, indirme hataları, atılan
   sinyal sayısı ve sebepleri. Her tablonun yanında n yazılır.
6. Dönemler: KEŞİF 2022-01-01 → 2023-12-31, DOĞRULAMA 2024-01-01 → 2025-12-31, SON 2026-01-01 → arşivdeki
   son tam gün. Bir sinyal, SİNYAL ANININ tarihine göre döneme girer.
7. Birim: işlem başına net getiri, notional'ın yüzdesi (masraf ve funding düşülmüş). "Ortalama" aritmetik
   ortalama, "ortanca" medyan.
8. Bootstrap: hafta-kümeli (aynı haftanın işlemleri birlikte örneklenir), 2000 yeniden örnekleme, sabit
   tohum. "%90 güven aralığı" = ortalamanın 5. ve 95. yüzdelikleri; karar kuralındaki "%90 alt" = 5.
   yüzdelik (tek yönlü 95 değil, iki yönlü 90 aralığın alt ucu: daha katı).

## 2. Motorlar (kurallar donduruldu)

### MOTOR 1: v1k aşırı pump SHORT
- 15m mumun kapanışı, önceki 15m kapanışa göre ≥ +%4; 24 saatlik değişim = kapanış / 96 mum önceki
  kapanış − 1 ≥ +%50; BTCUSDT 24 saatlik değişim (aynı biçimde 96 mum) ≤ −%1; son 96 kapanmış 15m mumun
  `quote_volume` toplamı ≥ 1.000.000 $.
- İşlem: SHORT, giriş sinyal anından sonraki ilk 1m açılışı, stop = giriş × 1.50, 24 saat sonra zaman
  çıkışı, hedef yok. Aynı coinde önceki sinyalden sonra 4 saat soğuma. Pozisyonlar çakışabilir (üst sınır
  yok); sınırlar yalnız takipçi hesabı benzetiminde (analiz 7-8) uygulanır.
- İddia (güvenilmez, yalnız karşılaştırma için): n 67, ort +%9.55, ortanca +%14.1, kazanma %64.

### MOTOR 2: Kilit açılışı SHORT
- DefiLlama emisyon verisinden yalnız yatırımcı (kategori adı `investor|private|seed`) ve ekip
  (`team|core`) kategorileri, büyük/küçük harf duyarsız. Tek seferlik (cliff) açılış: tek zaman damgasında
  gerçekleşen, doğrusal olmayan açılış. Boyut ≥ açılıştan hemen önceki dolaşımdaki arzın %3'ü.
- Token Binance USDT vadelide var (sembol eşlemesi: `X` → `XUSDT`, `1000X`/`1000000X` önekleri
  ayıklanarak) ve sinyal anında son 96×7 kapanmış 15m mumun ortalama günlük `quote_volume`'u ≥ 1M $.
- İşlem: SHORT; giriş = (açılış günü UTC tarihi − 7 gün) 00:00 UTC'den sonraki ilk 1m açılışı; çıkış =
  açılış günü 00:00 UTC; stop = giriş × 1.30. Bilgi anı: sinyal T−7'de verilir, açılış tarihi o anda
  zaten DefiLlama'da yayınlanmış olmalıdır (sonradan eklenen/değişen tarihler kullanılmaz; veri anlık
  görüntüsüyle ayırt edilemiyorsa bu durum raporda "ileriye bakma riski" olarak yazılır).
- Piyasa fazlası = işlem − aynı süredeki ilk 10 coin sepeti.
- İddia: 2024-26 n 261, ort +%3.07, piyasaya göre fazlası +%2.04; 2020-23'te geçmedi.

### MOTOR 3: G1 çöküş dibi LONG
- Evren: o ayın hacimce ilk 50 coini. İKİ SÜRÜM ölçülür, karar yalnız dürüst sürümle verilir:
  - G1-S (ifade edildiği gibi): sinyal gününün takvim ayının toplam `quote_volume`'una göre sıra. Bu sıra
    ay bitmeden bilinemez (ileriye bakma). Yalnız iddiayı yeniden üretmek için kullanılır.
  - G1-D (dürüst): sinyal gününden önceki tam takvim ayının toplam `quote_volume`'una göre ilk 50.
- Tetik: UTC günlük kapanış, bir önceki günlük kapanışa göre ≤ −%10.
- İşlem: LONG; giriş ertesi günün 00:00 UTC'sinden sonraki ilk 1m açılış; 3 gün tutulur (giriş gününden
  3×24 saat sonra 00:00 UTC açılışında çıkış). İki varyant: stop yok; stop = giriş × 0.67 (−%33).
- İddia: işlem başı +%1.76, 7 yılın 6'sında +; çöküş günlerinde işlemler birlikte kaybeder.

## 3. Her motor için analizler

1. **Yeniden üretim:** kural aynen uygulanır; n, ortalama, ortanca, kazanma oranı iddiayla yan yana
   yazılır, fark ve olası sebepleri (dönem, masraf, evren, kural yorumu) yazılır.
2. **Dönem kırılımı:** yıl yıl ve çeyrek çeyrek n, ortalama, ortanca, kazanma; KEŞİF ↔ DOĞRULAMA ↔ SON.
3. **Sağlamlık:** hafta-kümeli bootstrap %90 aralığı; en iyi 5 işlem hariç ortalama; en çok kâr eden tek
   günün toplam net kârdaki payı (kâr toplamı ≤ 0 ise "tanımsız", pay ≤ %20 beklenir).
4. **Plasebo:** aynı coin, aynı yön, aynı süre, aynı stop oranı ile sinyalden 3 gün ve 14 gün ÖNCEKİ
   zamanda açılan işlem. Fark = sinyal − plasebo (eşleştirilmiş ortalama farkı, hafta-kümeli bootstrap).
   Piyasa fazlası = işlem − aynı süredeki, bir önceki tam aya göre hacimce ilk 10 coinin eşit ağırlıklı
   sepetinde AYNI YÖNDEKİ işlem (sepet için masraf düşülmez).
5. **Eşik platosu:** v1k: 24s {40, 50, 60}% × BTC {−0.5, −1, −2}%; kilit: boyut {1, 3, 5}% × gün
   {T−3, T−7, T−14}; G1: eşik {−8, −10, −12}%. Düzlük ölçütü: DOĞRULAMA+SON birleşik ortalaması > 0 olan
   komşu hücre oranı (merkez hariç). Bu ızgaradan YENİ eşik seçilmez; yalnız sağlamlığa bakılır.
6. **Gecikme:** giriş 0 / 5 / 15 / 30 / 60 dakika geç (çıkış zamanı aynı kalır, stop girişe göre). Kenarın
   yarıya indiği gecikme: ortalama, 0 dk ortalamasının yarısının altına ilk düştüğü gecikme.
7. **Stop ve kaldıraç:** 1x/2x/3x izole, bakım marjini %0.5 varsayılır; tasfiye fiyatı SHORT için
   giriş × (1 + 1/L − 0.005), LONG için giriş × (1 − 1/L + 0.005). 1m yolunda tasfiyenin stoptan önce gelip
   gelmediği sayılır (tasfiye gelirse kayıp = marjinin tamamı). Takipçi hesabı: bakiye 1000 $, sinyal başına
   bakiyenin %5'i marj, 1x ve 2x; işlemler girişe göre sıralı, kapanışta realize; bakiye eğrisi, en büyük
   düşüş, en uzun kayıp serisi.
8. **Eşzamanlılık:** günlük sinyal sayısı dağılımı (en çok / ortanca / gün başına 3+ olan gün oranı);
   "günde en çok 2" ve "aynı anda en çok 3 açık" kurallarıyla takipçi hesabı (ilk gelen alınır).
9. **Kalabalık etkisi:** sinyal anındaki 24 saatlik hacim dağılımı (yüzdelikler); 100 takipçi × 200 $ =
   20.000 $ girişin hacme oranı (‰); 24s hacmin %0.1 / %0.5 / %1'ini aşan sinyal oranı; 1M $ altı hacimde
   kayma riski için hacim sınırına yakın sinyallerin sonuçları.
10. **Kayıp anatomisi:** en kötü 10 işlem (coin, tarih, getiri, sinyalden sonraki fiyat yolu, aynı gün BTC
    hareketi). Girişte ayırt edilebilirlik: en kötü 10'un bilinen giriş özelliklerinin geri kalanlara göre
    yüzdelik sırası. Ayırt edilemiyorsa filtre DENENMEZ; yazılır ve geçilir.

## 4. Karar kuralları (sonuç görülmeden sabit)

Bir motor sürümü (G1 için dürüst sürüm ve her stop varyantı ayrı değerlendirilir):

- **YAYINA UYGUN:** hepsi birden: DOĞRULAMA'da ve SON'da ayrı ayrı ortalama > 0 ve ortanca > 0; DOĞRULAMA+
  SON birleşiğinde %90 aralığın alt ucu > 0; plasebo farkı (3 gün ve 14 gün plasebonun ikisine göre) > 0;
  15 dk gecikmede DOĞRULAMA+SON ortalaması > 0; 1x takipçi hesabında en büyük düşüş ≤ %30 (DOĞRULAMA+SON);
  ayrıca DOĞRULAMA+SON birleşiğinde n ≥ 30 (altında karar "yetersiz veri" olur ve GÖLGE'ye düşer).
- **GÖLGE:** DOĞRULAMA+SON birleşik ortalaması > 0 ama yukarıdaki şartlardan biri tutmuyor → 30 canlı
  kâğıt sinyalle izlenir.
- **BIRAK:** DOĞRULAMA ya da SON döneminde ortalama ≤ 0 (n ≥ 5 olan dönem için).
- Boş ya da n < 5 olan dönem "veri yok" diye yazılır, kural bozulmaz: karar o dönemi yok sayarak
  yalnız dolu dönemlerle verilir ve bu açıkça yazılır.
- Kararlar mekanik uygulanır; "neredeyse" yoktur.

## 5. Çıktılar

- `bot/docs/analiz-rapor.md`: her motor için tablolar ve karar; başarısız sonuçlar aynı açıklıkla.
- Tekrar üretilebilir betikler `bot/bt/analiz/` altında, tek komutla (`node bt/analiz/run.js`).
- Sonda takipçi için tek satır: "1000 $ ile ayda beklenen $ ve en kötü ay $" (DOĞRULAMA+SON, 1x,
  sinyal başına %5, yayına uygun olmayan motorlar için de hesaplanır ama kararla birlikte etiketlenir).

## 6. Kapsam dışı (bu aşamada)

Botun sinyal servisine gölge modda eklenmesi, free/VIP gecikme kuralları ve karne komutu, bu analizden
sonra ve kullanıcının kararıyla yapılır. Bu analiz hiçbir kanala mesaj göndermez.

## EK (yalnız tarihli, sonradan eklenen)

(boş)
