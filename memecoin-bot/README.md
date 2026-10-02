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
  └─ pumpfun.py     event decode (Trade / Create / Complete) + curve matematiği
      └─ store.py   SQLite: tokens, trades, funders, paper_trades
          ├─ funding.py    ilk fonlayıcı + fonlayıcının fonlayıcısı (RPC, 2 kademe)
          ├─ cohort.py     union-find: ortak (ata) fonlayıcı, launch bundle,
          │                aynı slot + aynı boyut → tek davranışsal birim
          ├─ reputation.py cüzdan + creator itibarı (sadece ufku bitmiş tokenlardan)
          ├─ features.py   38 özellik: cohort, LPI/yapay talep, MEV/sandwich,
          │                akıllı cluster, creator geçmişi (look-ahead yok)
          ├─ scoring.py    hard filtre → Organic / Manipulation / Survival
          │                (+ eğitilmiş model varsa P(kâr), P(rug) kapısı) → BUY|WATCH|PASS
          ├─ paper.py      çıkış motoru: gap'li stop, TP + trailing, time stop,
          │                creator/akıllı cüzdan satışında "insider_exit"
          ├─ risk.py       pozisyon boyutu, günlük limit, kill switch
          ├─ dataset.py    etiketleme + "skor işe yarıyor mu?" raporu
          ├─ model.py      lojistik regresyon, walk-forward AUC (Faz 2)
          └─ optimize.py   çıkış kuralı grid'i, walk-forward seçim
```

## Senin 6 taktiğinin karşılığı

| Taktik | Durum | Nerede |
|---|---|---|
| 1. Wallet-cluster flow | ✅ | `cohort.py` + `reputation.py`: cluster'lar, geçmiş getirisi Bayes-shrink ile puanlanan akıllı cüzdanlar, `smart_clusters` özelliği, satışa geçince `insider_exit` |
| 2. LP inventory | ⏳ | Bonding curve'de çekilebilir LP yok. Graduation sonrası PumpSwap gerekiyor (aşağıda) |
| 3. Yapay talep / LPI | ✅ | `features.py`: vol/liq, round-trip, boyut entropisi, fonlayıcı HHI, cohesion, top10, fresh wallet |
| 4. Bonding-curve hazard | ✅ | `curve_progress`, `real_sol`, alıcı ivmesi + `model.py` `graduated` hedefi |
| 5. MEV / toxic flow | ✅ | `features.order_slot` aynı slot'u rezerv zinciriyle gerçek sıraya dizer; sandwich + aynı-slot al-sat payı manipülasyon skoruna girer |
| 6. Token-wallet graph | ✅ | 2 kademe fonlama grafiği (hub'da durur), creator geçmişi (seri rug'cı filtresi) |

## Kurulum

```bash
cd memecoin-bot
python3 -m venv .venv && . .venv/bin/activate
pip install -e '.[dev]'      # numpy sadece `train` için gerekli
pytest                       # 58 test, sentetik organik vs manipüle senaryolar
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

## Kâr motoru

| Özellik | Ne yapar | Ayar |
|---|---|---|
| Çoklu karar anı | Token 60/120/300/600. saniyelerde yeniden değerlendirilir, **ilk BUY'da** girilir (sonradan ısınan tokenlar kaçmaz) | `MBOT_DECISION_AGES` |
| Akıllı cüzdan tetiği | Kanıtlanmış akıllı cüzdan alım yaptığı an değerlendirme (30 sn cooldown) | `MBOT_SMART_TRIGGER` |
| Güvene göre boyut | Model varsa ¼ Kelly: `p − (1−p)/b`, [%0.25, %2] aralığında, likidite tavanı korunur. `train` bunun düz boyuttan iyi olup olmadığını her foldda raporlar | `MBOT_KELLY_FRACTION` (0 = kapalı) |
| Yeniden skorlama çıkışı | Açık pozisyon dakikada bir yeniden skorlanır; organik < 40 veya manipülasyon > 65 → çık | `MBOT_RESCORE_*` |
| Anlatı sıcaklığı | İsmindeki kelimeyi taşıyan, son 6 saatte biten tokenların graduation oranı | `MBOT_NARRATIVE_WINDOW_S` |

Backtest olay sıralıdır: karar anları, akıllı cüzdan alımları ve itibar güncellemeleri tek
zaman çizelgesinde işlenir; hiçbir karar o anda bilinmeyen bir sonucu görmez.
`dataset` CSV'si tüm değerlendirmeleri içerir (`train` hepsini kullanır); `report` token
başına tek satır (`final`) gösterir: girilenlerde giriş anı, girilmeyenlerde ilk fırsat.

## Milisaniye yarışına girmiyoruz

Launch anındaki snipe yarışını validator'a yakın, Rust + Jito altyapılı ekipler kazanır.
Bu bot bilerek 120. saniyede karar verir ve hıza değil bilgiye (cohort, itibar, filtre)
dayanır. Bunu korumak için:

