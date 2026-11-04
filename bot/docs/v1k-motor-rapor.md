# v1k motoru: birleşik kuralın sınavı

Oluşturuldu: 2026-11-04T12:52:16.813Z · protokol: `docs/v1k-motor-protokol.md` (sonuçlardan önce commit'lendi). Sinyaller Finora kuralının Binance ikizi değil, v1k kuralıdır (24s ≥ %50, BTC 24s ≤ −%1).

Kapsam: 955 sinyal, simülasyonu tamamlanamayan 0; KEŞİF 573, DOĞRULAMA 382 (bölme 2026-03-02). OI verisi olmayan sinyal sayısı: 0. Filtre eşiği: son 15 dk OI artışı ≤ %6.01.

## Hücreler

| hücre | KEŞİF n / ort | DOĞRULAMA n | ort | ortanca | kazanma | en kötü | en kötü %10 | %90 aralık | K0'a fark | $/işlem (1000 $, %5) |
|---|---|---|---|---|---|---|---|---|---|---|
| K0 (TABAN) | 573 / -0.04 | 382 | 3.01 | 9.06 | 62% | -57.7 | -51.65 | 0.34 … 5.82 | 0.00 | 1.51 |
| K1 | 286 / 0.77 | 211 | 5.51 | 11.54 | 65% | -57.7 | -51.58 | 0.84 … 10.27 | 2.50 | 2.76 |
| K2 | 286 / 1.10 | 211 | 6.11 | 11.54 | 65% | -57.7 | -51.10 | 1.55 … 10.74 | 3.10 | 3.06 |
| K3 | 286 / -0.84 | 211 | 5.96 | 10.44 | 65% | -77.9 | -51.89 | 1.20 … 10.80 | 2.95 | 2.98 |
| K4 (MOTOR) | 286 / -0.54 | 211 | 6.32 | 10.28 | 64% | -68.6 | -47.59 | 1.61 … 11.11 | 3.31 | 3.16 |
| K5 | 569 / 0.29 | 382 | 4.27 | 8.24 | 62% | -68.6 | -49.57 | 1.55 … 7.34 | 1.26 | 2.13 |

## Takipçi: 1000 $, işlem başına bakiyenin %5'i, 1x (DOĞRULAMA)

| hücre | kural | alınan | bakiye $ | getiri % | en büyük düşüş % | en uzun kayıp | ayda beklenen $ | en kötü ay $ |
|---|---|---|---|---|---|---|---|---|
| K0 | günde en çok 2 | 188 | 1157 | 16 | -17.6 | 5 | 19.2 | -148.4 |
| K0 | aynı anda en çok 3 | 221 | 1351 | 35 | -22.2 | 7 | 43.9 | -159.0 |
| K1 | günde en çok 2 | 130 | 1428 | 43 | -13.9 | 7 | 53.3 | -107.7 |
| K1 | aynı anda en çok 3 | 156 | 1546 | 55 | -10.1 | 5 | 68.1 | -66.7 |
| K2 | günde en çok 2 | 130 | 1496 | 50 | -14.9 | 7 | 61.8 | -104.0 |
| K2 | aynı anda en çok 3 | 157 | 1600 | 60 | -11.0 | 5 | 74.8 | -66.6 |
| K3 | günde en çok 2 | 133 | 1523 | 52 | -12.7 | 4 | 65.5 | -98.2 |
| K3 | aynı anda en çok 3 | 155 | 1610 | 61 | -9.7 | 5 | 76.4 | -74.9 |
| K4 | günde en çok 2 | 133 | 1623 | 62 | -13.7 | 4 | 78.0 | -96.2 |
| K4 | aynı anda en çok 3 | 156 | 1675 | 67 | -10.6 | 5 | 84.5 | -74.9 |
| K5 | günde en çok 2 | 189 | 1518 | 52 | -13.8 | 5 | 64.5 | -107.3 |
| K5 | aynı anda en çok 3 | 226 | 1735 | 73 | -17.5 | 7 | 91.8 | -110.8 |

## Yıl yıl ortalama % (n)

| hücre | 2022 | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|
| K0 | -3.55 (27) | 14.01 (16) | -4.57 (50) | -0.46 (396) | 3.03 (466) |
| K1 | 1.84 (12) | 7.29 (5) | -4.87 (20) | 0.98 (203) | 4.77 (257) |
| K2 | 2.17 (12) | 7.29 (5) | -4.44 (20) | 1.05 (203) | 5.51 (257) |
| K3 | 1.14 (12) | 5.75 (5) | -5.23 (20) | -0.61 (203) | 4.69 (257) |
| K4 | 2.51 (12) | 5.75 (5) | -4.78 (20) | -0.61 (203) | 5.21 (257) |
| K5 | -3.24 (27) | 12.04 (16) | -0.85 (50) | -0.49 (393) | 4.14 (465) |

## Geçme şartları (protokol 4. bölüm)

| hücre | n ≥ 100 | ort ≥ K0+0.5 | %90 alt > 0 | iki yarı > 0 | KEŞİF ≥ K0 KEŞİF | günde 2: getiri > 0 ve düşüş ≤ %30 | 15 dk gecikme > 0 | BH | sonuç |
|---|---|---|---|---|---|---|---|---|---|
| K1 | evet | evet (5.51 vs 3.01) | evet | evet (2.46/8.54) | evet (0.77 vs -0.04) | evet | evet (4.82) | hayır | **GEÇTİ** |
| K2 | evet | evet (6.11 vs 3.01) | evet | evet (3.33/8.87) | evet (1.10 vs -0.04) | evet | evet (5.39) | hayır | **GEÇTİ** |
| K3 | evet | evet (5.96 vs 3.01) | evet | evet (2.69/9.20) | hayır (-0.84 vs -0.04) | evet | evet (5.43) | hayır | geçmedi |
| K4 | evet | evet (6.32 vs 3.01) | evet | evet (3.48/9.13) | hayır (-0.54 vs -0.04) | evet | evet (5.96) | hayır | geçmedi |
| K5 | evet | evet (4.27 vs 3.01) | evet | evet (2.64/5.90) | evet (0.29 vs -0.04) | evet | evet (4.38) | hayır | **GEÇTİ** |

## Sonuç

**Geçen hücre(ler): K1, K2, K5; en sade: K1.** Yayından önce 30 canlı kâğıt sinyal karnesi şart. K4 (tam motor) geçmedi: motor gölgede izlenir, öneri olmaz.

Tek satır: K1 için 1000 $, %5, 1x, günde en çok 2 ile ayda beklenen 53.3 $, en kötü ay -107.7 $ (DOĞRULAMA, 8 ay); işlem başı ortalama net 5.51% (= 2.76 $ / işlem).

