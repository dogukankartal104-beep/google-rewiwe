"""Pozisyon + çıkış motoru. Hem canlı paper-trading hem etiketleme aynı kodu kullanır,
böylece backtest ile paper arasında kural farkı oluşmaz.

Gerçekçilik kuralları:
  * Stop fiyatından değil, stop'u tetikleyen trade'in rezervlerinden dolarız (gap).
  * Kendi alım/satımımızın fiyat etkisi curve formülüyle hesaplanır.
  * Her tx'e priority fee + Jito tip eklenir.
Bilinen iyimserlik: geçmiş trade'ler bizim işlemimiz yokmuş gibi gerçekleşmiştir.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from . import pumpfun as pf
from .config import Config
from .store import Trade


@dataclass
class Position:
    mint: str
    opened_ts: int
    ref_price: float
    tokens: int
    cost_sol: float
    proceeds_sol: float = 0.0
    peak_mult: float = 1.0
    tp1_done: bool = False
    closed_ts: Optional[int] = None
    exit_reason: str = ""
    watch: dict[str, int] = field(default_factory=dict)  # içeriden cüzdan → tuttuğu token
    watch_total: int = 0
    watch_sold: int = 0

    @property
    def pnl_sol(self) -> float:
        return self.proceeds_sol - self.cost_sol

    @property
    def ret(self) -> float:
        return self.pnl_sol / self.cost_sol if self.cost_sol else 0.0


def open_position(mint: str, size_sol: float, vsol: int, vtok: int, ts: int, cfg: Config,
                  watch: Optional[dict[str, int]] = None) -> Position:
    tokens, _, _ = pf.buy_quote(int(size_sol * pf.LAMPORTS), vsol, vtok, cfg.fee_bps)
    w = dict(watch or {})
    return Position(mint, ts, pf.price(vsol, vtok), tokens, size_sol + cfg.tx_cost_sol,
                    watch=w, watch_total=sum(w.values()))


def _sell(p: Position, tokens: int, vsol: int, vtok: int, cfg: Config) -> None:
    tokens = min(tokens, p.tokens)
    if tokens <= 0:
        return
    out, _, _ = pf.sell_quote(tokens, vsol, vtok, cfg.fee_bps)
    p.tokens -= tokens
    p.proceeds_sol += out / pf.LAMPORTS - cfg.tx_cost_sol


def close(p: Position, vsol: int, vtok: int, ts: int, reason: str, cfg: Config) -> None:
    _sell(p, p.tokens, vsol, vtok, cfg)
    p.closed_ts, p.exit_reason = ts, reason


def on_trade(p: Position, t: Trade, cfg: Config) -> bool:
    """Piyasa trade'i ile pozisyonu güncelle. Kapandıysa True."""
    if p.closed_ts is not None:
        return True
    mult = pf.price(t.vsol, t.vtok) / p.ref_price
    p.peak_mult = max(p.peak_mult, mult)
    if not t.is_buy and t.user in p.watch:
        sold = min(t.tok, p.watch[t.user])
        p.watch[t.user] -= sold
        p.watch_sold += sold
    insider_out = p.watch_total > 0 and p.watch_sold >= cfg.insider_exit_frac * p.watch_total
    if mult <= 1 - cfg.stop_loss:
        close(p, t.vsol, t.vtok, t.ts, "stop", cfg)
    elif insider_out:
        close(p, t.vsol, t.vtok, t.ts, "insider_exit", cfg)
    elif t.ts - p.opened_ts >= cfg.time_stop_s:
        close(p, t.vsol, t.vtok, t.ts, "time", cfg)
    elif not p.tp1_done and mult >= 1 + cfg.tp1:
        _sell(p, int(p.tokens * cfg.tp1_fraction), t.vsol, t.vtok, cfg)
        p.tp1_done = True
    elif p.tp1_done and mult <= p.peak_mult * (1 - cfg.trailing):
        close(p, t.vsol, t.vtok, t.ts, "trail", cfg)
    return p.closed_ts is not None


def expected_tokens(size_sol: float, vsol: int, vtok: int, cfg: Config) -> int:
    return pf.buy_quote(int(size_sol * pf.LAMPORTS), vsol, vtok, cfg.fee_bps)[0]


def slipped(size_sol: float, decision: Trade, fill: Trade, cfg: Config) -> bool:
    """Pump.fun buy emrindeki max_sol_cost tavanının karşılığı: karar anında beklenen
    token miktarının 1/(1+slip)'inden azı gelecekse emir başarısız olur (dolmayız)."""
    want = expected_tokens(size_sol, decision.vsol, decision.vtok, cfg)
    got = expected_tokens(size_sol, fill.vsol, fill.vtok, cfg)
    return got * (1 + cfg.max_entry_slippage) < want


def simulate(
    mint: str,
    decision_trade: Trade,
    after: list[Trade],
    size_sol: float,
    horizon_end_ts: int,
    cfg: Config,
    watch: Optional[dict[str, int]] = None,
) -> Optional[Position]:
    """Karar anından sonraki trade akışında stratejiyi oynat (etiketleme/backtest)."""
    if cfg.latency_trades <= 0:
        fill, rest = decision_trade, after
    else:
        if len(after) < cfg.latency_trades:
            return None  # kimse işlem yapmadı → dolamazdık
        fill, rest = after[cfg.latency_trades - 1], after[cfg.latency_trades :]
    if slipped(size_sol, decision_trade, fill, cfg):
        return None
    p = open_position(mint, size_sol, fill.vsol, fill.vtok, fill.ts, cfg, watch)
    last = fill
    for t in rest:
        if t.ts > horizon_end_ts:
            break
        last = t
        if on_trade(p, t, cfg):
            return p
    close(p, last.vsol, last.vtok, last.ts, "horizon", cfg)
    return p
