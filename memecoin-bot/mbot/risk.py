"""Risk yöneticisi — sinyalden bağımsız, her zaman son sözü söyler.

Pozisyon boyutu = equity * risk_per_trade. Memecoin sıfıra gidebilir ve stop'lar
gap'ler; bu yüzden pozisyonun TAMAMI risk kabul edilir.
"""

from __future__ import annotations

from datetime import datetime, timezone

from .config import Config


def position_size(equity: float, cfg: Config, real_sol: float | None = None,
                  p_win: float | None = None, payoff: float | None = None) -> float:
    """Risk bütçesi ile çıkış likiditesinin küçüğü: büyük pozisyon sığ curve'de kendi
    satışıyla fiyatı çökertir.

    Eğitilmiş model varsa güvene göre boyut: Kelly f* = p − (1−p)/b (b = ort. kazanç /
    ort. kayıp). Tam Kelly memecoin'de iflas ettirir; `kelly_fraction` kadarı alınır,
    [risk_per_trade/2, max_risk_per_trade] aralığında tutulur."""
    base = max(0.0, equity * cfg.risk_per_trade)
    size = base
    if p_win is not None and payoff and cfg.kelly_fraction > 0:
        k = p_win - (1 - p_win) / payoff
        size = base * 0.5 if k <= 0 else equity * cfg.kelly_fraction * k
        size = min(max(size, base * 0.5), equity * cfg.max_risk_per_trade)
    if real_sol is not None:
        size = min(size, cfg.max_liq_frac * real_sol)
    return size


def _day(ts: int) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d")


class RiskManager:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.equity = cfg.equity_sol
        self.open: dict[str, float] = {}
        self.day = ""
        self.day_start_equity = self.equity
        self.day_pnl = 0.0
        self.consec_losses = 0
        self.killed: str | None = None  # manuel reset gerekir

    def _roll(self, ts: int) -> None:
        d = _day(ts)
        if d != self.day:
            self.day, self.day_start_equity, self.day_pnl = d, self.equity, 0.0

    def halted(self, ts: int) -> str | None:
        self._roll(ts)
        if self.killed:
            return self.killed
        if self.day_pnl <= -self.cfg.daily_loss_limit * self.day_start_equity:
            return "günlük kayıp limiti"
        return None

    def can_open(self, mint: str, ts: int, real_sol: float | None = None,
                 p_win: float | None = None, payoff: float | None = None) -> tuple[bool, str]:
        h = self.halted(ts)
        if h:
            return False, h
        if mint in self.open:
            return False, "zaten pozisyon var"
        if len(self.open) >= self.cfg.max_open:
            return False, "max açık pozisyon"
        if self.size_sol(real_sol, p_win, payoff) <= self.cfg.tx_cost_sol * 4:
            return False, "pozisyon maliyete/likiditeye göre çok küçük"
        return True, ""

    def size_sol(self, real_sol: float | None = None, p_win: float | None = None,
                 payoff: float | None = None) -> float:
        return position_size(self.equity, self.cfg, real_sol, p_win, payoff)

    def on_open(self, mint: str, cost_sol: float) -> None:
        self.open[mint] = cost_sol

    def on_close(self, mint: str, pnl_sol: float, ts: int) -> None:
        self._roll(ts)
        self.open.pop(mint, None)
        self.equity += pnl_sol
        self.day_pnl += pnl_sol
        self.consec_losses = self.consec_losses + 1 if pnl_sol < 0 else 0
        if self.consec_losses >= self.cfg.max_consecutive_losses:
            self.killed = f"{self.consec_losses} ardışık kayıp — kill switch"

    def reset_kill(self) -> None:
        self.killed, self.consec_losses = None, 0
