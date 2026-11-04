# v1k SHORT: daha sıkı stop, TP kademeleri ve işlem-içi göstergeler (protokol)

Sonuç görülmeden ve kod yazılmadan önce yazıldı ve commit'lendi. Plan sonradan değişmez; ek fikir "EK"e tarihle.

## 0. Neden ve uyarı
v1k kolunda (24s ≥ %50, BTC 24s ≤ −%1, 15m ≥ +%4, hacim ≥ 1M $) +%50 stop, kazananları kesmeden büyük kayıplar veriyor
(en kötü işlem −%62, kayıpların çoğu stopa giden %50). Soru: daha yakın bir stop (%20…) ve/veya kademeli kâr alma
ve/veya işlem-içi göstergelerle erken çıkış, toplam parayı artırır mı? Hedef TOPLAM PARA'dır (ortalama ve gerçekçi
hesap), kuyruk güzelleştirmek değil.
**Uyarı:** hücre sayısı çok olduğundan şans payı yüksektir. Bu yüzden: hücre seçimi KEŞİF'te, karar DOĞRULAMA'da, çoklu
test düzeltmesi var ve DOĞRULAMA yalnız son dönemi kapsar (tek rejim); bu da sınırlılık olarak raporlanır.

## 1. Taban ve veri
- Sinyal: `docs/analiz-protokol.md` MOTOR 1 (v1k) ile birebir aynı: 15m ≥ +%4, 24s ≥ +%50, BTC 24s ≤ −%1, 24s hacim ≥ 1M $,
  coin başına 4 saat soğuma; SHORT; giriş sinyalden sonraki ilk 1m açılışı; en çok 24 saat.
- Sinyal kümesi, `bt/out/v1/records.jsonl` içindeki v1k kayıtlarıdır (aynı küme; ilgisiz yeni sinyal eklenmez).
- Masraf: parça başına giriş+çıkış %0.10 + kayma %0.05, stopta ek %0.20, funding. Aynı mumda stop ve TP varsa stop.
  Hacmi 0 mumlar tetikleyemez. Kontroller yalnız 15m kapanışlarında, çıkış sonraki 1m açılışında (erken çıkışlar).
- Dönemler: KEŞİF = v1k sinyallerinin zaman sırasına göre ilk %60'ı, DOĞRULAMA = son %40'ı. Yıl yıl tablo da verilir.

## 2. Hücreler (sabit liste, sonradan eklenmez): 4 stop × 11 çıkış yapısı = 44 hücre
Stop (girişe göre yukarı): **%20, %30, %40, %50** (%50 = taban).
Çıkış yapısı:
| kod | kural |
|---|---|
| X0 | hedef yok, 24 saatte kapat |
| T15 / T20 | tek hedef −%15 / −%20, hepsi |
| M1a / M1b | TP1 −%5 (1/3), TP2 −%10 (1/3), TP3 −%20 (1/3); a: stop yerinde, b: TP1 sonrası stop başa baş |
| M2a / M2b | −%8, −%15, −%25 (her biri 1/3); a / b |
| M3a / M3b | −%10 (1/2), −%20 (1/4), kalan 1/4 24 saate kadar; a / b |
| O1 | ΔOI ≥ +%60 VE fiyat girişe göre ≥ +%15 → hepsini kapat (15m kapanışında) |
| L1 | genel long/short oranı girişten bu yana ≤ −%15 VE fiyat ≥ +%15 → hepsini kapat |
Tanımlar `docs/stop-ayir-protokol.md` bölüm 2 ile aynıdır (OI = `sum_open_interest_value`, L/S = `count_long_short_ratio`).
Başka göstergeler (RSI, EMA, giriş onayı) bu protokolde YOKTUR; denenmek istenirse ayrı protokol olur.

## 3. Rapor
Her hücre için: n, ortalama net %, ortanca, kazanma, en kötü işlem, en kötü %10 ortalaması, hafta-kümeli bootstrap
%90 aralığı (5.–95.), TABAN'a (stop %50, X0) göre fark ve aralığı. KEŞİF ve DOĞRULAMA ayrı. Takipçi benzetimi (1000 $,
sinyal başına %5, 1x): "sınırsız", "günde en çok 2" ve "aynı anda en çok 3" kurallarıyla bakiye, en büyük düşüş, en uzun
kayıp serisi, ayda beklenen ve en kötü ay. Seçilen hücre için yıl yıl ortalama ve gecikme 0/5/15 dk.

## 4. Seçim ve karar kuralı (sonuç görülmeden sabit)
1. KEŞİF'te ortalaması en yüksek 3 hücre adaydır (en az 200 işlemi tamamlamış hücreler; TABAN adaya girmez ama karşılaştırılır).
2. Aday **ÖNERİLİR** ancak DOĞRULAMA'da hepsi birden: ortalama > 0; ortalamanın %90 aralığının alt ucu > 0; ortalama
   TABAN'dan en az 0.3 puan yüksek; "günde en çok 2" kuralıyla takipçi hesabında getiri > 0 ve en büyük düşüş ≤ %30;
   15 dk gecikmede ortalama > 0; DOĞRULAMA'nın iki yarısında da ortalama > 0.
3. 44 hücrenin DOĞRULAMA'daki "TABAN'dan fark > 0" testleri Benjamini-Hochberg (q = 0.10) ile düzeltilir ve raporlanır;
   seçilen aday düzeltmeden de geçmiyorsa "şansa bağlı olabilir" diye işaretlenir.
4. Hiçbir aday tutmazsa: "stop/TP değişikliği v1k'yı iyileştirmiyor, taban kalır" yazılır.
5. Her durumda yayından önce 30 canlı kâğıt sinyalle doğrulama gerekir.

## 5. Çıktı
`bot/docs/v1k-stop-rapor.md` ve `bot/bt/v1/stopgrid.js`. Sonda tek satır: seçilen (ya da taban) hücre için "1000 $, %5, 1x,
günde en çok 2 ile ayda beklenen $ ve en kötü ay $".

## EK
(boş)
