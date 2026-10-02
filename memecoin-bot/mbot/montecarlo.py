"""Monte Carlo risk analizi: "Bu stratejiyle kötü bir ayda ne kadar kaybedebilirim?"

Gerçekleşmiş işlem getirileri (backtest BUY'ları veya paper işlemler) blok bootstrap
ile binlerce kez yeniden örneklenir. Blok örnekleme, art arda gelen kayıp serilerini
(memecoin'de rejimler kümelenir) tek tek karıştırmaktan daha iyi korur.

Her işlemde pozisyon = equity × risk_per_trade, getiri = pozisyon × r (bileşik).
"""

from __future__ import annotations

import random
from dataclasses import dataclass


@dataclass
class MCResult:
    risk: float
    n_trades: int
    ret_p5: float
    ret_p50: float
    ret_p95: float
    dd_p50: float
    dd_p95: float
    dd_p99: float
    streak_p50: int
    streak_p95: int
    p_loss: float  # dönemi zararla bitirme olasılığı
    p_ruin: float  # equity'nin yarısını kaybetme olasılığı


def _q(xs: list, q: float):
    s = sorted(xs)
    return s[min(len(s) - 1, int(q * len(s)))]


def simulate(rets: list[float], n_trades: int, risk: float, sims: int = 5000,
             block: int = 5, seed: int = 0) -> MCResult:
    if not rets:
        raise ValueError("getiri yok")
    rnd = random.Random(seed)
    n = len(rets)
    block = max(1, min(block, n))
    finals, dds, streaks, ruin = [], [], [], 0
    for _ in range(sims):
        eq = peak = 1.0
        max_dd = 0.0
        streak = best_streak = 0
        done = 0
        while done < n_trades:
            start = rnd.randrange(n)
            for k in range(block):
                if done >= n_trades:
                    break
                r = rets[(start + k) % n]
                eq += eq * risk * r
                done += 1
                peak = max(peak, eq)
                max_dd = max(max_dd, 1 - eq / peak)
                streak = streak + 1 if r < 0 else 0
                best_streak = max(best_streak, streak)
        finals.append(eq - 1)
        dds.append(max_dd)
        streaks.append(best_streak)
        ruin += eq <= 0.5
    return MCResult(
        risk, n_trades, _q(finals, 0.05), _q(finals, 0.5), _q(finals, 0.95),
        _q(dds, 0.5), _q(dds, 0.95), _q(dds, 0.99), _q(streaks, 0.5), _q(streaks, 0.95),
        sum(f < 0 for f in finals) / sims, ruin / sims,
    )


def max_safe_risk(rets: list[float], n_trades: int, max_dd: float, sims: int = 2000,
                  grid: tuple = (0.0025, 0.005, 0.01, 0.02, 0.03, 0.05, 0.1)) -> float | None:
    """p95 drawdown'u max_dd altında tutan en büyük işlem başı risk."""
    best = None
    for r in grid:
        if simulate(rets, n_trades, r, sims).dd_p95 <= max_dd:
            best = r
        else:
            break
    return best


def report(rets: list[float], n_trades: int, risk: float, max_dd: float = 0.20,
           sims: int = 5000, block: int = 5, kill_after: int | None = None) -> str:
    if len(rets) < 30:
        return f"Sadece {len(rets)} işlem var; anlamlı Monte Carlo için en az 30 gerekli."
    res = simulate(rets, n_trades, risk, sims, block)
    lines = [
        f"== Monte Carlo: {len(rets)} gerçekleşmiş işlemden {sims} senaryo, "
        f"dönem başına {n_trades} işlem, işlem başı risk %{risk * 100:.2f} ==",
        f"Dönem getirisi   kötü (%5): {res.ret_p5:+.1%}   tipik: {res.ret_p50:+.1%}   "
        f"iyi (%95): {res.ret_p95:+.1%}",
        f"Max drawdown     tipik: {res.dd_p50:.1%}   kötü (%5): {res.dd_p95:.1%}   "
        f"çok kötü (%1): {res.dd_p99:.1%}",
        f"Art arda kayıp   tipik: {res.streak_p50}   kötü (%5): {res.streak_p95}",
        f"Dönemi zararla bitirme olasılığı: {res.p_loss:.1%}",
        f"Sermayenin yarısını kaybetme olasılığı: {res.p_ruin:.2%}",
    ]
    safe = max_safe_risk(rets, n_trades, max_dd)
    lines.append("")
    if safe is None:
        lines.append(f"⚠ En düşük riskte bile %5 ihtimalle drawdown %{max_dd * 100:.0f}'yi aşıyor. "
                     "Bu strateji bu haliyle canlıya uygun değil.")
    else:
        lines.append(f"Kötü senaryoda (p95) drawdown'u %{max_dd * 100:.0f} altında tutan en büyük "
                     f"işlem başı risk: %{safe * 100:.2f}  →  export MBOT_RISK_PER_TRADE={safe}")
    if kill_after is not None and res.streak_p95 >= kill_after:
        lines.append(f"⚠ %5 ihtimalle {res.streak_p95} art arda kayıp normal, ama kill switch "
                     f"{kill_after}'de duruyor → kârlı stratejiyi bile durdurur. Öneri: "
                     f"export MBOT_MAX_CONSECUTIVE_LOSSES={res.streak_p95 + 3}")
    elif res.streak_p95 >= 1:
        lines.append(f"Not: {res.streak_p95} art arda kayıp normal kabul edilmeli.")
    if res.ret_p50 <= 0:
        lines.append("⚠ Tipik senaryo zararda: risk ayarı bunu düzeltmez, önce edge lazım.")
    return "\n".join(lines)
