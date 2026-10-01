# mbot — Pump.fun Coordinated-Flow Survival Engine

Sorulan soru "hangi coin yükselecek?" değil, sırasıyla:

1. **Bu hareket gerçek mi?** → wallet-cohort + fonlama grafiği (15 bağlantılı cüzdan = 1 alıcı)
2. **Bu talep yaşayabilir mi?** → curve likiditesi, net akış, creator cluster arzı
3. **Fiyat bunu henüz fiyatlamadı mı?** → başlangıç fiyatına göre çarpan, curve ilerlemesi

> ⚠️ **"Asla zarar etmeyen bot" yoktur.** Bu kod zararı *sınırlamak* ve edge'in
> var olup olmadığını *ölçmek* için tasarlandı. Gerçek emir göndermez.

## Mimari

```
WebSocket (logsSubscribe: pump.fun programı)
  └─ pumpfun.py   event decode (Trade / Create / Complete) + curve matematiği
      └─ store.py SQLite: tokens, trades, funders, paper_trades
          ├─ funding.py  cüzdanın ilk fonlayıcısı (RPC)       ┐
          ├─ cohort.py   union-find: aynı fonlayıcı, bundle,  │ karar anı
          │              aynı slot + aynı boyut              │ (token yaşı = 120 s)
          ├─ features.py 28 özellik (look-ahead yok)          │
          └─ scoring.py  hard filtre → Organic / Manipulation ┘
                         / Survival skoru → BUY | WATCH | PASS
              ├─ paper.py   giriş/çıkış motoru (gap'li stop, TP + trailing, time stop)
              ├─ risk.py    pozisyon boyutu, günlük limit, kill switch
              └─ dataset.py etiketleme + "skor gerçekten işe yarıyor mu?" raporu
```

## Kurulum

```bash
cd memecoin-bot
python3 -m venv .venv && . .venv/bin/activate
pip install -e '.[dev]'
pytest                       # 16 test, sentetik organik vs manipüle senaryolar
```

Public Solana RPC rate-limit'lidir ve log'ları düşürür. Ciddi kullanım için
Helius / Triton / QuickNode gibi ücretli bir sağlayıcı kullan:

```bash
export MBOT_WS_URL="wss://mainnet.helius-rpc.com/?api-key=..."
export MBOT_RPC_URL="https://mainnet.helius-rpc.com/?api-key=..."
```

Her ayar `mbot/config.py` içinde; `MBOT_<ALAN_ADI>` ile override edilir
(ör. `MBOT_DECISION_AGE_S=90`, `MBOT_EQUITY_SOL=5`).

`hubs.txt`: CEX hot wallet'ları gibi binlerce bağımsız kullanıcıyı fonlayan
adresler. Buradaki adresler üzerinden cüzdanlar **birbirine bağlanmaz**.
`hubs.example.txt` dosyasını kopyalayıp kendi doğruladığın adreslerle doldur.

## Faz faz kullanım

| Faz | Komut | Ne zaman ilerlenir |
|---|---|---|
| 0 Veri | `python -m mbot collect --funders` | En az 1–2 hafta kesintisiz veri |
| 1 Filtre | `python -m mbot dataset --hours 168` → `report` | PASS'lerin rug oranı BUY'lardan belirgin yüksek |
| 2 Model | `data/dataset.csv` ile model eğit, `scoring.score()`'u değiştir | Walk-forward'da skor dilimleri monoton |
| 3 Paper | `python -m mbot paper` + `python -m mbot stats` | ≥500 paper işlem, paper ≈ dataset sonuçları |
| 4 Canlı | (henüz yok — bilinçli olarak) | Faz 3 tutarlıysa küçük sermaye |

`report` çıktısındaki kural: **BUY satırında `ort(top5 hariç)` > 0 değilse, n < 500
ise veya skor dilimleri monoton değilse canlıya geçme.**

## Bilinen sınırlar / dürüst notlar

- Skor ağırlıkları **öncüldür** (makul varsayımlar), gerçek veriyle kalibre edilmedi.
  Faz 1–2'nin amacı tam olarak bunu ölçmek.
- Paper motoru geçmiş trade'leri bizim işlemimiz yokmuş gibi oynatır (hafif iyimser).
  Buna karşılık stop'lar gap fiyatından dolar, fee + tx maliyeti + latency eklenir.
- **Küçük pozisyonu maliyet yer:** 0.05 SOL'lük işlemde 2×0.002 SOL tx maliyeti
  tek başına %8. Test `test_costs_dominate_tiny_positions` bunu gösterir.
- Sadece bonding curve izlenir; graduation sonrası (PumpSwap) pozisyon son curve
  fiyatından kapatılır. PumpSwap/Raydium havuz takibi sonraki adım.
- Event layout'u pump.fun güncellemeleriyle değişebilir; decoder bilinen önek
  alanları okur, fazlasını yok sayar. Program güncellemesinden sonra `stats` ile
  trade sayısının düşmediğini kontrol et.
- Uzun tx'lerde RPC log'ları kesebilir ("Log truncated") → nadiren event kaybı.

## Sonraki adımlar (öncelik sırasıyla)

1. Gerçek veri topla, `report` ile filtrelerin işe yarayıp yaramadığını ölç
2. Hub (CEX) listesini ve creator geçmişi özelliklerini zenginleştir
3. Gradient boosting ile `P(strateji getirisi > 0)` modeli, walk-forward doğrulama
4. MEV/sandwich tespiti (aynı slot'ta önce-sonra trade deseni)
5. PumpSwap havuz state'i + LP çekilme tehlike modeli
6. Ancak bunlardan sonra: Jito bundle ile gerçek yürütme + ayrı imzalama servisi
