# v1k motoru: birleşik kuralın sınavı (protokol)

Sonuç görülmeden ve kod yazılmadan önce yazıldı, commit'lendi. Plan sonradan değişmez; ek fikir "EK"e tarihle.
Önceki protokollerde (`v1k-stop-protokol.md`, `v1k-arge-protokol.md`) ayrı ayrı iyi çıkan parçalar birlikte sınanır.

## 1. Sinyal kümesi ve parçalar
- Küme: `bt/out/v1/arge.jsonl` içindeki 955 v1k sinyali (aynı küme). KEŞİF = zaman sırasına göre ilk %60 (573), DOĞRULAMA = son %40 (382).
- **Filtre F:** sinyal anında son 15 dakikadaki OI artışı (`sum_open_interest_value`, 5 dk kayıtlar) ≤ **%6.01**. Bu eşik
  `v1k-arge-rapor.md` EK-1'de KEŞİF'ten türetilmiş olarak yazılıdır; burada DEĞİŞTİRİLMEZ. OI verisi yoksa sinyal atlanır ve sayılır.
- **Giriş E1:** sinyalden sonraki 2 saat içinde ilk kırmızı 15m mumun (kapanış < açılış) kapanışından sonraki 1m açılışta giriş;
  olmazsa işlem yok. E0 = sinyalden sonraki ilk 1m açılış.
- **Çıkış O1:** girişten bu yana ΔOI ≥ +%60 VE fiyat girişe göre ≥ +%15 olunca, 15m kapanışında kontrol, sonraki 1m açılışta hepsini kapat.
- Ortak işlem kuralları: SHORT; stop = sinyal fiyatı (E0 girişi) × 1.50, tüm parçalar için aynı fiyat; süre sinyalden 24 saat; masraf %0.10 giriş+çıkış +
  %0.05 kayma, stopta ek %0.20, funding; hacmi 0 mumlar tetikleyemez.

## 2. Hücreler (6, sabit)
| hücre | kural |
|---|---|
| K0 TABAN | E0, filtre yok, O1 yok |
| K1 | F + E0 |
| K2 | F + E0 + O1 |
| K3 | F + E1 |
| K4 MOTOR | F + E1 + O1 (tam kural) |
| K5 | E1 + O1 (filtresiz) |

## 3. Rapor
Her hücre: n (tamamlanan), ortalama, ortanca, kazanma, en kötü işlem, en kötü %10 ortalaması, hafta-kümeli bootstrap %90 aralığı (5.–95.),
K0'a fark, KEŞİF ve DOĞRULAMA ayrı, yıl yıl, giriş 0 / 15 dk geç. Takipçi (1000 $, %5, 1x): günde en çok 2 ve aynı anda en çok 3 kuralları,
bakiye, en büyük düşüş, en uzun kayıp serisi, ayda beklenen ve en kötü ay. İşlem başı ortalama net % ve 1000 $ hesapta işlem başı $.

## 4. Geçme şartı (sonuç görülmeden sabit)
Bir hücre (K1–K5) **GEÇER** ancak hepsi birden: DOĞRULAMA n ≥ 100; DOĞRULAMA ortalaması ≥ K0 + 0.5 puan; %90 aralığın alt ucu > 0;
DOĞRULAMA'nın iki yarısında da ortalama > 0; KEŞİF ortalaması ≥ K0'ın KEŞİF ortalaması; günde en çok 2 kuralıyla getiri > 0 ve en büyük düşüş ≤ %30;
15 dk gecikmede DOĞRULAMA ortalaması > 0. 5 hücrenin "K0'dan fark > 0" testleri Benjamini-Hochberg (q = 0.10) ile düzeltilir ve raporlanır.
Birden fazla hücre geçerse en sade olan (en az bileşen: K1 < K3 = K2 < K4) seçilir. **K4 (motor) geçmezse motor, gölge kayıtta tüm varyantlarıyla izlenir ama öneri olmaz.**
Hiçbir durumda doğrudan yayın yoktur: gölgede 30 canlı sinyal karnesi şarttır.

## 5. Çıktı
`bot/docs/v1k-motor-rapor.md`, betik `bot/bt/v1/combo.js`.

## EK
(boş)
