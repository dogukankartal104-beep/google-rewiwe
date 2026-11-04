# v1 SHORT kuralı: TP1/TP2/TP3 kademeli kâr alma testi (protokol)

Bu dosya, tek bir sonuç görülmeden ve tek satır kod yazılmadan önce yazıldı ve commit'lendi. Plan sonradan
değiştirilmez. Ek fikir "EK" bölümüne tarihle yazılır ve karar kurallarını değiştiremez.

## 0. Sinyal kaynağı (dürüst not)
- Finora kanal geçmişi (`t.me/s/FinoraPumpMonitoring`) bu oturumun ağında erişilemiyor (bağlantı reddedildi).
  Bu yüzden ANA kaynak "ikiz": aynı kural Binance arşivinden üretilir. Kanalın gerçek alarmlarıyla
  eşleştirme yapılmadı; sonuçlar "Finora'nın kuralı" değil "kuralın ikizi" için geçerlidir ve raporda böyle yazılır.
- **v1 (ikiz):** 15m mum kapanışı önceki 15m kapanışa göre ≥ +%4 (pump alarmı) VE 24s değişim (96 mum önceki
  kapanışa göre) ≥ +%15 VE CVD15 < 0 VE CVD60 < 0 VE son 96×15m `quote_volume` toplamı ≥ 1M $ → SHORT.
  CVD = alarm anından ÖNCE kapanmış 1m mumlarda Σ(2·takerBuyQuoteVolume − quoteVolume), son 15 ve son 60 dakika.
  Coin başına 4 saat soğuma. Alarm anı = 15m mumunun kapanışı.
- **v1k kolu:** 15m ≥ +%4 VE 24s ≥ +%50 VE BTCUSDT 24s ≤ −%1 VE hacim ≥ 1M $ (CVD şartı yok). Aynı hücreler ayrı raporlanır.
- Evren: arşivde 1m/15m mumu olan bütün `*USDT` vadeliler (delist dahil).

## 1. Ölçüm kuralları
- İleriye bakma yok: karar yalnız alarm anından önce kapanmış mumlarla.
- Giriş: alarmdan sonraki ilk 1m mumun açılışı. Yol 1m mumlardan. Aynı mumda stop ve TP varsa önce stop.
- Hacmi 0 olan 1m mumlar stop/TP tetikleyemez. Alarm mumu hacimsiz ya da yüksek=düşük ise sinyal atılır.
- Masraf: her PARÇA için giriş+çıkış %0.10 + kayma %0.05; stopta çıkan her parça için ek %0.20; funding
  (gerçek `fundingRate`, parçanın açık kaldığı süre ve payı kadar; SHORT pozitif funding alır).
- Net getiri = parçaların ağırlıklı toplamı, toplam notional'ın yüzdesi.
- Stop: giriş × 1.50 (tüm kalan parçalar). Süre: girişten 24 saat sonra açılışta kalan her şey kapanır.
- TP fiyatı = giriş × (1 − x/100); bir parça, 1m mumun en düşüğü TP fiyatına ≤ ise o mumda dolar.
- (b) sürümlerinde TP1 dolduktan sonra stop girişe (başa baş) çekilir ve BİR SONRAKİ 1m mumdan itibaren geçerli olur
  (aynı mumda belirsizlik iyimser olmasın diye).

## 2. Hücreler (9, sabit, sonradan eklenmez)
| hücre | kural |
|---|---|
| TABAN | TP yok, 24 saatte kapat |
| T15 | tek hedef −%15, hepsi |
| T20 | tek hedef −%20, hepsi |
| M1a / M1b | TP1 −%5 (1/3), TP2 −%10 (1/3), TP3 −%20 (1/3) |
| M2a / M2b | TP1 −%8 (1/3), TP2 −%15 (1/3), TP3 −%25 (1/3) |
| M3a / M3b | TP1 −%10 (1/2), TP2 −%20 (1/4), kalan 1/4 24 saate kadar |
(a): stop yerinde kalır. (b): TP1'den sonra stop başa baş.

## 3. Dönemler
KEŞİF = sinyallerin zaman sırasına göre ilk %60'ı; DOĞRULAMA = son %40'ı. Ayrıca yıl yıl ve 2026 ayrı.

## 4. Her hücre için rapor
n, ortalama net %, ortanca, kazanma oranı, en kötü işlem, en kötü %10'un ortalaması, hafta-kümeli bootstrap
%90 aralığı (5.–95. yüzdelik), en iyi 5 hariç ortalama, TABAN'a göre fark (eşleştirilmiş) ve aralığı. Takipçi
benzetimi: 1000 $, sinyal başına bakiyenin %5'i, 1x → bakiye eğrisi, en büyük düşüş, en uzun kayıp serisi.
Gecikme: giriş 0 / 5 / 15 dk geç (stop girişe göre, 24 saat girişten). Her tabloda n.

## 5. Karar kuralı (sonuç görülmeden sabit)
1. TABAN DOĞRULAMA'da ortalama > 0 VE %90 aralığın alt ucu > 0 değilse: **"v1 bu kanalda kâr etmiyor"**; TP
   sonucu ne olursa olsun yayın yok.
2. Bir TP hücresi **ÖNERİLİR** ancak: DOĞRULAMA'da ortalama ≥ TABAN − 0.3 puan VE kazanma oranı ≥ TABAN + 5 puan
   VE en kötü %10'un ortalaması TABAN'dan daha iyi VE KEŞİF ile DOĞRULAMA'nın ikisinde de ortalama > 0.
3. Birden fazla hücre tutarsa en sade olan (en az TP seviyesi: T15/T20 = 1, M3 = 2, M1/M2 = 3; eşitlikte (a) sürümü)
   seçilir.
4. 9 hücre denendiği için şans payı vardır: seçilen hücre yayından önce 30 canlı kâğıt sinyalle doğrulanır.
5. İkiz ve v1k kolu ayrı ayrı karara bağlanır.

## 6. Çıktı
`bot/docs/v1-tp-rapor.md` (her hücre, kaybedenler ve geçmeyenler dahil) ve `bot/bt/v1/` altında betik. Sonda tek satır:
"1000 $, %5, 1x ile ayda beklenen $ ve en kötü ay $".

## EK
(boş)
