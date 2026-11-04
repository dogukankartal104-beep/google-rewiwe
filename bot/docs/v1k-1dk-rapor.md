# v1k: kayan 1 dakikalık pencere ile saate hizalı 15m kapanış karşılaştırması

Oluşturuldu: 2026-11-04T14:24:22.765Z · protokol: `docs/v1k-1dk-protokol.md` (sonuçlardan önce commit'lendi). Dönem 2022-01 → 2026-11-02, bölme 2026-03-02.

Kapsam: kayan kural R 1501 sinyal; 15m kuralı C 955 sinyal. İndirme hatası 0.

| hücre | n | KEŞİF n / ort | DOĞRULAMA n | ort | ortanca | kazanma | %90 aralık | 15 dk gecikme ort | günde 2: getiri % / düşüş % | ayda $ / en kötü ay $ |
|---|---|---|---|---|---|---|---|---|---|---|
| C: K0 | 955 | 573 / -0.04 | 382 | 3.01 | 9.06 | 62% | 0.34 … 5.82 | 3.30 | 21 / -17.6 | 26.2 / -148.4 |
| C: K1 | 497 | 286 / 0.77 | 211 | 5.51 | 11.54 | 65% | 0.84 … 10.27 | 4.82 | 43 / -13.9 | 53.3 / -107.7 |
| C: K2 | 497 | 286 / 1.10 | 211 | 6.11 | 11.54 | 65% | 1.55 … 10.74 | 5.39 | 50 / -14.9 | 61.8 / -104.0 |
| R0 | 1501 | 916 / -0.73 | 585 | 3.61 | 8.50 | 64% | 0.68 … 6.55 | 4.06 | 19 / -22.0 | 21.4 / -195.8 |
| R1 | 771 | 476 / 0.14 | 295 | 4.88 | 6.90 | 64% | 1.13 … 8.81 | 3.94 | 39 / -17.4 | 47.1 / -190.6 |
| R2 | 771 | 476 / 0.55 | 295 | 4.94 | 6.90 | 63% | 1.24 … 8.86 | 4.16 | 46 / -15.2 | 55.2 / -155.2 |

## Örtüşme: kayan kuralın sinyalleri 15m kuralıyla nasıl ilişkili (R1, filtreli)

| sınıf | n (tüm dönem) | ort | DOĞRULAMA n | DOĞRULAMA ort |
|---|---|---|---|---|
| same moment | 45 | -1.68 | 15 | 2.37 |
| earlier than the 15m rule | 191 | 0.39 | 72 | 0.62 |
| missed by the 15m rule | 535 | 2.82 | 208 | 6.54 |

## Karar (protokol)

| karşılaştırma | n ≥ 100 | ort ≥ C+0.3 | %90 alt > 0 | iki yarı > 0 | 15 dk gecikme > 0 | günde 2: getiri > 0 ve düşüş ≤ %30 | kaçan sinyaller > 0 | sonuç |
|---|---|---|---|---|---|---|---|---|
| R1 vs C: K1 | evet | hayır (4.88 vs 5.51) | evet | evet | evet | evet | evet | saate hizalı kural kalır |
| R2 vs C: K2 | evet | hayır (4.94 vs 6.11) | evet | evet | evet | evet | evet | saate hizalı kural kalır |

**Sonuç: kayan pencere saate hizalı kuralı geçmedi; canlı kural (15m kapanış) kalır.**