- **`latency` komutu:** girişi 0–8 trade geciktirip edge'in eriyip erimediğini ölçer.
- **Kayma tavanı (`max_entry_slippage`):** fiyat karar anından %15'ten fazla kaçtıysa alım
  dolmaz (pump.fun `max_sol_cost` karşılığı) — pompayı kovalamayız.
- **Likidite tavanı (`max_liq_frac`):** pozisyon curve'deki SOL'ün %2'sini geçmez; çıkarken
  kendi satışımızla fiyatı çökertmeyiz.
- **Rejim filtresi:** son 1 saatte biten tokenların %60'tan fazlası rug ise yeni giriş yok.

## Railway'de çalıştırma

1. Railway → New Project → GitHub repo → bu repo, branch'i seç.
2. Service Settings → **Root Directory: `memecoin-bot`** (Dockerfile ve `railway.json` buradan
   okunur; algılanmazsa Config-as-code yolunu `memecoin-bot/railway.json` yap).
3. Service → **Volume ekle, mount path: `/data`** (veritabanı, modeller, hubs.txt burada;
   volume olmazsa her deploy'da veri silinir).
4. Variables:
   - `MBOT_WS_URL`, `MBOT_RPC_URL` — ücretli RPC (Helius/Triton/QuickNode)
   - `MBOT_MODE` — `paper` (varsayılan: veri + skor + paper işlem) veya `collect` (sadece veri)
   - `MBOT_TELEGRAM_TOKEN`, `MBOT_TELEGRAM_CHAT_ID` — bildirimler (opsiyonel ama önerilir)
5. Deploy. Analiz komutları için: `railway ssh` → `python -m mbot stats`, `golive` vb.

**Telegram kurulumu:** Telegram'da @BotFather → `/newbot` → token'ı al. Bota bir mesaj at,
sonra `https://api.telegram.org/bot<TOKEN>/getUpdates` adresinde `chat.id`'yi bul.
`python -m mbot notify-test` ile dene.

**Bildirimler:** bot başladı · veri akışı 5 dk durdu · WebSocket koptu · disk < 1 GB ·
kill switch / günlük limit · paper alım/çıkış (`MBOT_NOTIFY_TRADES=0` ile kapatılır) ·
her gün UTC 00:00'da günlük özet. Aynı uyarı 30 dakikada bir kez gönderilir.

## Faz faz kullanım

| Faz | Komut | Ne zaman ilerlenir |
|---|---|---|
| 0 Veri | `python -m mbot collect --funders` | En az 1–2 hafta kesintisiz veri |
| 1 Filtre | `python -m mbot dataset --hours 168` → `report` | PASS'lerin getirisi BUY'lardan belirgin kötü |
| 1b İtibar | `python -m mbot wallets` | Akıllı cüzdan sayısı anlamlı (yüzlerce token sonrası) |
| 2 Model | `python -m mbot train` | Tüm walk-forward foldlarında AUC > 0.55 (değilse model kaydedilmez) |
| 2b Çıkış | `python -m mbot optimize --hours 168` | Görülmemiş veride mevcut ayarları geçerse önerilen `export`'lar |
| 2d Risk | `python -m mbot montecarlo` (veya `--source paper`) | Kötü senaryoda drawdown kabul edilebilir; önerilen `MBOT_RISK_PER_TRADE` |
| 2c Hız testi | `python -m mbot latency --hours 168` | Edge 3 trade gecikmede hâlâ pozitif (değilse hız edge'idir, senin değil) |
| 2e Maliyet | `python -m mbot costs` | Edge maliyet ×2'de hâlâ pozitif |
| 3 Paper | `python -m mbot paper` + `stats` | ≥500 paper işlem, paper ≈ dataset sonuçları |
| 3b Uyum | `python -m mbot reconcile` | Paper getirisi backtest'ten en fazla 5 puan kötü |
| 3c Drift | `python -m mbot drift` (haftalık) | Modeller "ESKİDİ" demiyor |
| ✔ Kontrol | `python -m mbot golive` | Tüm satırlar ✅ |
| 4 Canlı | (henüz yok — bilinçli olarak) | Faz 3 tutarlıysa küçük sermaye |

`report` kuralı: **BUY satırında `ort(top5 hariç)` > 0 değilse, n < 500 ise veya skor
dilimleri monoton değilse canlıya geçme.**

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

## Henüz yapılmayanlar (ve neden)

1. **PumpSwap / LP takibi (taktik 2):** PumpSwap event layout'unu gerçek zincir verisiyle
   doğrulamadan decoder yazmak sessizce çöp veri üretir. Gerçek veriye erişim olduğunda
   ilk eklenecek şey bu.
2. **Gerçek emir gönderme (Jito bundle):** Paper sonuçları kanıtlanmadan bilinçli olarak yok.
3. **Sosyal/attention verisi:** X/Telegram akışı ayrı bir veri kaynağı ve API maliyeti ister.
