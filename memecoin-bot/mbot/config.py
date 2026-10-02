"""Tüm ayarlar tek yerde. Ortam değişkeni ile override edilir (MBOT_<ALAN>)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field, fields
from pathlib import Path


@dataclass
class Config:
    # --- bağlantı
    ws_url: str = "wss://api.mainnet-beta.solana.com"
    rpc_url: str = "https://api.mainnet-beta.solana.com"
    db_path: str = "data/mbot.db"
    hubs_file: str = "hubs.txt"  # CEX hot wallet vb. — fonlama bağı kurmaz

    # --- karar zamanı / etiket
    decision_age_s: int = 120  # decision_ages boşsa tek karar anı
    decision_ages: str = "60,120,300,600"  # bu yaşlarda yeniden değerlendir, ilk BUY'da gir
    smart_trigger: int = 1  # akıllı cüzdan alım yapınca hemen değerlendir
    smart_trigger_min_age_s: int = 15
    eval_cooldown_s: int = 30  # aynı token için iki değerlendirme arası en az
    horizon_s: int = 1800  # etiket ufku
    min_trades: int = 15

    # --- cohort
    same_slot_size_tol: float = 0.15  # aynı slot + ±%15 boyut → bağla
    funder_max_pages: int = 3  # 3*1000 imzadan eski cüzdan = "köklü"
    funding_depth: int = 2  # fonlayıcının fonlayıcısı da bağ kurar
    fresh_wallet_s: int = 86_400

    # --- cüzdan itibarı (sadece ufku bitmiş tokenlardan öğrenilir)
    rep_early_s: int = 300  # ilk 5 dakikada giren cüzdanlar puanlanır
    rep_min_tokens: int = 5
    rep_prior_k: float = 5.0  # az örnekli cüzdanı ortalamaya çeker
    rep_smart_mean: float = 0.20  # shrink edilmiş ortalama getiri eşiği
    rep_smart_winrate: float = 0.50
    rep_refresh_s: int = 600
    max_creator_rug_rate: float = 0.80  # en az 3 önceki tokenı varsa
    narrative_window_s: int = 21_600  # anlatı (isim kelimesi) sıcaklığı penceresi: 6 saat

    # --- piyasa rejimi: son pencerede ufku biten tokenların rug oranı
    regime_window_s: int = 3600
    regime_min_tokens: int = 30
    regime_max_rug: float = 0.60

    # --- hard filtreler
    max_bundle_share: float = 0.25
    max_creator_cluster_hold: float = 0.20
    max_creator_launches_24h: int = 3
    max_symbol_clones_1h: int = 5

    # --- karar eşikleri (öncül; dataset/report ile kalibre edilmeli)
    buy_min_organic: float = 70
    buy_max_manipulation: float = 30
    buy_min_survival: float = 60
    max_entry_price_mult: float = 6.0  # başlangıç fiyatının 6x üstü = "zaten fiyatlandı"
    max_entry_progress: float = 0.70

    # --- yürütme maliyetleri (paper)
    fee_bps: int = 125  # curve fee + creator fee, muhafazakâr
    tx_cost_sol: float = 0.002  # priority fee + Jito tip / tx
    latency_trades: int = 1  # karardan sonra kaç trade geç dolarız
    max_entry_slippage: float = 0.15  # karar anı fiyatından fazla kaçtıysa alım dolmaz

    # --- çıkış kuralları
    stop_loss: float = 0.30
    tp1: float = 0.60
    tp1_fraction: float = 0.5
    trailing: float = 0.25
    time_stop_s: int = 900
    insider_exit_frac: float = 0.5  # creator/akıllı cüzdanlar elindekinin yarısını sattıysa çık
    rescore_s: int = 60  # açık pozisyonu bu aralıkla yeniden skorla
    rescore_exit_organic: float = 40  # organik talep bunun altına düşerse çık
    rescore_exit_manip: float = 65  # manipülasyon bunun üstüne çıkarsa çık

    # --- ML (models/ klasöründe eğitilmiş model varsa BUY'u ek olarak kapılar)
    model_dir: str = "models"
    model_min_p_win: float = 0.55
    model_max_p_rug: float = 0.35

    # --- risk
    equity_sol: float = 10.0
    risk_per_trade: float = 0.005  # equity'nin %0.5'i
    max_open: int = 5
    max_liq_frac: float = 0.02  # pozisyon ≤ curve'deki SOL'ün %2'si (çıkış likiditesi)
    kelly_fraction: float = 0.25  # model varsa: boyut = equity × kelly × bu kesir
    max_risk_per_trade: float = 0.02  # güvenli bile olsa tek işlemde en fazla %2
    daily_loss_limit: float = 0.03
    max_consecutive_losses: int = 8

    # --- canlıya geçiş kontrol listesi
    golive_min_paper: int = 500
    golive_max_gap: float = 0.05  # paper backtest'ten en fazla 5 puan kötü olabilir
    golive_max_dd: float = 0.20

    hubs: set[str] = field(default_factory=set)

    @property
    def label_lag_s(self) -> int:
        """Bir tokenın tüm etiketleri kesinleşene kadar geçmesi gereken süre."""
        return self.ages[-1] + self.horizon_s

    @property
    def ages(self) -> list[int]:
        a = sorted({int(x) for x in self.decision_ages.split(",") if x.strip()})
        return a or [self.decision_age_s]

    @classmethod
    def load(cls) -> "Config":
        cfg = cls()
        for f in fields(cls):
            if f.name == "hubs":
                continue
            raw = os.environ.get(f"MBOT_{f.name.upper()}")
            if raw is None:
                continue
            cur = getattr(cfg, f.name)
            setattr(cfg, f.name, type(cur)(raw))
        p = Path(cfg.hubs_file)
        if p.exists():
            cfg.hubs = {
                ln.split("#")[0].strip()
                for ln in p.read_text().splitlines()
                if ln.split("#")[0].strip()
            }
        return cfg
