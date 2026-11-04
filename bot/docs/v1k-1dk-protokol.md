# v1k: saate hizalı 15m kapanış yerine dakikalık kayan pencere (protokol)

Sonuç görülmeden ve kod yazılmadan önce yazıldı, commit'lendi. Plan sonradan değişmez; ek fikir "EK"e tarihle.

## Soru
Şimdiki kural pump'ı yalnız saate hizalı 15m mumun KAPANIŞINDA arıyor. Bir coin 14 dakika boyunca şartı sağlayıp 15m
kapanışında sağlamıyorsa sinyal kaçıyor. Dakikalık kayan pencere (her dakika "son 15 dakika") daha erken ve daha çok sinyal
verir. Ama daha erken giriş pump'ın henüz bitmediği anda girmek demek olabilir. Hangisi daha iyi?

## Kural R (kayan pencere), her 1m kapanışta t anında
- son 15 dakikalık getiri = kapanış(t) / kapanış(t−15 dk) − 1 ≥ +%4;
- 24 saatlik getiri = kapanış(t) / kapanış(t−1440 dk) − 1 ≥ +%50;
- BTCUSDT'nin aynı biçimde (1m kapanış, 1440 dk) 24s getirisi ≤ −%1;
- son 1440 dakikanın `quote_volume` toplamı ≥ 1.000.000 $; t mumunun hacmi > 0 ve yüksek ≠ düşük;
- coin başına 4 saat soğuma (ilk tetikleyen sinyal alınır, sonra 4 saat bekler).
Sinyal anı = t mumunun kapanışı; giriş sonraki 1m açılış. İşlem kuralları `v1k-motor-protokol.md` ile aynı: SHORT, stop = sinyal fiyatı
(giriş açılışı) × 1.5, 24 saat sonra çıkış, masraf %0.10 + %0.05, stopta +%0.20, funding, hacmi 0 mumlar tetikleyemez.
Kural C (karşılaştırma) = şu anki canlı kural: saate hizalı 15m kapanış, aynı eşikler, aynı işlem kuralları (`bt/out/v1/combo.jsonl`).

## Hücreler (3, sabit)
- R0: kural R, filtre yok. R1: R + filtre (son 15 dakikadaki OI artışı ≤ %6.01; OI = 5 dk `sum_open_interest_value`, t anındaki son kayıt / 15 dk
  önceki son kayıt). R2: R1 + OI çıkışı (O1, `stop-ayir-protokol.md`).
Karşılaştırma: C'nin K0, K1, K2 hücreleri (aynı tanımlar). Dönem: 2022-01 → bugün; KEŞİF/DOĞRULAMA bölmesi sabit tarihle,
2026-03-02 (C'nin zaman sırasına göre %60/%40 bölmesinin tarihi); her iki kural için aynı tarih kullanılır.
Veri: yalnız 24 saatlik getirisi ≥ +%45 olan 15m kapanışı bulunan coin-günleri için 1m mumlar (diğer günlerde kural R zaten tetiklenemez).

## Rapor
Her hücre ve K0/K1/K2: n, ortalama, ortanca, kazanma, en kötü, %90 aralık (hafta-kümeli), KEŞİF / DOĞRULAMA ayrı, 15 dk gecikme,
takipçi (1000 $, %5, 1x, günde en çok 2). Örtüşme: R sinyallerinin C ile ilişkisi: (a) C ile aynı an (15m kapanış dakikasında),
(b) C'den ÖNCE (aynı coin için sonraki 30 dakika içinde C de ateşledi), (c) C hiç ateşlemedi (kaçan sinyal). Her sınıfın n ve
ortalaması ayrı yazılır.

## Karar (sonuç görülmeden sabit)
R1 (ya da R2) C'nin K1'inin (ya da K2'sinin) YERİNE geçer ancak hepsi birden: DOĞRULAMA n ≥ 100; DOĞRULAMA ortalaması ≥ karşılaştırılan
C hücresi + 0.3 puan; %90 alt uç > 0; DOĞRULAMA'nın iki yarısında ortalama > 0; 15 dk gecikmede ortalama > 0; günde en çok 2 kuralıyla
takipçi getirisi > 0 ve düşüş ≤ %30; ayrıca "(c) kaçan sinyal" sınıfının DOĞRULAMA ortalaması > 0 (kaçanlar zarar getiriyorsa
yakalamanın anlamı yok). Aksi halde **saate hizalı kural kalır**. İki kural benzer çıkarsa (fark < 0.3) daha basit ve zaten
canlı olan C kalır.

## Çıktı
`bot/docs/v1k-1dk-rapor.md`, betik `bot/bt/v1/rolling.js`.

## EK
(boş)
