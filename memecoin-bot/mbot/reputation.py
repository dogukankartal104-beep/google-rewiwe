"""Cüzdan + creator itibarı — "whale gördüm" değil, tekrar eden istatistiksel edge.

Her token ufku (horizon) bittiğinde, ilk `rep_early_s` saniyede giren cüzdanların o
tokendaki getirisi hesaplanıp birikime eklenir. Bir tokenın sonucu ancak ufku
bittikten SONRA kullanılabilir → canlıda ve backtest'te look-ahead yok.

Getiri = (satış + kalan tokenın ufuk sonu değeri − alış) / alış, [-1, 10] aralığında.
Skor = Bayes shrink: (Σr + prior·k) / (n + k) — 2 şanslı işlem cüzdanı "akıllı" yapmaz.
"""

from __future__ import annotations

import heapq
from dataclasses import dataclass, field

from . import pumpfun as pf
from .config import Config
from .store import Store, Token, Trade


@dataclass
class TokenOutcome:
    mint: str
    creator: str
    end_ts: int
    wallet_ret: dict[str, float]
    rugged: bool
    graduated: bool


def token_outcome(tok: Token, trades: list[Trade], cfg: Config) -> TokenOutcome:
    end = tok.created_ts + cfg.horizon_s
    trades = [t for t in trades if t.ts <= end]
    early = set()
    seen = set()
    for t in trades:
        if t.is_buy and t.user not in seen:
            seen.add(t.user)
            if t.ts <= tok.created_ts + cfg.rep_early_s:
                early.add(t.user)
    bought: dict[str, int] = {}
    sold: dict[str, int] = {}
    net: dict[str, int] = {}
    for t in trades:
        if t.user not in early:
            continue
        if t.is_buy:
            bought[t.user] = bought.get(t.user, 0) + t.sol
            net[t.user] = net.get(t.user, 0) + t.tok
        else:
            sold[t.user] = sold.get(t.user, 0) + t.sol
            net[t.user] = net.get(t.user, 0) - t.tok
    last_px = pf.price(trades[-1].vsol, trades[-1].vtok) if trades else 0.0
    rets = {}
    for w, b in bought.items():
        if b <= 0:
            continue
        rest = max(0, net.get(w, 0)) / 10**pf.TOKEN_DECIMALS * last_px * pf.LAMPORTS
        r = (sold.get(w, 0) + rest - b) / b
        rets[w] = max(-1.0, min(10.0, r))
    prices = [pf.price(t.vsol, t.vtok) for t in trades]
    rugged = False
    if prices:
        peak_i = max(range(len(prices)), key=prices.__getitem__)
        rugged = min(prices[peak_i:]) <= 0.2 * prices[peak_i]
    graduated = tok.completed_ts is not None and tok.completed_ts <= end
    return TokenOutcome(tok.mint, tok.creator, end, rets, rugged, graduated)


@dataclass
class Reputation:
    cfg: Config
    wallets: dict[str, list] = field(default_factory=dict)  # w → [n, Σr, wins]
    creators: dict[str, list] = field(default_factory=dict)  # c → [n, rugs, grads]
    done: set[str] = field(default_factory=set)
    _pending: list = field(default_factory=list)  # heap (end_ts, seq, outcome)
    _seq: int = 0
    prior: float = 0.0  # tüm cüzdanların ortalama getirisi (shrink hedefi)
    _tot: list = field(default_factory=lambda: [0, 0.0])

    # ------------------------------------------------------------ biriktirme
    def add(self, o: TokenOutcome) -> None:
        if o.mint in self.done:
            return
        self.done.add(o.mint)
        for w, r in o.wallet_ret.items():
            s = self.wallets.setdefault(w, [0, 0.0, 0])
            s[0] += 1
            s[1] += r
            s[2] += r > 0
            self._tot[0] += 1
            self._tot[1] += r
        c = self.creators.setdefault(o.creator, [0, 0, 0])
        c[0] += 1
        c[1] += o.rugged
        c[2] += o.graduated
        self.prior = self._tot[1] / self._tot[0] if self._tot[0] else 0.0

    def defer(self, o: TokenOutcome) -> None:
        """Sonucu bekleyen kuyruğa koy; ufku dolunca `advance` ile eklenir."""
        self._seq += 1
        heapq.heappush(self._pending, (o.end_ts, self._seq, o))

    def advance(self, now_ts: int) -> None:
        while self._pending and self._pending[0][0] <= now_ts:
            self.add(heapq.heappop(self._pending)[2])

    def refresh_from_store(self, store: Store, now_ts: int) -> int:
        n = 0
        for tok in store.tokens_ended_before(now_ts, self.cfg.horizon_s):
            if tok.mint in self.done:
                continue
            self.add(token_outcome(tok, store.trades(tok.mint, tok.created_ts + self.cfg.horizon_s),
                                   self.cfg))
            n += 1
        return n

    # ------------------------------------------------------------ sorgular
    def wallet_score(self, w: str) -> tuple[int, float, float]:
        s = self.wallets.get(w)
        if not s:
            return 0, self.prior, 0.0
        k = self.cfg.rep_prior_k
        return s[0], (s[1] + self.prior * k) / (s[0] + k), s[2] / s[0]

    def is_smart(self, w: str) -> bool:
        n, mean, win = self.wallet_score(w)
        return (n >= self.cfg.rep_min_tokens and mean >= self.cfg.rep_smart_mean
                and win >= self.cfg.rep_smart_winrate)

    def creator_stats(self, c: str) -> tuple[int, float, float]:
        s = self.creators.get(c)
        if not s:
            return 0, 0.0, 0.0
        return s[0], s[1] / s[0], s[2] / s[0]

    def top(self, n: int = 20) -> list[tuple[str, int, float, float]]:
        rows = [(w, *self.wallet_score(w)) for w, s in self.wallets.items()
                if s[0] >= self.cfg.rep_min_tokens]
        return sorted(rows, key=lambda r: r[2], reverse=True)[:n]
