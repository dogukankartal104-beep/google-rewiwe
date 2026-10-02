"""Hard filtreler + üç skor + karar.

ÖNEMLİ: Ağırlıklar öncüldür (prior), veriyle kalibre edilmemiştir. `python -m mbot
report` skor dilimleri ile gerçek sonuçları karşılaştırır; skor tahmin gücü
göstermiyorsa bu modül eğitilmiş bir modelle değiştirilmelidir (Faz 2).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

from .config import Config
from .store import Store, Token


def _s(x: float, mid: float, scale: float) -> float:
    return 1 / (1 + math.exp(-(x - mid) / scale))


def _wavg(parts: list[tuple[float, float]]) -> float:
    return 100 * sum(w * v for w, v in parts) / sum(w for w, _ in parts)


@dataclass
class Verdict:
    organic: float
    manipulation: float
    survival: float
    decision: str  # BUY | WATCH | PASS
    reasons: list[str] = field(default_factory=list)
    probs: dict[str, float] = field(default_factory=dict)  # eğitilmiş model çıktıları

    def as_dict(self) -> dict:
        return {"organic": round(self.organic, 1), "manipulation": round(self.manipulation, 1),
                "survival": round(self.survival, 1), "decision": self.decision,
                "reasons": self.reasons, **{k: round(v, 3) for k, v in self.probs.items()}}


def hard_filter(token: Token, f: dict[str, float], store: Store | None, cfg: Config) -> list[str]:
    """Boş liste = geçti. Her eleman red sebebi."""
    r = []
    if f["n_trades"] < cfg.min_trades:
        r.append(f"az trade ({int(f['n_trades'])})")
    if f["bundle_share"] > cfg.max_bundle_share:
        r.append(f"launch bundle %{f['bundle_share'] * 100:.0f}")
    if f["creator_cluster_hold"] > cfg.max_creator_cluster_hold:
        r.append(f"creator cluster arzın %{f['creator_cluster_hold'] * 100:.0f}'ini tutuyor")
    if f.get("creator_prev_tokens", 0) >= 3 and f["creator_rug_rate"] >= cfg.max_creator_rug_rate:
        r.append(f"creator geçmişi: {int(f['creator_prev_tokens'])} tokenın "
                 f"%{f['creator_rug_rate'] * 100:.0f}'i rug")
    if store is not None:
        n = store.creator_launches(token.creator, token.created_ts - 86_400, token.created_ts)
        if n >= cfg.max_creator_launches_24h:
            r.append(f"seri launcher ({n} token/24s)")
        c = store.symbol_clones(token.symbol, token.created_ts - 3600, token.created_ts)
        if c >= cfg.max_symbol_clones_1h:
            r.append(f"copycat sembol ({c}x/1s)")
    return r


def score(f: dict[str, float]) -> tuple[float, float, float]:
    rep_on = f.get("rep_known_share", 0) > 0
    organic = _wavg([
        *([(3, _s(f["smart_clusters"], 1.5, 0.6)), (1, _s(f["buyer_rep_mean"], 0.0, 0.15))]
          if rep_on else []),
        (3, _s(f["effective_buyers"], 25, 8)),
        (2, 1 - f["cohesion"]),
        (1, f["size_entropy"]),
        (2, 1 - f["funder_hhi"]),
        (1, 1 - f["fresh_wallet_share"]),
        (1, _s(f["buyer_accel"], 1.0, 0.3)),
        (1, 1 - f["round_trip_share"]),
    ])
    manipulation = _wavg([
        (3, f["cohesion"]),
        (2, _s(f["bundle_share"], 0.10, 0.04)),
        (2, _s(f["creator_cluster_hold"], 0.12, 0.04)),
        (1, _s(f["top10_share"], 0.55, 0.08)),
        (2, _s(f["vol_to_liq"], 8, 2)),
        (2, f["round_trip_share"]),
        (1, f["burst_share"]),
        (1, _s(f["repeat_ratio"], 2.5, 0.6)),
        (1, f["fresh_wallet_share"]),
        (2, _s(f.get("mev_share", 0), 0.15, 0.05)),
        (1, f.get("wash_slot_share", 0)),
        *([(2, f["creator_rug_rate"])] if f.get("creator_prev_tokens", 0) >= 2 else []),
    ])
    survival = _wavg([
        (2, _s(f["real_sol"], 15, 5)),
        (2, _s(f["net_flow_sol"] / max(f["real_sol"], 1), 0.3, 0.15)),
        (2, 1 - _s(f["sell_buy_ratio"], 0.6, 0.12)),
        (2, 1 - _s(f["creator_cluster_hold"], 0.10, 0.04)),
        (1, 1 - _s(f["largest_cluster_buy_share"], 0.25, 0.06)),
    ])
    return organic, manipulation, survival


def evaluate(token: Token, f: dict[str, float], store: Store | None, cfg: Config,
             models: Optional[dict] = None) -> Verdict:
    o, m, s = score(f)
    probs = {f"p_{k}": mdl.predict(f) for k, mdl in (models or {}).items()}
    rejects = hard_filter(token, f, store, cfg)
    if rejects:
        return Verdict(o, m, s, "PASS", rejects, probs)
    reasons = []
    if "p_win" in probs and probs["p_win"] < cfg.model_min_p_win:
        reasons.append(f"model P(kâr) düşük ({probs['p_win']:.2f})")
    if "p_rug" in probs and probs["p_rug"] > cfg.model_max_p_rug:
        reasons.append(f"model P(rug) yüksek ({probs['p_rug']:.2f})")
    if o < cfg.buy_min_organic:
        reasons.append(f"organik talep düşük ({o:.0f})")
    if m > cfg.buy_max_manipulation:
        reasons.append(f"manipülasyon riski yüksek ({m:.0f})")
    if s < cfg.buy_min_survival:
        reasons.append(f"hayatta kalma düşük ({s:.0f})")
    if reasons:
        return Verdict(o, m, s, "PASS", reasons, probs)
    if f["price_mult"] > cfg.max_entry_price_mult or f["curve_progress"] > cfg.max_entry_progress:
        return Verdict(o, m, s, "WATCH", ["talep gerçek ama fiyat zaten koşmuş"], probs)
    why = ["erken organik talep"]
    if f.get("smart_clusters", 0) >= 1:
        why.append(f"{int(f['smart_clusters'])} akıllı cluster içeride")
    return Verdict(o, m, s, "BUY", why, probs)
