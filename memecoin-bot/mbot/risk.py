"""Risk yöneticisi — sinyalden bağımsız, her zaman son sözü söyler.

Pozisyon boyutu = equity * risk_per_trade. Memecoin sıfıra gidebilir ve stop'lar
gap'ler; bu yüzden pozisyonun TAMAMI risk kabul edilir.
"""

from __future__ import annotations

from datetime import datetime, timezone

from .config import Config


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

    def can_open(self, mint: str, ts: int) -> tuple[bool, str]:
        h = self.halted(ts)
        if h:
            return False, h
        if mint in self.open:
            return False, "zaten pozisyon var"
        if len(self.open) >= self.cfg.max_open:
            return False, "max açık pozisyon"
        if self.size_sol() <= self.cfg.tx_cost_sol * 4:
            return False, "pozisyon maliyete göre çok küçük"
        return True, ""

    def size_sol(self) -> float:
        return max(0.0, self.equity * self.cfg.risk_per_trade)

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
