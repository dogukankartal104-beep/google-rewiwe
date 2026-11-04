# v1k ikinci motor adayı: kayan pencere tetik + geri çekilme teyidi

Oluşturuldu: 2026-11-04T14:38:51.163Z · protokol: `docs/v1k-teyit-protokol.md` (sonuçlardan önce commit'lendi). Dönem 2022-01 → 2026-11-02, bölme 2026-03-02.

Kapsam: 1501 kayan tetik; 15m kuralı C 955 sinyal. İndirme hatası 0.

| hücre | n | KEŞİF n / ort | DOĞRULAMA n | ort | ortanca | kazanma | %90 aralık | 15 dk gecikme ort | günde 2: getiri % / düşüş % | ayda $ / en kötü ay $ |
|---|---|---|---|---|---|---|---|---|---|---|
| C: K0 | 955 | 573 / -0.04 | 382 | 3.01 | 9.06 | 62% | 0.34 … 5.82 | 3.30 | 21 / -17.6 | 26.2 / -148.4 |
| C: K1 | 497 | 286 / 0.77 | 211 | 5.51 | 11.54 | 65% | 0.84 … 10.27 | 4.82 | 43 / -13.9 | 53.3 / -107.7 |
| P1 | 1498 | 916 / -0.80 | 582 | 3.56 | 8.25 | 64% | 0.57 … 6.48 | 3.96 | 15 / -20.2 | 16.8 / -183.1 |
| P2 | 1394 | 865 / -0.64 | 529 | 4.12 | 9.16 | 65% | 1.10 … 7.14 | 4.45 | 36 / -17.1 | 43.0 / -154.9 |
| P1F | 768 | 476 / -0.33 | 292 | 3.88 | 6.32 | 63% | 0.19 … 7.69 | 3.51 | 25 / -19.4 | 29.8 / -201.0 |
| P2F | 692 | 439 / -0.34 | 253 | 3.92 | 5.70 | 62% | -0.15 … 8.09 | 3.75 | 34 / -17.0 | 40.9 / -187.1 |

## v1k ile ilişki (DOĞRULAMA; v1k K1 tek başına, aynı anda en çok 3: bakiye 1546, getiri 55%, düşüş -10.1%)

| aday | v1k ile aynı coin ±1 saat | günlük getiri korelasyonu | birleşik (K1 + aday, aynı anda en çok 3): getiri % / düşüş % |
|---|---|---|---|
| P1 | 163/582 (28%) | 0.686 | 3 / -34.2 |
| P2 | 148/529 (28%) | 0.684 | 34 / -25.1 |
| P1F | 91/292 (31%) | 0.649 | 21 / -24.1 |
| P2F | 80/253 (32%) | 0.617 | 37 / -23.2 |

## Geçme şartları (ikinci motor olarak)

| hücre | n ≥ 100 | ort > 0 | %90 alt > 0 | iki yarı > 0 | 15 dk gecikme > 0 | günde 2: getiri > 0 ve düşüş ≤ %30 | v1k ile aynı ≤ %50 | birleşik getiri > K1 tek başına ve düşüş ≤ %30 | BH | sonuç |
|---|---|---|---|---|---|---|---|---|---|---|
| P1 | evet | evet | evet | evet | evet | evet | evet | hayır | hayır | geçmedi |
| P2 | evet | evet | evet | evet | evet | evet | evet | hayır | hayır | geçmedi |
| P1F | evet | evet | evet | evet | evet | evet | evet | hayır | hayır | geçmedi |
| P2F | evet | evet | hayır | evet | evet | evet | evet | hayır | hayır | geçmedi |

**Sonuç: hiçbir hücre ikinci motor şartlarını sağlamadı; ikinci motor eklenmez.**

