# EK: canlı OI filtresi eşiği 6,01 → 3,88 (2026-11-04)

Karar sahibi: işletme sahibi. Durum: **sonradan seçilmiş eşik, kanıtlanmış değil.**

- 3,88 değeri harici bir analizle (büyük bir arama sonrası) bulundu; biz sadece mevcut verimizle yön kontrolü yaptık.
- Bizim verimiz (K0 net, işlem başı %): filtresiz +1,18 (n tüm); ≤6,01 → n=497, +2,79 (%90 GA −0,27…+5,70); ≤3,88 → n=339, +3,91 (GA +0,85…+6,70); 2026 öncesi +2,39 (n=148, GA −1,94…+6,39); 2026 +5,09 (n=191).
- Harici katı %95 hafta-kümeli test geçilmedi (alt sınır −1,55). Yıllar: 2024 negatif, 2025 ≈0, 2026 pozitif.
- Canlıya alındı: `LIVE_FILTER_OI15 = 3.88` (shadow.js ve shadow2.js). Backtest betikleri tarihsel tekrarlanabilirlik için 6,01 (`FILTER_OI15`) ile kalır.
- Gözden geçirme kuralı: ~20–30 canlı kayıttan sonra filtreli sonuçlar buradaki beklentiyle (≈+3,9/işlem) karşılaştırılacak; belirgin sapmada eşik geri alınır. Mevcut `shouldPause` (son 10 filtreli K1 toplamı ≤ −30) devrede kalır.
