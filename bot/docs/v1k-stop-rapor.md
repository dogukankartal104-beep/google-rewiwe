# v1k SHORT: daha sıkı stop, TP kademeleri ve işlem-içi göstergeler raporu

Oluşturuldu: 2026-11-04T12:19:08.581Z · protokol: `docs/v1k-stop-protokol.md` (sonuçlardan önce commit'lendi).

Kapsam: v1k sinyali 955, simülasyonu tamamlanamayan 0, bir hücrenin yolu eksik olduğu için dışarıda bırakılan 0; tablolar ortak kümede (n=955, KEŞİF 573, DOĞRULAMA 382; bölme tarihi 2026-03-02).
**Sınırlılık:** DOĞRULAMA yalnız son dönemi (tek rejim) kapsıyor. 44 hücre denendiği için şans payı yüksektir.

## Tüm hücreler (net %, masraf ve funding dahil)

| hücre | KEŞİF ort (n) | DOĞRULAMA ort (n) | DOĞRULAMA − TABAN | BH q=0.10 |
|---|---|---|---|---|
| S20|X0 | -0.20 (573) | 1.24 (382) | -1.77 | hayır |
| S20|T15 | -0.48 (573) | 0.08 (382) | -2.93 | hayır |
| S20|T20 | -0.20 (573) | 0.72 (382) | -2.29 | hayır |
| S20|M1a | -0.55 (573) | -0.26 (382) | -3.27 | hayır |
| S20|M1b | -0.53 (573) | -0.76 (382) | -3.77 | hayır |
| S20|M2a | -0.61 (573) | 0.08 (382) | -2.93 | hayır |
| S20|M2b | -0.82 (573) | -0.17 (382) | -3.18 | hayır |
| S20|M3a | -0.57 (573) | 0.33 (382) | -2.68 | hayır |
| S20|M3b | -0.73 (573) | -0.13 (382) | -3.14 | hayır |
| S20|O1 | -0.13 (573) | 1.24 (382) | -1.77 | hayır |
| S20|L1 | -0.19 (573) | 0.98 (382) | -2.03 | hayır |
| S30|X0 | 0.26 (573) | 0.70 (382) | -2.31 | hayır |
| S30|T15 | -0.78 (573) | -1.01 (382) | -4.03 | hayır |
| S30|T20 | -0.09 (573) | -0.44 (382) | -3.45 | hayır |
| S30|M1a | -0.62 (573) | -0.93 (382) | -3.94 | hayır |
| S30|M1b | -0.79 (573) | -0.86 (382) | -3.87 | hayır |
| S30|M2a | -0.77 (573) | -0.80 (382) | -3.81 | hayır |
| S30|M2b | -1.23 (573) | -0.98 (382) | -3.99 | hayır |
| S30|M3a | -0.48 (573) | -0.52 (382) | -3.53 | hayır |
| S30|M3b | -0.82 (573) | -1.02 (382) | -4.03 | hayır |
| S30|O1 | 0.41 (573) | 0.91 (382) | -2.10 | hayır |
| S30|L1 | 0.42 (573) | 0.66 (382) | -2.36 | hayır |
| S40|X0 | -0.35 (573) | 2.05 (382) | -0.97 | hayır |
| S40|T15 | -1.31 (573) | -0.40 (382) | -3.41 | hayır |
| S40|T20 | -0.56 (573) | 0.32 (382) | -2.69 | hayır |
| S40|M1a | -0.95 (573) | -0.55 (382) | -3.56 | hayır |
| S40|M1b | -1.05 (573) | -0.70 (382) | -3.71 | hayır |
| S40|M2a | -1.26 (573) | -0.29 (382) | -3.30 | hayır |
| S40|M2b | -1.58 (573) | -0.95 (382) | -3.96 | hayır |
| S40|M3a | -0.91 (573) | 0.12 (382) | -2.89 | hayır |
| S40|M3b | -1.19 (573) | -0.70 (382) | -3.71 | hayır |
| S40|O1 | -0.21 (573) | 2.62 (382) | -0.39 | hayır |
| S40|L1 | 0.14 (573) | 1.94 (382) | -1.07 | hayır |
| S50|X0 (TABAN) | -0.04 (573) | 3.01 (382) | 0.00 | hayır |
| S50|T15 | -1.19 (573) | 0.37 (382) | -2.64 | hayır |
| S50|T20 | -0.45 (573) | 1.24 (382) | -1.77 | hayır |
| S50|M1a | -0.96 (573) | 0.08 (382) | -2.93 | hayır |
| S50|M1b | -1.19 (573) | -0.41 (382) | -3.43 | hayır |
| S50|M2a | -1.20 (573) | 0.49 (382) | -2.52 | hayır |
| S50|M2b | -1.70 (573) | -0.37 (382) | -3.38 | hayır |
| S50|M3a | -0.81 (573) | 0.93 (382) | -2.08 | hayır |
| S50|M3b | -1.17 (573) | 0.02 (382) | -2.99 | hayır |
| S50|O1 | 0.52 (573) | 3.81 (382) | 0.79 | hayır |
| S50|L1 | 0.64 (573) | 2.89 (382) | -0.12 | hayır |

## Adaylar (KEŞİF ortalaması en yüksek 3 hücre, en az 200 işlem)

### S50|L1

KEŞİF ort 0.64 (n=573); DOĞRULAMA n=382 ort 2.89, ortanca 5.53, kazanma 56%, en kötü -57.7, en kötü %10 -49.04.

| şart | sonuç | değer |
|---|---|---|
| DOĞRULAMA ort > 0 | TUTTU | 2.89 |
| %90 alt > 0 | TUTTU | 0.46 … 5.67 |
| TABAN'dan ≥ 0.3 yüksek | TUTMADI | -0.12 |
| günde en çok 2: getiri > 0 ve düşüş ≤ %30 | TUTTU | getiri 15%, düşüş -17.3% |
| 15 dk gecikmede ort > 0 | TUTTU | 3.65 |
| iki yarıda da ort > 0 | TUTTU | 0.64 / 5.13 |

Takipçi (1000 $, %5, 1x, DOĞRULAMA): sınırsız bakiye 1654 (düşüş -24.1%), günde en çok 2 → 1149 (düşüş -17.3%, en uzun kayıp 8), aynı anda en çok 3 → 1591 (düşüş -21.0%). Günde en çok 2 ile ayda beklenen 18.2 $, en kötü ay -144.9 $.
Çoklu test (BH q=0.10): **düzeltmeden geçmedi: şansa bağlı olabilir**.
**ÖNERİLMEZ**

Yıl yıl ortalama % (n): 2022: -0.57 (27) · 2023: 14.01 (16) · 2024: -5.68 (50) · 2025: 0.27 (396) · 2026: 3.09 (466)

### S50|O1

KEŞİF ort 0.52 (n=573); DOĞRULAMA n=382 ort 3.81, ortanca 8.31, kazanma 61%, en kötü -57.7, en kötü %10 -51.24.

| şart | sonuç | değer |
|---|---|---|
| DOĞRULAMA ort > 0 | TUTTU | 3.81 |
| %90 alt > 0 | TUTTU | 1.34 … 6.50 |
| TABAN'dan ≥ 0.3 yüksek | TUTTU | 0.79 |
| günde en çok 2: getiri > 0 ve düşüş ≤ %30 | TUTTU | getiri 26%, düşüş -17.0% |
| 15 dk gecikmede ort > 0 | TUTTU | 4.16 |
| iki yarıda da ort > 0 | TUTTU | 1.68 / 5.93 |

Takipçi (1000 $, %5, 1x, DOĞRULAMA): sınırsız bakiye 1956 (düşüş -23.4%), günde en çok 2 → 1261 (düşüş -17.0%, en uzun kayıp 5), aynı anda en çok 3 → 1732 (düşüş -20.9%). Günde en çok 2 ile ayda beklenen 32.2 $, en kötü ay -156.5 $.
Çoklu test (BH q=0.10): **düzeltmeden geçmedi: şansa bağlı olabilir**.
**ÖNERİLİR (30 canlı kâğıt sinyalle doğrulama şartıyla)**

Yıl yıl ortalama % (n): 2022: -1.29 (27) · 2023: 14.01 (16) · 2024: -4.02 (50) · 2025: -0.06 (396) · 2026: 3.83 (466)

### S30|L1

KEŞİF ort 0.42 (n=573); DOĞRULAMA n=382 ort 0.66, ortanca 2.01, kazanma 51%, en kötü -37.2, en kötü %10 -31.35.

| şart | sonuç | değer |
|---|---|---|
| DOĞRULAMA ort > 0 | TUTTU | 0.66 |
| %90 alt > 0 | TUTMADI | -1.80 … 3.57 |
| TABAN'dan ≥ 0.3 yüksek | TUTMADI | -2.36 |
| günde en çok 2: getiri > 0 ve düşüş ≤ %30 | TUTTU | getiri 2%, düşüş -18.5% |
| 15 dk gecikmede ort > 0 | TUTTU | 2.17 |
| iki yarıda da ort > 0 | TUTMADI | -1.84 / 3.15 |

Takipçi (1000 $, %5, 1x, DOĞRULAMA): sınırsız bakiye 1089 (düşüş -27.1%), günde en çok 2 → 1020 (düşüş -18.5%, en uzun kayıp 8), aynı anda en çok 3 → 1200 (düşüş -15.4%). Günde en çok 2 ile ayda beklenen 2.1 $, en kötü ay -112.4 $.
Çoklu test (BH q=0.10): **düzeltmeden geçmedi: şansa bağlı olabilir**.
**ÖNERİLMEZ**

Yıl yıl ortalama % (n): 2022: 0.55 (27) · 2023: 14.01 (16) · 2024: -5.51 (50) · 2025: 0.10 (396) · 2026: 1.05 (466)

## TABAN (stop %50, hedef yok), DOĞRULAMA

n=382 ort 3.01, ortanca 9.06, %90 aralık 0.34 … 5.82; günde en çok 2 ile bakiye 1157 (düşüş -17.6%).

## Sonuç

Tutan aday(lar): S50|O1 (BH düzeltmesinden geçmedi).

Tek satır: S50|O1 için 1000 $, %5, 1x, günde en çok 2 ile ayda beklenen 32.2 $, en kötü ay -156.5 $ (DOĞRULAMA dönemi, 8 ay).

