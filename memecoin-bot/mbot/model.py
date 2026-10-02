"""Faz 2: elle verilen skor ağırlıkları yerine veriden öğrenen model.

Bilerek basit: standardize edilmiş özelliklerle L2-düzenli lojistik regresyon.
Memecoin verisi gürültülü ve rejim değiştirir; karmaşık model ezberler. Asıl önemli
olan doğrulama: zaman sırasını koruyan walk-forward (geçmişle eğit → gelecekte test).

Hedefler:
  win        P(strateji getirisi > 0)        — BUY kapısı
  rug        P(zirveden −%80)                 — BUY kapısı
  graduated  P(ufuk içinde graduation)        — bilgi amaçlı (bonding-curve hazard)
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Optional

EXCLUDE = {"decision_ts", "entry", "final"}  # zaman damgası / strateji işaretleri
TARGETS = {
    "win": lambda r: (float(r["y_ret"]) > 0) if str(r.get("y_ret", "")) != "" else None,
    "rug": lambda r: bool(int(r["y_rug"])),
    "graduated": lambda r: bool(int(r["y_graduated"])),
}


def feature_keys(row: dict) -> list[str]:
    stop = {"organic", "manipulation", "survival", "created_ts"}
    keys = []
    for k, v in row.items():
        if k in EXCLUDE or k in stop or k.startswith("y_"):
            continue
        try:
            float(v)
        except (TypeError, ValueError):
            continue
        keys.append(k)
    return keys


class LogisticModel:
    def __init__(self, features: list[str], mean: list[float], std: list[float],
                 w: list[float], b: float, meta: Optional[dict] = None):
        self.features, self.mean, self.std, self.w, self.b = features, mean, std, w, b
        self.meta = meta or {}

    def predict(self, f: dict) -> float:
        z = self.b
        for k, m, s, w in zip(self.features, self.mean, self.std, self.w):
            x = (float(f.get(k, 0.0)) - m) / s
            z += w * max(-5.0, min(5.0, x))
        return 1 / (1 + math.exp(-max(-30.0, min(30.0, z))))

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"features": self.features, "mean": self.mean,
                                    "std": self.std, "w": self.w, "b": self.b,
                                    "meta": self.meta}, indent=1))

    @classmethod
    def load(cls, path: Path) -> "LogisticModel":
        d = json.loads(path.read_text())
        return cls(d["features"], d["mean"], d["std"], d["w"], d["b"], d.get("meta"))


def load_models(model_dir: str) -> dict[str, LogisticModel]:
    out = {}
    for name in ("win", "rug", "graduated"):
        p = Path(model_dir) / f"{name}.json"
        if p.exists():
            out[name] = LogisticModel.load(p)
    return out


def fit(rows: list[dict], target: str, keys: list[str], l2: float = 1.0,
        iters: int = 400) -> LogisticModel:
    import numpy as np

    lab = TARGETS[target]
    data = [(r, lab(r)) for r in rows]
    data = [(r, y) for r, y in data if y is not None]
    X = np.array([[float(r.get(k, 0.0) or 0.0) for k in keys] for r, _ in data])
    y = np.array([float(v) for _, v in data])
    mean, std = X.mean(0), X.std(0)
    std[std < 1e-9] = 1.0
    Z = np.hstack([np.clip((X - mean) / std, -5, 5), np.ones((len(y), 1))])
    reg = np.full(Z.shape[1], l2)
    reg[-1] = 0.0  # intercept düzenlenmez
    beta = np.zeros(Z.shape[1])
    n = len(y)
    for _ in range(iters):  # Newton-Raphson (IRLS): küçük boyutta hızlı ve kararlı
        p = 1 / (1 + np.exp(-np.clip(Z @ beta, -30, 30)))
        g = Z.T @ (p - y) / n + reg * beta / n
        H = (Z.T * (p * (1 - p))) @ Z / n + np.diag(reg / n + 1e-6)
        step = np.linalg.solve(H, g)
        beta -= step
        if np.abs(step).max() < 1e-7:
            break
    w, b = beta[:-1], beta[-1]
    return LogisticModel(keys, mean.tolist(), std.tolist(), w.tolist(), float(b),
                         {"target": target, "n": n, "base_rate": float(y.mean())})


def auc(scores: list[float], labels: list[bool]) -> float:
    pairs = sorted(zip(scores, labels))
    pos = sum(labels)
    neg = len(labels) - pos
    if not pos or not neg:
        return float("nan")
    rank_sum, i = 0.0, 0
    while i < len(pairs):  # eşit skorlara ortalama sıra
        j = i
        while j < len(pairs) and pairs[j][0] == pairs[i][0]:
            j += 1
        avg = (i + j + 1) / 2
        rank_sum += avg * sum(1 for k in range(i, j) if pairs[k][1])
        i = j
    return (rank_sum - pos * (pos + 1) / 2) / (pos * neg)


def payoff_ratio(rows: list[dict]) -> Optional[float]:
    """Ortalama kazanç / ortalama kayıp (Kelly'deki b)."""
    rets = [float(r["y_ret"]) for r in rows if str(r.get("y_ret", "")) != ""]
    wins = [r for r in rets if r > 0]
    losses = [-r for r in rets if r < 0]
    if not wins or not losses:
        return None
    return (sum(wins) / len(wins)) / (sum(losses) / len(losses))


def _when(r: dict) -> int:
    return int(float(r.get("decision_ts") or r["created_ts"]))


def walk_forward(rows: list[dict], target: str, folds: int = 5, l2: float = 1.0) -> list[dict]:
    rows = sorted(rows, key=_when)
    keys = feature_keys(rows[0])
    lab = TARGETS[target]
    size = len(rows) // (folds + 1)
    out = []
    for k in range(1, folds + 1):
        train, test = rows[: k * size], rows[k * size : (k + 1) * size]
        test = [r for r in test if lab(r) is not None]
        if len(train) < 50 or len(test) < 20:
            continue
        m = fit(train, target, keys, l2)
        sc = [m.predict(r) for r in test]
        ys = [bool(lab(r)) for r in test]
        top = sorted(zip(sc, test), key=lambda x: x[0], reverse=True)[: max(1, len(test) // 5)]
        rets = [float(r["y_ret"]) for _, r in top if str(r.get("y_ret", "")) != ""]
        row = {"fold": k, "train": len(train), "test": len(test), "auc": auc(sc, ys),
               "base": sum(ys) / len(ys),
               "top20_ret": sum(rets) / len(rets) if rets else float("nan")}
        if target == "win":  # Kelly boyutu düz boyuttan iyi mi? (b eğitim diliminden)
            b = payoff_ratio(train)
            pairs = [(p, float(r["y_ret"])) for p, r in zip(sc, test)
                     if str(r.get("y_ret", "")) != ""]
            if b and pairs:
                w = [max(0.5, min(4.0, (p - (1 - p) / b) / 0.05)) for p, _ in pairs]
                row["flat_ret"] = sum(r for _, r in pairs) / len(pairs)
                row["kelly_ret"] = sum(wi * r for wi, (_, r) in zip(w, pairs)) / sum(w)
        out.append(row)
    return out


def train_all(rows: list[dict], out_dir: str, min_rows: int = 200) -> str:
    lines = []
    if len(rows) < min_rows:
        return f"Sadece {len(rows)} satır var; en az {min_rows} gerekli. Önce daha fazla veri topla."
    keys = feature_keys(rows[0])
    for target in TARGETS:
        wf = walk_forward(rows, target)
        lines.append(f"\n== {target} (walk-forward, geçmişle eğit → gelecekte test) ==")
        for r in wf:
            lines.append(f"fold {r['fold']}: train={r['train']:5d} test={r['test']:4d} "
                         f"AUC={r['auc']:.3f} taban={r['base']:.1%} "
                         f"en-iyi-%20 strateji ort={r['top20_ret']:+.2%}"
                         + (f" | düz boyut {r['flat_ret']:+.2%} → güvene göre boyut "
                            f"{r['kelly_ret']:+.2%}" if "kelly_ret" in r else ""))
        aucs = [r["auc"] for r in wf if not math.isnan(r["auc"])]
        ok = bool(aucs) and min(aucs) > 0.55
        m = fit(rows, target, keys)
        m.meta["wf_auc"] = aucs
        if target == "win":
            m.meta["payoff"] = payoff_ratio(rows)
            kr = [(r["kelly_ret"], r["flat_ret"]) for r in wf if "kelly_ret" in r]
            if kr:
                better = sum(k > f for k, f in kr)
                lines.append(f"   güvene göre boyut {better}/{len(kr)} foldda düz boyuttan iyi"
                             + ("" if better > len(kr) / 2 else
                                " → canlıda MBOT_KELLY_FRACTION=0 kullan (sabit boyut)"))
        if ok:
            m.save(Path(out_dir) / f"{target}.json")
            lines.append(f"→ kaydedildi: {out_dir}/{target}.json (tüm foldlarda AUC > 0.55)")
        else:
            p = Path(out_dir) / f"{target}.json"
            if p.exists():
                p.unlink()
            lines.append("→ KAYDEDİLMEDİ: walk-forward'da tutarlı tahmin gücü yok (AUC ≤ 0.55).")
        top = sorted(zip(m.features, m.w), key=lambda x: abs(x[1]), reverse=True)[:8]
        lines.append("   en etkili: " + ", ".join(f"{k}{w:+.2f}" for k, w in top))
    return "\n".join(lines)
