"""Çıkış kuralı optimizasyonu — en iyi görüneni değil, zaman içinde dayananı seç.

Walk-forward: geçmiş dilimde en iyi parametreyi bul → bir sonraki (görülmemiş) dilimde
test et. Amaç fonksiyonu kırpılmış ortalama: en iyi %5 işlem atılır, böylece tek bir
100x'e dayanan parametre seti kazanamaz.
"""

from __future__ import annotations

import itertools
import statistics
from collections import Counter
from dataclasses import replace

from .config import Config
from .dataset import Case
from .paper import simulate
from .risk import position_size

GRID = {
    "stop_loss": [0.2, 0.3, 0.4, 0.5],
    "tp1": [0.3, 0.6, 1.0, 2.0],
    "tp1_fraction": [0.3, 0.5, 0.7],
    "trailing": [0.15, 0.25, 0.4],
    "time_stop_s": [300, 900, 1800],
}


def combos(grid: dict = GRID) -> list[dict]:
    keys = list(grid)
    return [dict(zip(keys, vals)) for vals in itertools.product(*grid.values())]


def returns(cases: list[Case], cfg: Config) -> list[float]:
    out = []
    for c in cases:
        size = position_size(cfg.equity_sol, cfg, c.f["real_sol"])
        p = simulate(c.tok.mint, c.decision_trade, c.after, size, c.end_ts, cfg, c.watch)
        if p is not None:
            out.append(p.ret)
    return out


def objective(rets: list[float]) -> float:
    if not rets:
        return float("-inf")
    srt = sorted(rets)
    cut = max(1, len(srt) // 20)
    kept = srt[:-cut] if len(srt) > cut else srt
    return statistics.fmean(kept)


def _fmt(rets: list[float]) -> str:
    if not rets:
        return "n=0"
    return (f"n={len(rets):4d} win={sum(r > 0 for r in rets) / len(rets):5.1%} "
            f"ort={statistics.fmean(rets):+7.2%} kırpılmış={objective(rets):+7.2%}")


def best(cases: list[Case], cfg: Config, grid: dict = GRID) -> tuple[dict, float]:
    scored = [(objective(returns(cases, replace(cfg, **p))), p) for p in combos(grid)]
    sc, p = max(scored, key=lambda x: x[0])
    return p, sc


def walk_forward(cases: list[Case], cfg: Config, folds: int = 4, grid: dict = GRID) -> str:
    cases = sorted(cases, key=lambda c: c.tok.created_ts)
    size = len(cases) // (folds + 1)
    if size < 10:
        return (f"Sadece {len(cases)} aday var; walk-forward için en az {(folds + 1) * 10} "
                "gerekli. Daha fazla veri topla veya --include-watch kullan.")
    lines = ["== Çıkış kuralı walk-forward (geçmişte seç → gelecekte test) =="]
    chosen: list[tuple] = []
    oos_best: list[float] = []
    oos_default: list[float] = []
    for k in range(1, folds + 1):
        train, test = cases[: k * size], cases[k * size : (k + 1) * size]
        p, sc = best(train, cfg, grid)
        r_best, r_def = returns(test, replace(cfg, **p)), returns(test, cfg)
        oos_best += r_best
        oos_default += r_def
        chosen.append(tuple(sorted(p.items())))
        lines.append(f"fold {k}: seçilen {p}")
        lines.append(f"   train kırpılmış={sc:+.2%} | TEST seçilen: {_fmt(r_best)}")
        lines.append(f"   {'':24s}TEST mevcut ayar: {_fmt(r_def)}")
    lines.append("\nToplam görülmemiş veri:")
    lines.append(f"  seçilen parametreler: {_fmt(oos_best)}")
    lines.append(f"  mevcut ayarlar      : {_fmt(oos_default)}")
    freq = Counter(chosen).most_common(1)[0]
    final, _ = best(cases, cfg, grid)
    lines.append(f"\nFoldlarda en sık seçilen: {dict(freq[0])} ({freq[1]}/{folds})")
    lines.append(f"Tüm veride en iyi: {final}")
    if objective(oos_best) > objective(oos_default):
        lines.append("\nGörülmemiş veride mevcut ayarlardan iyi. Uygulamak için:")
        lines += [f"  export MBOT_{k.upper()}={v}" for k, v in final.items()]
    else:
        lines.append("\nGörülmemiş veride mevcut ayarları GEÇEMEDİ → değiştirme (overfit).")
    return "\n".join(lines)


def latency_report(cases: list[Case], cfg: Config, lags: tuple = (0, 1, 2, 3, 5, 8)) -> str:
    """Edge hızdan mı geliyor? Girişi N trade geciktir; kâr hızla eriyorsa edge snipe
    edge'idir ve yavaş bir bot için gerçek değildir."""
    if not cases:
        return "Aday yok."
    lines = ["== Gecikme duyarlılığı (giriş N trade sonra dolarsa) =="]
    base = None
    res = {}
    for lag in lags:
        lc = replace(cfg, latency_trades=lag)
        rets = returns(cases, lc)
        fill = len(rets) / len(cases)
        obj = objective(rets)
        res[lag] = obj
        base = obj if base is None else base
        lines.append(f"gecikme {lag:2d} trade: dolum={fill:5.1%}  {_fmt(rets)}")
    tail = res[lags[min(3, len(lags) - 1)]]
    lines.append("")
    if tail <= 0 < base:
        lines.append(f"⚠ Edge {lags[min(3, len(lags) - 1)]} trade gecikmede yok oluyor → hız edge'i. "
                     "Profesyonel snipe altyapısı olmadan bu edge senin değil. CANLIYA GEÇME.")
    elif tail > 0:
        lines.append("✓ Edge gecikmeye dayanıklı: hızdan değil bilgiden geliyor.")
    else:
        lines.append("Gecikme 0'da bile kârlı değil → önce filtre/skor tarafını düzelt.")
    return "\n".join(lines)
