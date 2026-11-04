# v1k: rejim, giriş zamanlaması, çeşitlendirme ve "pump'ın tepesi nasıl anlaşılır" (protokol)

Sonuç görülmeden ve kod yazılmadan önce yazıldı, commit'lendi. Plan sonradan değişmez; ek fikir "EK"e tarihle.
Tüm bölümler aynı sinyal kümesi üzerindedir: `bt/out/v1/records.jsonl` içindeki v1k sinyalleri (soğuma sonrası 955 işlem),
aynı işlem tanımı (SHORT, giriş sinyalden sonraki ilk 1m açılış, stop +%50, 24 saat, masraf %0.10+%0.05, stopta +%0.20,
funding). "TABAN" = hedefsiz 24 saat; "O1" = TABAN + OI çıkışı (`docs/stop-ayir-protokol.md`). Dönemler: KEŞİF = sinyallerin
zaman sırasına göre ilk %60, DOĞRULAMA = son %40. Eşikler ve kesim noktaları YALNIZ KEŞİF'ten öğrenilir, DOĞRULAMA'da
değiştirilmez. Çoklu test: Benjamini-Hochberg q = 0.10. Hafta-kümeli bootstrap %90 aralığı (5.–95.).

## A. Rejim (hangi yıllar neden çalışıyor)
Sinyal anında bilinen 5 rejim değişkeni: **btc7d** (BTCUSDT 7 günlük kapanış değişimi %), **btc24** (zaten sinyalde),
**yoğunluk** (aynı 24 saatte, sinyalden önceki 24 saatte v1-aday listesinde (`bt/out/v1/scan`) kaç farklı coin alarm verdi),
**fonlama** (sinyal anındaki son funding oranı %), **btcAralık** (BTC'nin son 24 saatlik (yüksek−düşük)/kapanış %).
Her değişken için: KEŞİF medyanı kesim noktasıdır; iki yarının (≤ medyan, > medyan) KEŞİF ortalaması hesaplanır; KEŞİF'te
daha iyi çıkan yarı "iyi rejim"dir. Kural: yalnız iyi rejimde işlem al. DOĞRULAMA'da bu kuralın n, ortalaması, TABAN'a farkı
ve günde en çok 2 kuralıyla takipçi hesabı raporlanır. Ayrıca yıl yıl her değişkenin ortalaması ve TABAN getirisiyle ilişkisi
(sıra korelasyonu). **Geçme şartı:** DOĞRULAMA n ≥ 100, ortalama ≥ TABAN + 0.3 puan, günde en çok 2 ile getiri > 0 ve
BH düzeltmesinden geçmesi (5 kural).

## B. Giriş zamanlaması (7 hücre, sabit)
Stop her hücrede sinyal fiyatı × 1.5'tir (tüm parçalar için aynı fiyat); süre sinyalden 24 saat; masraf parça başına.
- E0 TABAN: sinyalden sonraki ilk 1m açılışta tam giriş.
- E1 dönüş onayı: sinyalden sonra 2 saat içinde ilk "kırmızı" 15m mumun (kapanış < açılış) kapanışından sonraki 1m açılışta
  giriş; olmazsa işlem yok.
- E2 / E3 / E4 limit: giriş fiyatı sinyal fiyatının %3 / %5 / %8 ÜSTÜNDE limit (SHORT için); 2 saat geçerli; bir 1m mumun en
  yükseği limit fiyatına değerse dolar; dolmazsa işlem yok.
- E5 kademeli: yarısı sinyalde (E0 gibi), yarısı %5 üstünde limit (2 saat).
- E6 kademeli: üçte biri sinyalde, üçte biri %5, üçte biri %10 üstünde limit (2 saat).
Karşılaştırma ölçüsü: **aday sinyal başına toplam getiri** (dolmayan işlem 0 sayılır; yani "yakalanan para") ve ayrıca
dolan işlem başına ortalama. **Geçme şartı:** DOĞRULAMA'da aday sinyal başına ortalama ≥ E0 + 0.3 puan VE dolan işlem sayısı ≥ 100.

## C. Boyut ve çeşitlendirme
Takipçi hesabı (1000 $, işlem başına bakiyenin %5'i, 1x): sınırsız / aynı anda en çok 3 / günde en çok 2 / ikisi birden,
TABAN ve O1 için; sinyallerin günlük kümelenme istatistiği; v1k ile G1-D (`bt/out/analiz-trades.json`, dürüst sürüm, stop yok)
akışlarının günlük net getiri korelasyonu ve birleşik hesap (iki akışı yan yana, her sinyal %5, ortak kısıt: aynı anda en çok
3 açık). **Betimleyici, geçme/kalma yok;** sayılar olduğu gibi yazılır.

## D. Pump anatomisi ve "tepe" ayrımı
1. **Etiket (yalnız sinyalden SONRAKİ fiyat):** girişten sonra 24 saat içinde fiyatın önce −%10'a mı (TEPE: pump bitti) yoksa
   önce +%10'a mı (DEVAM: pump sürüyor) değdiği (1m yolundan, ilk dokunan; aynı mumda ikisi varsa DEVAM). İkisine de değmeyen
   işlemler etiketsizdir ve AUC'ten çıkarılır, sayıları yazılır.
2. **Çok zaman dilimli özellikler (yalnız sinyal anından ÖNCE kapanmış mumlarla):** zaman dilimleri 1m, 3m, 5m, 10m, 15m, 30m,
   45m, 1h, 2h, 4h (1m'den 15m'ye kadar olanlar 1m verisinden, 30m ve üstü 15m verisinden birleştirilir; her biri için "son
   kapanmış mum"). Her zaman dilimi için: **r** (mum getirisi %), **fitil** (üst fitil / mum aralığı), **cvd** (o mumda Σ(2·takerBuyQuote
   − quote) / Σquote), **rsi** (Wilder RSI(14), o zaman diliminin kapanmışları), **uzaklık** (kapanışın o zaman diliminin EMA(20)'sine
   uzaklığı %). 10 zaman dilimi × 5 özellik = 50 özellik.
3. **"Ne değişti" özellikleri (sinyal anı):** son 15 dakikalık CVD'nin önceki 45 dakikalık CVD'ye farkı (alıcı çekildi mi), son
   15 dk hacmin önceki 8×15 dk ortalamasına oranı, son 15 dk ve son 1 saatlik OI değişimi %, taker oranı (son 1 saat), fonlama.
   Toplam 6 özellik.
4. **Ölçüm:** her özellik için TEPE (pozitif) ↔ DEVAM AUC'si, KEŞİF ve DOĞRULAMA ayrı; her ikisinde de AUC > 0.55 ya da < 0.45
   (aynı yönde) olan ve BH'den geçen özellikler "ayırıcı" sayılır. Ayrıca "tipik anatomi" tablosu: TEPE ve DEVAM için özelliklerin
   ortancası.
5. **Filtre testi:** KEŞİF'te en güçlü (BH'den geçen, her iki dönemde aynı yönde) en çok 3 ayırıcı özellikten, işareti AUC yönünde
   z-skor toplamı bir puan olur (ortalama ve sapma KEŞİF'ten). Eşik = KEŞİF puanlarının medyanı. Kural: puanı medyanın TEPE
   yönünde olan sinyalleri al. DOĞRULAMA'da TABAN ve O1 için n, ortalama, TABAN'a fark, günde en çok 2 ile getiri. **Geçme şartı:**
   DOĞRULAMA n ≥ 100, ortalama ≥ TABAN + 0.5 puan, günde en çok 2 ile getiri > 0. Ayırıcı özellik bulunamazsa: "tepeyi
   ayıran bir şey bulunamadı" yazılır ve filtre denenmez.

## E. Karar
Bir bölümün kuralı ancak kendi geçme şartını sağlarsa "gölgede denenebilir" olur; hiçbiri doğrudan yayına alınmaz, hepsi
30 canlı kâğıt sinyalle doğrulanır. Geçmeyenler aynı açıklıkla yazılır.

## F. Çıktı
`bot/docs/v1k-arge-rapor.md`, betik `bot/bt/v1/arge.js`. Sonda tek satır: "ya bulduk ya bulamadık" özeti ve (varsa) seçilen kural
için 1000 $, %5, 1x, günde en çok 2 ile ayda beklenen $ ve en kötü ay $.

## EK
(boş)
