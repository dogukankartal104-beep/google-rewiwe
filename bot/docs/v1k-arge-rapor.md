# v1k: rejim, giriş zamanlaması, çeşitlendirme ve pump tepesi raporu

Oluşturuldu: 2026-11-04T12:39:07.938Z · protokol: `docs/v1k-arge-protokol.md` (sonuçlardan önce commit'lendi).

Kapsam: v1k sinyali 955, özellikleri çıkarılamayan 0; KEŞİF 573, DOĞRULAMA 382 (bölme 2026-03-02). Finora kanalı yerine Binance ikizi.

TABAN: KEŞİF ort -0.04 (n=573), DOĞRULAMA ort 3.01 (n=382). Tüm sayılar net %, masraf ve funding dahil.

## A. Rejim

Yıl yıl: TABAN ortalaması (n) ve rejim değişkenlerinin ortancası

| yıl | TABAN ort (n) | btc7d | btc24 | density | fund | btcRange |
|---|---|---|---|---|---|---|
| 2022 | -3.55 (27) | -3.11 | -2.08 | 5.00 | -0.01 | 5.11 |
| 2023 | 14.01 (16) | -0.92 | -1.72 | 6.50 | -0.03 | 3.33 |
| 2024 | -4.57 (50) | 1.95 | -1.87 | 12.50 | 0.01 | 4.72 |
| 2025 | -0.46 (396) | -5.75 | -2.08 | 20.00 | 0.01 | 4.03 |
| 2026 | 3.03 (466) | -1.74 | -1.85 | 18.00 | 0.01 | 3.60 |

Her değişkenin tek tek işlem getirisiyle sıra korelasyonu (tüm dönem): btc7d -0.015 · btc24 -0.010 · density 0.119 · fund 0.078 · btcRange 0.011

| kural (yalnız iyi rejimde al) | KEŞİF: ≤ medyan / > medyan ort | seçilen yarı | DOĞRULAMA n | DOĞRULAMA ort | TABAN'a fark | günde en çok 2: getiri % | p (alt. fark > 0) |
|---|---|---|---|---|---|---|---|
| btc7d ≤ -4.41 ise atla (yani > medyan) | -0.38 / 0.30 | > medyan | 280 | 2.42 | -0.59 | 9 | 0.627 |
| btc24 ≤ -2.07 ise atla (yani > medyan) | -0.74 / 0.67 | > medyan | 241 | 2.49 | -0.52 | 3 | 0.596 |
| density ≤ 17.00 ise atla (yani > medyan) | -3.11 / 3.53 | > medyan | 214 | 5.02 | 2.01 | 27 | 0.206 |
| fund ≤ 0.01 ise atla (yani > medyan) | -0.55 / 0.79 | > medyan | 154 | 5.07 | 2.06 | 31 | 0.256 |
| btcRange ≤ 4.12 ise al (yani ≤ medyan) | 0.22 / -0.30 | ≤ medyan | 260 | 3.32 | 0.31 | 19 | 0.481 |

Geçme şartı (DOĞRULAMA n ≥ 100, TABAN'dan ≥ +0.3, günde en çok 2 getiri > 0, BH): btc7d: geçmedi · btc24: geçmedi · density: geçmedi · fund: geçmedi · btcRange: geçmedi

## B. Giriş zamanlaması

"Aday başına ort" = dolmayan işlem 0 sayılır (yakalanan para); "dolan başına" yalnız dolanların ortalaması. KEŞİF / DOĞRULAMA.

| hücre | KEŞİF aday başına | DOĞRULAMA aday başına | DOĞRULAMA dolan başına (n dolan) | DOĞRULAMA − E0 | günde en çok 2: getiri % | sonuç |
|---|---|---|---|---|---|---|
| E0 | -0.04 | 3.01 | 3.01 (382) | 0.00 | 16 | taban |
| E1 | -0.06 | 3.87 | 3.87 (382) | 0.86 | 30 | GEÇTİ |
| E2 | 0.84 | 1.78 | 2.36 (289) | -1.23 | 31 | geçmedi |
| E3 | 0.12 | 1.57 | 2.39 (251) | -1.44 | 28 | geçmedi |
| E4 | 0.64 | 1.43 | 2.87 (191) | -1.58 | 31 | geçmedi |
| E5 | 0.04 | 2.29 | 2.29 (382) | -0.72 | 15 | geçmedi |
| E6 | 0.08 | 1.93 | 1.93 (382) | -1.08 | 11 | geçmedi |

## C. Boyut ve çeşitlendirme (betimleyici)

Sinyalli gün 320; günlük sinyal ortanca 2, en çok 23, 3+ olan günlerin oranı 36%.

| kural (1x, %5, DOĞRULAMA) | akış | alınan | bakiye $ | getiri % | en büyük düşüş % | en uzun kayıp | ayda beklenen $ | en kötü ay $ |
|---|---|---|---|---|---|---|---|---|
| sınırsız | TABAN | 382 | 1673 | 67 | -23.6 | 10 | 83.5 | -144.4 |
| sınırsız | O1 | 382 | 1956 | 96 | -23.4 | 10 | 118.7 | -136.1 |
| aynı anda en çok 3 | TABAN | 221 | 1351 | 35 | -22.2 | 7 | 43.9 | -159.0 |
| aynı anda en çok 3 | O1 | 227 | 1732 | 73 | -20.9 | 7 | 91.5 | -144.7 |
| günde en çok 2 | TABAN | 188 | 1157 | 16 | -17.6 | 5 | 19.2 | -148.4 |
| günde en çok 2 | O1 | 188 | 1261 | 26 | -17.0 | 5 | 32.2 | -156.5 |
| ikisi birden | TABAN | 178 | 1124 | 12 | -17.7 | 7 | 15.1 | -149.9 |
| ikisi birden | O1 | 178 | 1289 | 29 | -16.7 | 5 | 35.8 | -139.7 |

v1k (O1) ile G1-D akışları (DOĞRULAMA dönemi, n=382 ve 436): günlük net getiri korelasyonu -0.006 (197 gün).
Aynı anda en çok 3 açık ile bakiye: yalnız v1k-O1 1732 (düşüş -20.9%), yalnız G1-D 1023 (düşüş -22.9%), ikisi birden 1567 (düşüş -16.8%, ayda beklenen 62.9 $, en kötü ay -132.5 $).

## D. Pump anatomisi ve tepe ayrımı

Etiket (ilk dokunan: −%10 = TEPE, +%10 = DEVAM): KEŞİF TEPE 279, DEVAM 291, etiketsiz 3; DOĞRULAMA TEPE 181, DEVAM 198, etiketsiz 3.

AUC: olumlu sınıf = TEPE (fiyat önce −%10 gitti). 0.5 = ayırmaz; > 0.5 = özellik yüksekken TEPE daha olası. BH, KEŞİF p-değerleri üzerinde (q=0.10).

| özellik | KEŞİF AUC | DOĞRULAMA AUC | BH | iki dönemde aynı yönde (>0.55 / <0.45) | ayırıcı | ortanca TEPE | ortanca DEVAM |
|---|---|---|---|---|---|---|---|
| oi15 | 0.420 | 0.367 | evet | evet | **evet** | 5.36 | 6.73 |
| volRatio | 0.551 | 0.509 | hayır | hayır | hayır | 2.18 | 1.85 |
| 5m.rsi | 0.549 | 0.492 | hayır | hayır | hayır | 70.94 | 69.34 |
| 3m.wick | 0.546 | 0.476 | hayır | hayır | hayır | 0.30 | 0.25 |
| 5m.dist | 0.543 | 0.496 | hayır | hayır | hayır | 7.61 | 6.72 |
| 3m.dist | 0.542 | 0.506 | hayır | hayır | hayır | 6.06 | 5.44 |
| 2h.dist | 0.458 | 0.464 | hayır | hayır | hayır | 25.30 | 27.03 |
| 3m.rsi | 0.542 | 0.498 | hayır | hayır | hayır | 71.67 | 69.84 |
| 10m.rsi | 0.541 | 0.478 | hayır | hayır | hayır | 71.03 | 67.79 |
| 30m.r | 0.540 | 0.532 | hayır | hayır | hayır | 5.47 | 4.33 |
| 15m.rsi | 0.540 | 0.451 | hayır | hayır | hayır | 72.25 | 70.47 |
| 1h.wick | 0.461 | 0.493 | hayır | hayır | hayır | 0.20 | 0.22 |
| taker | 0.462 | 0.441 | hayır | hayır | hayır | 1.05 | 1.06 |
| 10m.cvd | 0.464 | 0.445 | hayır | hayır | hayır | 0.05 | 0.06 |
| 2h.rsi | 0.465 | 0.447 | hayır | hayır | hayır | 74.06 | 76.03 |
| 15m.dist | 0.533 | 0.477 | hayır | hayır | hayır | 11.13 | 10.53 |
| 10m.dist | 0.531 | 0.489 | hayır | hayır | hayır | 8.62 | 8.19 |
| 1h.r | 0.531 | 0.512 | hayır | hayır | hayır | 4.50 | 3.91 |
| 2h.cvd | 0.470 | 0.423 | hayır | hayır | hayır | 0.01 | 0.01 |
| 2h.wick | 0.471 | 0.510 | hayır | hayır | hayır | 0.22 | 0.23 |
| 15m.cvd | 0.471 | 0.469 | hayır | hayır | hayır | 0.06 | 0.06 |
| 5m.cvd | 0.472 | 0.496 | hayır | hayır | hayır | 0.05 | 0.05 |
| 30m.wick | 0.472 | 0.514 | hayır | hayır | hayır | 0.17 | 0.19 |
| 30m.cvd | 0.525 | 0.498 | hayır | hayır | hayır | 0.03 | 0.03 |
| 1h.dist | 0.478 | 0.447 | hayır | hayır | hayır | 19.10 | 19.76 |

(56 özelliğin en güçlü 25'i; tümü `bt/out/v1/arge.jsonl` içinde.) Ayırıcı sayısı: 1.

Filtre: puan = −oi15 (z-skor toplamı), eşik = KEŞİF medyanı 0.122; puanı eşiğin üstünde olanlar (TEPE yönü) alınır.

| akış | DOĞRULAMA n | ort | TABAN'a fark | günde en çok 2 getiri % | düşüş % |
|---|---|---|---|---|---|
| TABAN filtreli | 211 | 5.51 | 2.50 | 43 | -13.9 | GEÇTİ |
| O1 filtreli | 211 | 6.11 | 2.31 | 50 | -14.9 | GEÇTİ |

## Özet

- A rejim: geçen kural yok.
- B giriş: E1.
- D tepe ayrımı: oi15 ayırıcı bulundu.

