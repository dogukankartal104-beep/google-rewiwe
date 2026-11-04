# Analiz raporu: 3 aday sinyal motoru

Oluşturuldu: 2026-11-04T11:32:38.726Z · protokol: `docs/analiz-protokol.md` (sonuçlardan önce commit'lendi) · veri: Binance halka açık arşivi · tüm rakamlar kendi ölçümümüz, başka projenin rakamlarına güvenilmedi.

## Kapsam

- Evren: 923 USDT vadeli sembolü (delist dahil); 15m verisi bulunan: 920. Dönem: 2022-01-01 → 2026-11-02.
- İndirmeler: 5219 yeni, 14234 önbellekten, arşivde olmayan 9027, hata 0.
- v1k: 3901 aday (en gevşek eşik), 1m yolu çıkarılamayan 5 (path ends before exit: 5).
- G1: 34703 aday, hacim sıralamasında ilk 50 olan ve simüle edilen 8587, 1m yolu çıkarılamayan 23 (no entry candle: 9, path ends before exit: 14).
- Tarama hataları: yok.

### MOTOR 1 · v1k aşırı pump SHORT

Kural: 15m ≥ +%4, 24s ≥ +%50, BTC 24s ≤ −%1, 24s hacim ≥ 1M $; SHORT, stop +%50, 24 saat, 4 saat soğuma.
n (tüm dönemler) = 955

#### 1. Yeniden üretim

| grup | n | ort % | ortanca % | kazanma | %90 aralık | en iyi 5 hariç | en kötü % |
|---|---|---|---|---|---|---|---|
| tüm dönemler | 955 | 1.18 | 7.98 | 60% | -0.89 … 3.35 | 0.72 | -62.4 |
| DOĞRULAMA+SON | 912 | 1.10 | 7.78 | 60% | -1.07 … 3.34 | 0.61 | -62.4 |

İddia: n 67, ort +9.55%, ortanca +14.1%, kazanma %64 (sonradan seçilmiş hücre).
Fark yorumu aşağıdaki tablodan okunur: dönem, evren (delist dahil) ve masraf (%0.15 + stopta %0.20 + funding) iddiadan farklı olabilir; ızgaradan sonradan seçilmiş bir hücrede iyimser sapma beklenir.

#### 2. Dönem kırılımı

| grup | n | ort % | ortanca % | kazanma | %90 aralık | en iyi 5 hariç | en kötü % |
|---|---|---|---|---|---|---|---|
| KESIF | 43 | 2.99 | 11.53 | 63% | -4.40 … 11.07 | -1.96 | -52.4 |
| DOGRULAMA | 446 | -0.92 | 6.75 | 58% | -4.68 … 2.53 | -1.61 | -62.4 |
| SON | 466 | 3.03 | 8.86 | 62% | 0.53 … 5.51 | 2.09 | -60.3 |
| 2022 | 27 | -3.55 | 10.63 | 56% | -13.99 … 6.53 | -12.53 | -52.4 |
| 2023 | 16 | 14.01 | 16.90 | 75% | 6.84 … 20.52 | 7.10 | -11.2 |
| 2024 | 50 | -4.57 | -1.05 | 44% | -9.81 … 0.64 | -8.11 | -60.4 |
| 2025 | 396 | -0.46 | 8.27 | 59% | -4.64 … 3.42 | -1.24 | -62.4 |
| 2026 | 466 | 3.03 | 8.86 | 62% | 0.53 … 5.51 | 2.09 | -60.3 |

Çeyrekler:

| grup | n | ort % | ortanca % | kazanma | %90 aralık | en iyi 5 hariç | en kötü % |
|---|---|---|---|---|---|---|---|
| 2022Ç1 | 3 | -4.60 | -8.02 | 33% | — … — | — | -20.3 |
| 2022Ç2 | 11 | 3.33 | 13.98 | 64% | -22.37 … 16.80 | -20.69 | -50.5 |
| 2022Ç3 | 1 | 26.63 | 26.63 | 100% | — … — | — | 26.6 |
| 2022Ç4 | 12 | -12.11 | -6.87 | 50% | -22.04 … -8.55 | -30.69 | -52.4 |
| 2023Ç1 | 2 | 4.60 | 4.60 | 100% | — … — | — | 3.6 |
| 2023Ç2 | 2 | -6.99 | -6.99 | 0% | — … — | — | -11.2 |
| 2023Ç3 | 4 | 25.61 | 28.50 | 100% | — … — | — | 8.4 |
| 2023Ç4 | 8 | 15.82 | 21.51 | 75% | 9.61 … 23.23 | 3.07 | -1.7 |
| 2024Ç1 | 22 | -4.96 | -1.86 | 41% | -14.32 … 4.90 | -11.15 | -54.4 |
| 2024Ç2 | 2 | 4.39 | 4.39 | 50% | — … — | — | -4.0 |
| 2024Ç3 | 2 | -24.00 | -24.00 | 50% | — … — | — | -60.4 |
| 2024Ç4 | 24 | -3.34 | -0.25 | 46% | -8.41 … 1.98 | -11.03 | -50.3 |
| 2025Ç1 | 35 | -8.83 | -6.71 | 43% | -18.35 … -1.45 | -15.21 | -59.3 |
| 2025Ç2 | 27 | -0.90 | 6.14 | 56% | -7.82 … 4.56 | -7.80 | -54.3 |
| 2025Ç3 | 70 | -5.74 | 3.51 | 54% | -13.65 … 2.91 | -8.81 | -62.4 |
| 2025Ç4 | 264 | 2.10 | 11.10 | 63% | -3.04 … 7.31 | 0.97 | -59.6 |
| 2026Ç1 | 125 | 0.36 | 6.22 | 58% | -4.27 … 6.00 | -2.81 | -60.3 |
| 2026Ç2 | 183 | 3.52 | 7.78 | 62% | 0.67 … 7.44 | 1.72 | -57.7 |
| 2026Ç3 | 113 | 1.59 | 8.79 | 59% | -4.61 … 7.26 | -1.60 | -56.8 |
| 2026Ç4 | 45 | 12.01 | 16.15 | 76% | 5.60 … 15.38 | 7.03 | -51.6 |

#### 3. Sağlamlık

DOĞRULAMA+SON (n=912): ortalama 1.10%, %90 aralık -1.07 … 3.34, en iyi 5 hariç 0.61%, en çok kâr eden günün toplam kârdaki payı 30% (≤ %20 beklenir).

#### 4. Plasebo ve piyasa fazlası (DOĞRULAMA+SON)

- 3 gün önceki aynı işlem (n=882): plasebo ort -3.87%, fark (sinyal − plasebo) 4.96%, %90 aralık 1.82 … 7.97
- 14 gün önceki aynı işlem (n=833): plasebo ort -1.78%, fark (sinyal − plasebo) 3.40%, %90 aralık 0.74 … 5.92
- Piyasa fazlası (işlem − aynı süredeki ilk-10 sepeti, saatlik çözünürlük; n=912): sepet ort -0.42%, fazla 1.52%, %90 aralık -0.41 … 3.44

#### 5. Eşik platosu (DOĞRULAMA+SON birleşik ortalama %, n)

| 24s \ BTC | −0.5 | −1 | −2 |
|---|---|---|---|
| ≥ 40% | 0.71 (n=1722) | 0.52 (n=1306) | -0.36 (n=694) |
| ≥ 50% | 1.01 (n=1195) | 1.10 (n=912) | 0.72 (n=477) |
| ≥ 60% | 1.06 (n=858) | 1.02 (n=659) | -0.09 (n=344) |

#### 6. Gecikme (DOĞRULAMA+SON ortalama %, n)

| gecikme | ort % | n |
|---|---|---|
| 0 dk | 1.10 | 912 |
| 5 dk | 1.24 | 912 |
| 15 dk | 1.57 | 912 |
| 30 dk | 1.16 | 912 |
| 60 dk | 1.30 | 909 |

Kenarın yarıya indiği ilk gecikme: 60 dk içinde inmiyor.

#### 7. Stop, kaldıraç ve takipçi hesabı (DOĞRULAMA+SON)

- 1x: tasfiye (stoptan önce ya da stop tasfiye seviyesinin ötesinde) 0/912 işlem
- 2x: tasfiye (stoptan önce ya da stop tasfiye seviyesinin ötesinde) 171/912 işlem
- 3x: tasfiye (stoptan önce ya da stop tasfiye seviyesinin ötesinde) 287/912 işlem

| hesap (1000 $, sinyal başına %5) | bakiye $ | getiri % | en büyük düşüş % | en uzun kayıp serisi | tasfiye |
|---|---|---|---|---|---|
| 1x | 1370 | 37 | -55.6 | 10 | 0 |
| 2x | 1564 | 56 | -81.6 | 10 | 171 |

#### 8. Eşzamanlılık

Sinyalli gün 320; günlük sinyal: ortanca 2, en çok 23, 3+ olan gün oranı 36%.

| kural (1x, %5) | alınan | bakiye $ | getiri % | en büyük düşüş % |
|---|---|---|---|---|
| sınırsız | 912 | 1370 | 37 | -55.6 |
| günde en çok 2 | 463 | 837 | -16 | -40.4 |
| aynı anda en çok 3 | 541 | 802 | -20 | -53.8 |
| ikisi birden | 451 | 803 | -20 | -41.2 |

#### 9. Kalabalık etkisi

24 saatlik hacim (milyon $) yüzdelikler: %10 50.4, %25 122.4, ortanca 343.7, %75 722.6 (n=912).
100 takipçi × 200 $ = 20.000 $: hacmin %0.1'ini aşan sinyal oranı 2%, %0.5'ini 0%, %1'ini 0%. Ortanca sinyalde giriş hacmin 0.06‰'i.
Hacmi 3M$ altı sinyaller (n=0): ortalama —%, kalanlar (n=912): 1.10%.

#### 10. Kayıp anatomisi

| coin | tarih | net % | çıkış | en kötü ters hareket % | 15m % | 24s % | BTC24 % | hacim M$ |
|---|---|---|---|---|---|---|---|---|
| MYXUSDT | 2025-08-05 | -62.4 | stop | 54.9 | 4.2 | 320.3 | -1.5 | 5047.9 |
| RAREUSDT | 2024-08-16 | -60.4 | stop | 51.7 | 8.3 | 54.2 | -2.1 | 651.2 |
| ESPUSDT | 2026-02-24 | -60.3 | stop | 50.0 | 20.5 | 52.8 | -3.4 | 512.2 |
| FOLKSUSDT | 2025-12-13 | -59.6 | stop | 50.0 | 5.9 | 58.9 | -2.5 | 192.7 |
| RAREUSDT | 2025-03-09 | -59.3 | stop | 50.7 | 8.9 | 50.7 | -4.3 | 592.1 |
| LABUSDT | 2026-06-01 | -57.7 | stop | 52.1 | 5.1 | 72.0 | -3.3 | 1926.0 |
| BULLAUSDT | 2026-01-31 | -57.6 | stop | 51.2 | 15.1 | 57.4 | -1.9 | 540.2 |
| TNSRUSDT | 2025-11-19 | -57.2 | stop | 55.4 | 4.0 | 123.0 | -1.7 | 547.8 |
| NFPUSDT | 2026-07-01 | -56.8 | stop | 56.5 | 19.3 | 75.0 | -1.2 | 55.5 |
| AIAUSDT | 2025-11-06 | -56.7 | stop | 51.7 | 15.2 | 232.8 | -1.7 | 737.8 |

En kötü 10'un giriş özelliklerinin geri kalanlara göre yüzdelik sırası (50 civarı = ayırt edilemiyor): 15m % 59, 24s % 53, BTC24 % 44, hacim M$ 64.
Filtre denenmedi (protokol 10).

#### Karar (protokol 4. bölüm)

| şart | sonuç | değer |
|---|---|---|
| DOĞRULAMA ort > 0 ve ortanca > 0 | TUTMADI | n=446 ort -0.92 ortanca 6.75 |
| SON ort > 0 ve ortanca > 0 | TUTTU | n=466 ort 3.03 ortanca 8.86 |
| DOĞRULAMA+SON %90 alt > 0 | TUTMADI | n=912 alt -1.07 |
| plasebo farkı > 0 (3 gün ve 14 gün) | TUTTU | 3g 4.96 · 14g 3.40 |
| 15 dk gecikmede ort > 0 | TUTTU | 1.57 |
| 1x en büyük düşüş ≤ %30 | TUTMADI | -55.6% |
| n ≥ 30 (DOĞRULAMA+SON) | TUTTU | n=912 |

**KARAR: BIRAK**

**Takipçi özeti (MOTOR 1 · v1k aşırı pump SHORT, 1x, sinyal başına %5, 1000 $, DOĞRULAMA+SON): ayda beklenen 10.6 $, en kötü ay -176.4 $** (35 ay; karar: BIRAK).

### MOTOR 3 · G1-S · stop yok

Kural: günlük kapanış ≤ −%10, o ayın (G1-S) / önceki ayın (G1-D) hacimce ilk 50 coini; ertesi gün açılışta LONG, 3 gün tut; stop: yok; sürüm: G1-S (ifade edildiği gibi, ileriye bakma içerir).
n (tüm dönemler) = 4253

#### 1. Yeniden üretim

| grup | n | ort % | ortanca % | kazanma | %90 aralık | en iyi 5 hariç | en kötü % |
|---|---|---|---|---|---|---|---|
| tüm dönemler | 4253 | 2.67 | -0.41 | 49% | 1.46 … 3.96 | 2.06 | -96.3 |
| DOĞRULAMA+SON | 2878 | 3.60 | -0.62 | 48% | 2.00 … 5.21 | 2.71 | -96.3 |

İddia: işlem başı +%1.76, 7 yılın 6'sında +, çöküş günlerinde birlikte kaybeder.
G1-S ay hacmini ay bitmeden bilmeyi gerektirir; yalnız yeniden üretim içindir, karar dürüst sürümle verilir.

#### 2. Dönem kırılımı

| grup | n | ort % | ortanca % | kazanma | %90 aralık | en iyi 5 hariç | en kötü % |
|---|---|---|---|---|---|---|---|
| KESIF | 1375 | 0.72 | -0.09 | 50% | -0.91 … 2.39 | 0.30 | -94.9 |
| DOGRULAMA | 2040 | 2.87 | -0.85 | 47% | 1.12 … 4.68 | 1.84 | -77.8 |
| SON | 838 | 5.36 | 0.07 | 50% | 1.92 … 8.98 | 3.23 | -96.3 |
| 2022 | 956 | 0.53 | -0.14 | 49% | -1.63 … 2.82 | -0.07 | -94.9 |
| 2023 | 419 | 1.14 | 0.09 | 50% | -0.27 … 2.56 | 0.40 | -42.4 |
| 2024 | 754 | 1.48 | -0.39 | 49% | -0.60 … 3.80 | 0.86 | -51.4 |
| 2025 | 1286 | 3.69 | -1.18 | 47% | 1.32 … 6.36 | 2.05 | -77.8 |
| 2026 | 838 | 5.36 | 0.07 | 50% | 1.92 … 8.98 | 3.23 | -96.3 |

Çeyrekler:

| grup | n | ort % | ortanca % | kazanma | %90 aralık | en iyi 5 hariç | en kötü % |
|---|---|---|---|---|---|---|---|
| 2022Ç1 | 153 | -4.01 | -5.19 | 29% | -5.55 … 0.42 | -5.45 | -31.9 |
| 2022Ç2 | 469 | 0.52 | 0.59 | 52% | -3.21 … 4.11 | -0.71 | -94.9 |
| 2022Ç3 | 164 | 5.23 | 2.75 | 64% | 0.21 … 11.55 | 3.79 | -46.3 |
| 2022Ç4 | 170 | 0.13 | -1.59 | 45% | -3.95 … 1.80 | -1.27 | -59.1 |
| 2023Ç1 | 117 | 2.89 | 1.52 | 54% | 0.76 … 6.07 | 0.92 | -24.4 |
| 2023Ç2 | 121 | -0.59 | -0.10 | 48% | -4.46 … 0.95 | -1.75 | -28.5 |
| 2023Ç3 | 75 | 1.96 | -0.33 | 49% | -3.39 … 5.16 | -1.12 | -32.0 |
| 2023Ç4 | 106 | 0.58 | -0.62 | 49% | -2.88 … 3.93 | -1.53 | -42.4 |
| 2024Ç1 | 142 | 2.31 | -0.93 | 43% | -1.96 … 7.63 | -0.12 | -35.7 |
| 2024Ç2 | 210 | -2.32 | -4.22 | 40% | -3.91 … 0.75 | -3.31 | -40.7 |
| 2024Ç3 | 169 | 2.48 | -0.29 | 50% | -4.04 … 8.32 | 1.22 | -51.4 |
| 2024Ç4 | 233 | 3.68 | 3.14 | 60% | 1.07 … 7.23 | 2.20 | -45.0 |
| 2025Ç1 | 426 | -1.39 | -3.20 | 41% | -4.13 … 1.44 | -2.24 | -42.6 |
| 2025Ç2 | 234 | 8.04 | 2.40 | 57% | 0.97 … 17.54 | 2.13 | -41.5 |
| 2025Ç3 | 220 | 1.26 | -1.61 | 43% | -1.88 … 4.88 | -1.60 | -63.0 |
| 2025Ç4 | 406 | 7.84 | -0.76 | 48% | 3.71 … 12.13 | 4.20 | -77.8 |
| 2026Ç1 | 267 | 4.19 | -0.05 | 50% | -1.04 … 9.29 | 2.01 | -66.1 |
| 2026Ç2 | 269 | 5.89 | 0.47 | 51% | 1.48 … 11.21 | 1.98 | -76.1 |
| 2026Ç3 | 251 | 7.18 | -0.29 | 49% | -0.74 … 16.27 | 0.52 | -96.3 |
| 2026Ç4 | 51 | -0.34 | 1.33 | 53% | -3.11 … 4.23 | -3.70 | -30.5 |

#### 3. Sağlamlık

DOĞRULAMA+SON (n=2878): ortalama 3.60%, %90 aralık 2.00 … 5.21, en iyi 5 hariç 2.71%, en çok kâr eden günün toplam kârdaki payı 8% (≤ %20 beklenir).

#### 4. Plasebo ve piyasa fazlası (DOĞRULAMA+SON)

- 3 gün önceki aynı işlem (n=2811): plasebo ort -10.11%, fark (sinyal − plasebo) 13.60%, %90 aralık 11.58 … 15.67
- 14 gün önceki aynı işlem (n=2555): plasebo ort 8.95%, fark (sinyal − plasebo) -5.16%, %90 aralık -8.50 … -2.11
- Piyasa fazlası (işlem − aynı süredeki ilk-10 sepeti, saatlik çözünürlük; n=2875): sepet ort 0.54%, fazla 3.07%, %90 aralık 1.69 … 4.46

#### 5. Eşik platosu (DOĞRULAMA+SON birleşik ortalama %, n)

| eşik | ort % (DOĞRULAMA+SON) | n |
|---|---|---|
| ≤ -8% | 3.02 | 4353 |
| ≤ -10% | 3.60 | 2878 |
| ≤ -12% | 4.45 | 1977 |

#### 6. Gecikme (DOĞRULAMA+SON ortalama %, n)

| gecikme | ort % | n |
|---|---|---|
| 0 dk | 3.60 | 2878 |
| 5 dk | 3.71 | 2878 |
| 15 dk | 3.76 | 2878 |
| 30 dk | 3.63 | 2877 |
| 60 dk | 3.71 | 2878 |

Kenarın yarıya indiği ilk gecikme: 60 dk içinde inmiyor.

#### 7. Stop, kaldıraç ve takipçi hesabı (DOĞRULAMA+SON)

- 1x: tasfiye (stoptan önce ya da stop tasfiye seviyesinin ötesinde) 0/2878 işlem
- 2x: tasfiye (stoptan önce ya da stop tasfiye seviyesinin ötesinde) 98/2878 işlem
- 3x: tasfiye (stoptan önce ya da stop tasfiye seviyesinin ötesinde) 302/2878 işlem

| hesap (1000 $, sinyal başına %5) | bakiye $ | getiri % | en büyük düşüş % | en uzun kayıp serisi | tasfiye |
|---|---|---|---|---|---|
| 1x | 62219 | 6122 | -50.5 | 31 | 0 |
| 2x | 312286 | 31129 | -78.6 | 31 | 98 |

#### 8. Eşzamanlılık

Sinyalli gün 995; günlük sinyal: ortanca 2, en çok 48, 3+ olan gün oranı 44%.

| kural (1x, %5) | alınan | bakiye $ | getiri % | en büyük düşüş % |
|---|---|---|---|---|
| sınırsız | 2878 | 62219 | 6122 | -50.5 |
| günde en çok 2 | 1223 | 3690 | 269 | -31.7 |
| aynı anda en çok 3 | 809 | 2398 | 140 | -29.9 |
| ikisi birden | 802 | 2644 | 164 | -26.9 |

#### 9. Kalabalık etkisi

24 saatlik hacim (milyon $) yüzdelikler: %10 56.8, %25 136.5, ortanca 285.2, %75 573.6 (n=2878).
100 takipçi × 200 $ = 20.000 $: hacmin %0.1'ini aşan sinyal oranı 3%, %0.5'ini 0%, %1'ini 0%. Ortanca sinyalde giriş hacmin 0.07‰'i.
Hacmi 3M$ altı sinyaller (n=1): ortalama -41.49%, kalanlar (n=2877): 3.61%.

#### 10. Kayıp anatomisi

| coin | tarih | net % | çıkış | en kötü ters hareket % | günlük % | sıra (D) |
|---|---|---|---|---|---|---|
| KORUUSDT | 2026-07-14 | -96.3 | time | 95.6 | -23.1 | 71.0 |
| LUNAUSDT | 2022-05-10 | -94.9 | time | 100.0 | -53.1 | 5.0 |
| LABUSDT | 2026-07-08 | -83.5 | time | 86.0 | -59.2 | 14.0 |
| BASUSDT | 2025-10-18 | -77.8 | time | 79.8 | -50.5 | 124.0 |
| BANKUSDT | 2026-07-28 | -76.5 | time | 84.1 | -10.4 | 247.0 |
| SIRENUSDT | 2026-04-01 | -76.1 | time | 76.1 | -67.1 | 21.0 |
| LUNAUSDT | 2022-05-08 | -73.8 | time | 80.6 | -11.8 | 5.0 |
| LABUSDT | 2026-07-11 | -72.1 | time | 76.8 | -21.9 | 14.0 |
| BTRUSDT | 2026-08-31 | -71.4 | time | 73.7 | -17.7 | 587.0 |
| VELVETUSDT | 2026-06-30 | -71.4 | time | 71.8 | -14.9 | 302.0 |

En kötü 10'un giriş özelliklerinin geri kalanlara göre yüzdelik sırası (50 civarı = ayırt edilemiyor): günlük % 25, sıra (D) 47.
Filtre denenmedi (protokol 10).

#### Karar (protokol 4. bölüm)

| şart | sonuç | değer |
|---|---|---|
| DOĞRULAMA ort > 0 ve ortanca > 0 | TUTMADI | n=2040 ort 2.87 ortanca -0.85 |
| SON ort > 0 ve ortanca > 0 | TUTTU | n=838 ort 5.36 ortanca 0.07 |
| DOĞRULAMA+SON %90 alt > 0 | TUTTU | n=2878 alt 2.00 |
| plasebo farkı > 0 (3 gün ve 14 gün) | TUTMADI | 3g 13.60 · 14g -5.16 |
| 15 dk gecikmede ort > 0 | TUTTU | 3.76 |
| 1x en büyük düşüş ≤ %30 | TUTMADI | -50.5% |
| n ≥ 30 (DOĞRULAMA+SON) | TUTTU | n=2878 |

**KARAR: GÖLGE**

**Takipçi özeti (MOTOR 3 · G1-S · stop yok, 1x, sinyal başına %5, 1000 $, DOĞRULAMA+SON): ayda beklenen 1749.1 $, en kötü ay -1520.1 $** (35 ay; karar: GÖLGE).

### MOTOR 3 · G1-D · stop yok

Kural: günlük kapanış ≤ −%10, o ayın (G1-S) / önceki ayın (G1-D) hacimce ilk 50 coini; ertesi gün açılışta LONG, 3 gün tut; stop: yok; sürüm: G1-D (dürüst).
n (tüm dönemler) = 3426

#### 1. Yeniden üretim

| grup | n | ort % | ortanca % | kazanma | %90 aralık | en iyi 5 hariç | en kötü % |
|---|---|---|---|---|---|---|---|
| tüm dönemler | 3426 | 0.86 | -0.18 | 49% | -0.18 … 1.95 | 0.50 | -94.9 |
| DOĞRULAMA+SON | 2223 | 1.06 | -0.37 | 49% | -0.35 … 2.47 | 0.52 | -83.5 |

İddia: işlem başı +%1.76, 7 yılın 6'sında +, çöküş günlerinde birlikte kaybeder.
Dürüst sürüm, sıralamayı yalnız önceki tam aydan alır.

#### 2. Dönem kırılımı

| grup | n | ort % | ortanca % | kazanma | %90 aralık | en iyi 5 hariç | en kötü % |
|---|---|---|---|---|---|---|---|
| KESIF | 1203 | 0.48 | -0.00 | 50% | -0.93 … 2.08 | 0.09 | -94.9 |
| DOGRULAMA | 1609 | 0.93 | -0.33 | 49% | -0.58 … 2.50 | 0.44 | -55.9 |
| SON | 614 | 1.41 | -0.44 | 48% | -1.56 … 4.26 | -0.35 | -83.5 |
| 2022 | 887 | 0.19 | -0.34 | 49% | -1.71 … 2.25 | -0.33 | -94.9 |
| 2023 | 316 | 1.29 | 0.63 | 53% | -0.38 … 3.21 | 0.54 | -33.0 |
| 2024 | 666 | 0.86 | -0.25 | 49% | -1.54 … 3.60 | 0.28 | -45.0 |
| 2025 | 943 | 0.99 | -0.46 | 49% | -0.98 … 3.00 | 0.18 | -55.9 |
| 2026 | 614 | 1.41 | -0.44 | 48% | -1.56 … 4.26 | -0.35 | -83.5 |

Çeyrekler:

| grup | n | ort % | ortanca % | kazanma | %90 aralık | en iyi 5 hariç | en kötü % |
|---|---|---|---|---|---|---|---|
| 2022Ç1 | 147 | -5.24 | -5.95 | 27% | -6.48 … -2.69 | -6.45 | -32.1 |
| 2022Ç2 | 436 | 0.53 | 0.99 | 53% | -2.68 … 3.67 | -0.50 | -94.9 |
| 2022Ç3 | 146 | 4.77 | 2.25 | 62% | 0.38 … 10.69 | 3.26 | -22.7 |
| 2022Ç4 | 158 | 0.09 | -1.49 | 45% | -3.92 … 1.85 | -1.10 | -59.1 |
| 2023Ç1 | 84 | 3.38 | 2.23 | 58% | 0.40 … 9.13 | 1.21 | -24.4 |
| 2023Ç2 | 114 | -1.08 | -1.06 | 45% | -5.44 … 0.63 | -2.15 | -22.5 |
| 2023Ç3 | 46 | 2.70 | 2.93 | 63% | -3.03 … 6.83 | -0.05 | -18.7 |
| 2023Ç4 | 72 | 1.70 | 2.10 | 54% | -2.28 … 5.33 | -0.57 | -33.0 |
| 2024Ç1 | 110 | 1.22 | -1.19 | 44% | -2.98 … 7.99 | -0.96 | -30.5 |
| 2024Ç2 | 168 | -2.92 | -4.09 | 37% | -3.91 … -0.05 | -3.68 | -31.6 |
| 2024Ç3 | 165 | 2.04 | -0.86 | 49% | -5.66 … 9.13 | 0.87 | -29.1 |
| 2024Ç4 | 223 | 2.64 | 3.14 | 61% | -0.80 … 7.02 | 1.30 | -45.0 |
| 2025Ç1 | 370 | -1.29 | -3.17 | 41% | -3.85 … 1.67 | -2.10 | -36.5 |
| 2025Ç2 | 180 | 3.76 | 3.26 | 60% | -1.09 … 7.61 | 2.32 | -25.4 |
| 2025Ç3 | 111 | -1.67 | -0.57 | 45% | -4.74 … 0.57 | -2.80 | -52.4 |
| 2025Ç4 | 282 | 3.26 | 1.20 | 52% | -0.74 … 6.77 | 0.59 | -55.9 |
| 2026Ç1 | 218 | 1.87 | -0.40 | 48% | -3.18 … 6.36 | -0.87 | -66.1 |
| 2026Ç2 | 178 | 2.02 | -1.41 | 46% | -3.62 … 9.06 | -2.42 | -76.1 |
| 2026Ç3 | 168 | 0.71 | 0.07 | 51% | -5.18 … 6.14 | -2.68 | -83.5 |
| 2026Ç4 | 50 | -0.45 | 1.29 | 52% | -6.03 … 4.43 | -3.22 | -63.7 |

#### 3. Sağlamlık

DOĞRULAMA+SON (n=2223): ortalama 1.06%, %90 aralık -0.35 … 2.47, en iyi 5 hariç 0.52%, en çok kâr eden günün toplam kârdaki payı 33% (≤ %20 beklenir).

#### 4. Plasebo ve piyasa fazlası (DOĞRULAMA+SON)

- 3 gün önceki aynı işlem (n=2220): plasebo ort -14.65%, fark (sinyal − plasebo) 15.75%, %90 aralık 13.96 … 17.50
- 14 gün önceki aynı işlem (n=2210): plasebo ort 3.22%, fark (sinyal − plasebo) -2.20%, %90 aralık -4.71 … 0.16
- Piyasa fazlası (işlem − aynı süredeki ilk-10 sepeti, saatlik çözünürlük; n=2220): sepet ort 0.42%, fazla 0.69%, %90 aralık -0.14 … 1.56

#### 5. Eşik platosu (DOĞRULAMA+SON birleşik ortalama %, n)

| eşik | ort % (DOĞRULAMA+SON) | n |
|---|---|---|
| ≤ -8% | 0.46 | 3635 |
| ≤ -10% | 1.06 | 2223 |
| ≤ -12% | 1.52 | 1405 |

#### 6. Gecikme (DOĞRULAMA+SON ortalama %, n)

| gecikme | ort % | n |
|---|---|---|
| 0 dk | 1.06 | 2223 |
| 5 dk | 1.20 | 2223 |
| 15 dk | 1.24 | 2223 |
| 30 dk | 1.07 | 2222 |
| 60 dk | 1.02 | 2223 |

Kenarın yarıya indiği ilk gecikme: 60 dk içinde inmiyor.

#### 7. Stop, kaldıraç ve takipçi hesabı (DOĞRULAMA+SON)

- 1x: tasfiye (stoptan önce ya da stop tasfiye seviyesinin ötesinde) 0/2223 işlem
- 2x: tasfiye (stoptan önce ya da stop tasfiye seviyesinin ötesinde) 42/2223 işlem
- 3x: tasfiye (stoptan önce ya da stop tasfiye seviyesinin ötesinde) 149/2223 işlem

| hesap (1000 $, sinyal başına %5) | bakiye $ | getiri % | en büyük düşüş % | en uzun kayıp serisi | tasfiye |
|---|---|---|---|---|---|
| 1x | 1947 | 95 | -50.2 | 38 | 0 |
| 2x | 1217 | 22 | -80.7 | 38 | 42 |

#### 8. Eşzamanlılık

Sinyalli gün 720; günlük sinyal: ortanca 2, en çok 47, 3+ olan gün oranı 39%.

| kural (1x, %5) | alınan | bakiye $ | getiri % | en büyük düşüş % |
|---|---|---|---|---|
| sınırsız | 2223 | 1947 | 95 | -50.2 |
| günde en çok 2 | 851 | 1182 | 18 | -24.3 |
| aynı anda en çok 3 | 633 | 842 | -16 | -32.7 |
| ikisi birden | 618 | 821 | -18 | -34.2 |

#### 9. Kalabalık etkisi

24 saatlik hacim (milyon $) yüzdelikler: %10 32.6, %25 88.9, ortanca 216.9, %75 492.7 (n=2223).
100 takipçi × 200 $ = 20.000 $: hacmin %0.1'ini aşan sinyal oranı 5%, %0.5'ini 0%, %1'ini 0%. Ortanca sinyalde giriş hacmin 0.09‰'i.
Hacmi 3M$ altı sinyaller (n=1): ortalama -9.83%, kalanlar (n=2222): 1.07%.

#### 10. Kayıp anatomisi

| coin | tarih | net % | çıkış | en kötü ters hareket % | günlük % | sıra (D) |
|---|---|---|---|---|---|---|
| LUNAUSDT | 2022-05-10 | -94.9 | time | 100.0 | -53.1 | 5.0 |
| LABUSDT | 2026-07-08 | -83.5 | time | 86.0 | -59.2 | 14.0 |
| SIRENUSDT | 2026-04-01 | -76.1 | time | 76.1 | -67.1 | 21.0 |
| LUNAUSDT | 2022-05-08 | -73.8 | time | 80.6 | -11.8 | 5.0 |
| LABUSDT | 2026-07-11 | -72.1 | time | 76.8 | -21.9 | 14.0 |
| BEATUSDT | 2026-06-15 | -66.3 | time | 71.9 | -29.0 | 42.0 |
| RIVERUSDT | 2026-01-30 | -66.1 | time | 76.6 | -12.4 | 39.0 |
| AKEUSDT | 2026-10-31 | -63.7 | time | 64.7 | -33.8 | 28.0 |
| LABUSDT | 2026-07-07 | -62.0 | time | 94.3 | -15.0 | 14.0 |
| SOLUSDT | 2022-11-07 | -59.1 | time | 71.1 | -11.6 | 6.0 |

En kötü 10'un giriş özelliklerinin geri kalanlara göre yüzdelik sırası (50 civarı = ayırt edilemiyor): günlük % 23, sıra (D) 35.
Filtre denenmedi (protokol 10).

#### Karar (protokol 4. bölüm)

| şart | sonuç | değer |
|---|---|---|
| DOĞRULAMA ort > 0 ve ortanca > 0 | TUTMADI | n=1609 ort 0.93 ortanca -0.33 |
| SON ort > 0 ve ortanca > 0 | TUTMADI | n=614 ort 1.41 ortanca -0.44 |
| DOĞRULAMA+SON %90 alt > 0 | TUTMADI | n=2223 alt -0.35 |
| plasebo farkı > 0 (3 gün ve 14 gün) | TUTMADI | 3g 15.75 · 14g -2.20 |
| 15 dk gecikmede ort > 0 | TUTTU | 1.24 |
| 1x en büyük düşüş ≤ %30 | TUTMADI | -50.2% |
| n ≥ 30 (DOĞRULAMA+SON) | TUTTU | n=2223 |

**KARAR: GÖLGE**

**Takipçi özeti (MOTOR 3 · G1-D · stop yok, 1x, sinyal başına %5, 1000 $, DOĞRULAMA+SON): ayda beklenen 27.1 $, en kötü ay -293.8 $** (35 ay; karar: GÖLGE).

### MOTOR 3 · G1-D · stop −%33

Kural: günlük kapanış ≤ −%10, o ayın (G1-S) / önceki ayın (G1-D) hacimce ilk 50 coini; ertesi gün açılışta LONG, 3 gün tut; stop: −%33; sürüm: G1-D (dürüst).
n (tüm dönemler) = 3426

#### 1. Yeniden üretim

| grup | n | ort % | ortanca % | kazanma | %90 aralık | en iyi 5 hariç | en kötü % |
|---|---|---|---|---|---|---|---|
| tüm dönemler | 3426 | 0.65 | -0.25 | 49% | -0.39 … 1.75 | 0.29 | -35.8 |
| DOĞRULAMA+SON | 2223 | 0.81 | -0.46 | 49% | -0.63 … 2.22 | 0.26 | -35.8 |

İddia: işlem başı +%1.76, 7 yılın 6'sında +, çöküş günlerinde birlikte kaybeder.
Dürüst sürüm, sıralamayı yalnız önceki tam aydan alır.

#### 2. Dönem kırılımı

| grup | n | ort % | ortanca % | kazanma | %90 aralık | en iyi 5 hariç | en kötü % |
|---|---|---|---|---|---|---|---|
| KESIF | 1203 | 0.36 | -0.01 | 50% | -1.06 … 2.00 | -0.03 | -33.4 |
| DOGRULAMA | 1609 | 0.58 | -0.37 | 49% | -1.03 … 2.28 | 0.09 | -35.8 |
| SON | 614 | 1.41 | -0.83 | 48% | -1.10 … 3.91 | -0.35 | -34.9 |
| 2022 | 887 | 0.02 | -0.34 | 49% | -1.92 … 2.12 | -0.50 | -33.4 |
| 2023 | 316 | 1.29 | 0.63 | 53% | -0.38 … 3.21 | 0.54 | -33.3 |
| 2024 | 666 | 0.51 | -0.25 | 49% | -2.13 … 3.47 | -0.07 | -33.6 |
| 2025 | 943 | 0.63 | -0.53 | 49% | -1.45 … 2.79 | -0.17 | -35.8 |
| 2026 | 614 | 1.41 | -0.83 | 48% | -1.10 … 3.91 | -0.35 | -34.9 |

Çeyrekler:

| grup | n | ort % | ortanca % | kazanma | %90 aralık | en iyi 5 hariç | en kötü % |
|---|---|---|---|---|---|---|---|
| 2022Ç1 | 147 | -5.36 | -5.95 | 27% | -6.55 … -2.76 | -6.58 | -33.4 |
| 2022Ç2 | 436 | 0.35 | 0.87 | 53% | -2.93 … 3.66 | -0.68 | -33.4 |
| 2022Ç3 | 146 | 4.77 | 2.25 | 62% | 0.38 … 10.69 | 3.26 | -22.7 |
| 2022Ç4 | 158 | -0.27 | -1.49 | 45% | -3.97 … 1.51 | -1.47 | -33.4 |
| 2023Ç1 | 84 | 3.38 | 2.23 | 58% | 0.40 … 9.13 | 1.21 | -24.4 |
| 2023Ç2 | 114 | -1.08 | -1.06 | 45% | -5.44 … 0.63 | -2.15 | -22.5 |
| 2023Ç3 | 46 | 2.70 | 2.93 | 63% | -3.03 … 6.83 | -0.05 | -18.7 |
| 2023Ç4 | 72 | 1.70 | 2.10 | 54% | -2.29 … 5.33 | -0.57 | -33.3 |
| 2024Ç1 | 110 | 1.10 | -1.19 | 44% | -3.15 … 7.99 | -1.09 | -33.4 |
| 2024Ç2 | 168 | -3.68 | -4.09 | 37% | -4.81 … -0.05 | -4.47 | -33.6 |
| 2024Ç3 | 165 | 1.47 | -0.86 | 49% | -7.15 … 9.06 | 0.28 | -33.4 |
| 2024Ç4 | 223 | 2.68 | 3.14 | 61% | -0.78 … 7.14 | 1.34 | -33.5 |
| 2025Ç1 | 370 | -2.16 | -3.22 | 41% | -5.01 … 1.11 | -2.98 | -33.4 |
| 2025Ç2 | 180 | 3.72 | 3.26 | 60% | -1.13 … 7.56 | 2.28 | -25.4 |
| 2025Ç3 | 111 | -1.40 | -0.57 | 45% | -3.98 … 0.65 | -2.52 | -33.4 |
| 2025Ç4 | 282 | 3.13 | 1.20 | 52% | -0.74 … 6.51 | 0.45 | -35.8 |
| 2026Ç1 | 218 | 1.95 | -0.83 | 47% | -2.53 … 5.96 | -0.78 | -34.4 |
| 2026Ç2 | 178 | 1.57 | -1.84 | 44% | -3.62 … 7.71 | -2.59 | -34.9 |
| 2026Ç3 | 168 | 0.95 | -0.25 | 50% | -3.23 … 5.48 | -2.12 | -33.6 |
| 2026Ç4 | 50 | -0.02 | 1.29 | 52% | -4.27 … 4.53 | -2.73 | -33.5 |

#### 3. Sağlamlık

DOĞRULAMA+SON (n=2223): ortalama 0.81%, %90 aralık -0.63 … 2.22, en iyi 5 hariç 0.26%, en çok kâr eden günün toplam kârdaki payı 43% (≤ %20 beklenir).

#### 4. Plasebo ve piyasa fazlası (DOĞRULAMA+SON)

- 3 gün önceki aynı işlem (n=2220): plasebo ort -14.65%, fark (sinyal − plasebo) 15.49%, %90 aralık 13.70 … 17.22
- 14 gün önceki aynı işlem (n=2210): plasebo ort 3.22%, fark (sinyal − plasebo) -2.45%, %90 aralık -4.90 … -0.17
- Piyasa fazlası (işlem − aynı süredeki ilk-10 sepeti, saatlik çözünürlük; n=2220): sepet ort 0.42%, fazla 0.42%, %90 aralık -0.37 … 1.25

#### 5. Eşik platosu (DOĞRULAMA+SON birleşik ortalama %, n)

| eşik | ort % (DOĞRULAMA+SON) | n |
|---|---|---|
| ≤ -8% | 0.18 | 3635 |
| ≤ -10% | 0.81 | 2223 |
| ≤ -12% | 1.36 | 1405 |

#### 6. Gecikme (DOĞRULAMA+SON ortalama %, n)

| gecikme | ort % | n |
|---|---|---|
| 0 dk | 0.81 | 2223 |
| 5 dk | 0.83 | 2223 |
| 15 dk | 0.99 | 2223 |
| 30 dk | 0.77 | 2222 |
| 60 dk | 0.75 | 2223 |

Kenarın yarıya indiği ilk gecikme: 60 dk içinde inmiyor.

#### 7. Stop, kaldıraç ve takipçi hesabı (DOĞRULAMA+SON)

- 1x: tasfiye (stoptan önce ya da stop tasfiye seviyesinin ötesinde) 0/2223 işlem
- 2x: tasfiye (stoptan önce ya da stop tasfiye seviyesinin ötesinde) 0/2223 işlem
- 3x: tasfiye (stoptan önce ya da stop tasfiye seviyesinin ötesinde) 149/2223 işlem

| hesap (1000 $, sinyal başına %5) | bakiye $ | getiri % | en büyük düşüş % | en uzun kayıp serisi | tasfiye |
|---|---|---|---|---|---|
| 1x | 1335 | 33 | -60.5 | 41 | 0 |
| 2x | 370 | -63 | -93.6 | 41 | 0 |

#### 8. Eşzamanlılık

Sinyalli gün 720; günlük sinyal: ortanca 2, en çok 47, 3+ olan gün oranı 39%.

| kural (1x, %5) | alınan | bakiye $ | getiri % | en büyük düşüş % |
|---|---|---|---|---|
| sınırsız | 2223 | 1335 | 33 | -60.5 |
| günde en çok 2 | 851 | 1189 | 19 | -24.5 |
| aynı anda en çok 3 | 651 | 814 | -19 | -35.7 |
| ikisi birden | 633 | 824 | -18 | -35.6 |

#### 9. Kalabalık etkisi

24 saatlik hacim (milyon $) yüzdelikler: %10 32.6, %25 88.9, ortanca 216.9, %75 492.7 (n=2223).
100 takipçi × 200 $ = 20.000 $: hacmin %0.1'ini aşan sinyal oranı 5%, %0.5'ini 0%, %1'ini 0%. Ortanca sinyalde giriş hacmin 0.09‰'i.
Hacmi 3M$ altı sinyaller (n=1): ortalama -33.36%, kalanlar (n=2222): 0.83%.

#### 10. Kayıp anatomisi

| coin | tarih | net % | çıkış | en kötü ters hareket % | günlük % | sıra (D) |
|---|---|---|---|---|---|---|
| AIAUSDT | 2025-11-15 | -35.8 | stop | 33.9 | -30.5 | 19.0 |
| AIAUSDT | 2025-11-16 | -35.1 | stop | 33.0 | -16.4 | 19.0 |
| PLAYUSDT | 2026-06-12 | -34.9 | stop | 34.4 | -26.3 | 35.0 |
| RIVERUSDT | 2026-01-30 | -34.4 | stop | 33.4 | -12.4 | 39.0 |
| RIVERUSDT | 2026-01-31 | -34.1 | stop | 33.1 | -18.1 | 39.0 |
| RIVERUSDT | 2026-01-29 | -34.0 | stop | 33.0 | -20.7 | 39.0 |
| AIAUSDT | 2025-11-18 | -33.9 | stop | 33.8 | -23.8 | 19.0 |
| BEATUSDT | 2026-01-06 | -33.8 | stop | 33.9 | -10.6 | 8.0 |
| AIAUSDT | 2025-11-13 | -33.7 | stop | 34.0 | -12.8 | 19.0 |
| CLOUSDT | 2026-02-05 | -33.7 | stop | 33.6 | -21.2 | 41.0 |

En kötü 10'un giriş özelliklerinin geri kalanlara göre yüzdelik sırası (50 civarı = ayırt edilemiyor): günlük % 27, sıra (D) 53.
Filtre denenmedi (protokol 10).

#### Karar (protokol 4. bölüm)

| şart | sonuç | değer |
|---|---|---|
| DOĞRULAMA ort > 0 ve ortanca > 0 | TUTMADI | n=1609 ort 0.58 ortanca -0.37 |
| SON ort > 0 ve ortanca > 0 | TUTMADI | n=614 ort 1.41 ortanca -0.83 |
| DOĞRULAMA+SON %90 alt > 0 | TUTMADI | n=2223 alt -0.63 |
| plasebo farkı > 0 (3 gün ve 14 gün) | TUTMADI | 3g 15.49 · 14g -2.45 |
| 15 dk gecikmede ort > 0 | TUTTU | 0.99 |
| 1x en büyük düşüş ≤ %30 | TUTMADI | -60.5% |
| n ≥ 30 (DOĞRULAMA+SON) | TUTTU | n=2223 |

**KARAR: GÖLGE**

**Takipçi özeti (MOTOR 3 · G1-D · stop −%33, 1x, sinyal başına %5, 1000 $, DOĞRULAMA+SON): ayda beklenen 9.6 $, en kötü ay -262.4 $** (35 ay; karar: GÖLGE).

## MOTOR 2 · Kilit açılışı SHORT

**ÖLÇÜLEMEDİ: veri kaynağına erişim yok.** Bu oturumun ağ ilkesi `api.llama.fi` (DefiLlama emisyon verisi) adresini engelliyor; bağlantı reddedildi. Uydurma ya da tahmini veri konmadı. Ölçmek için oturum ağ ayarında `api.llama.fi` (ve sembol eşlemesi için `coins.llama.fi`) izin verilmeli.

## Tek satır özet (takipçi: 1000 $, ayda beklenen $ ve en kötü ay $)

- MOTOR 1 · v1k aşırı pump SHORT: ayda 10.6 $, en kötü ay -176.4 $ → BIRAK
- MOTOR 3 · G1-S · stop yok: ayda 1749.1 $, en kötü ay -1520.1 $ → GÖLGE
- MOTOR 3 · G1-D · stop yok: ayda 27.1 $, en kötü ay -293.8 $ → GÖLGE
- MOTOR 3 · G1-D · stop −%33: ayda 9.6 $, en kötü ay -262.4 $ → GÖLGE
- MOTOR 2: ölçülemedi.

