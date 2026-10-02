"""Cüzdan + creator itibarı — "whale gördüm" değil, tekrar eden istatistiksel edge.

Her token ufku (horizon) bittiğinde, ilk `rep_early_s` saniyede giren cüzdanların o
tokendaki getirisi hesaplanıp birikime eklenir. Bir tokenın sonucu ancak ufku
bittikten SONRA kullanılabilir → canlıda ve backtest'te look-ahead yok.

Getiri = (satış + kalan tokenın ufuk sonu değeri − alış) / alış, [-1, 10] aralığında.
Skor = Bayes shrink: (Σr + prior·k) / (n + k) — 2 şanslı işlem cüzdanı "akıllı" yapmaz.
"""

from __future__ import annotations

import heapq
import re
from collections import defaultdict, deque
from dataclasses import dataclass, field

from . import pumpfun as pf
from .config import Config
from .store import Store, Token, Trade


STOPWORDS = {"the", "coin", "token", "sol", "solana", "pump", "fun", "and", "for", "official",
             "new", "first", "real", "meme", "inu"}


def name_words(name: str, symbol: str) -> frozenset[str]:
    """Anlatı anahtar kelimeleri: isim + sembolden 3+ harfli küçük harf kelimeler."""
    text = f"{name or ''} {symbol or ''}".lower()
    return frozenset(w for w in re.findall(r"[a-z0-9]{3,}", text) if w not in STOPWORDS)


@dataclass
class TokenOutcome:
    mint: str
    creator: str
    end_ts: int
    wallet_ret: dict[str, float]
    rugged: bool
    graduated: bool
    words: frozenset = frozenset()


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
    return TokenOutcome(tok.mint, tok.creator, end, rets, rugged, graduated,
                        name_words(tok.name, tok.symbol))


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
    _recent: deque = field(default_factory=deque)  # (end_ts, rugged, graduated)
    _words: dict = field(default_factory=lambda: defaultdict(deque))  # kelime → (end, grad, ret)

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
        self._recent.append((o.end_ts, o.rugged, o.graduated))
        early = sum(o.wallet_ret.values()) / len(o.wallet_ret) if o.wallet_ret else 0.0
        for w in o.words:
            self._words[w].append((o.end_ts, o.graduated, early))
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

    def regime(self, now_ts: int) -> tuple[int, float, float]:
        """Son `regime_window_s` içinde ufku biten tokenlar: (sayı, rug oranı, grad oranı)."""
        lo = now_ts - self.cfg.regime_window_s
        while self._recent and self._recent[0][0] < lo:
            self._recent.popleft()
        win = [r for r in self._recent if r[0] <= now_ts]
        if not win:
            return 0, 0.0, 0.0
        return len(win), sum(r[1] for r in win) / len(win), sum(r[2] for r in win) / len(win)

    def narrative(self, words: frozenset, now_ts: int, min_n: int = 5) -> tuple[int, float, float]:
        """İsmi aynı kelimeyi taşıyan, son pencerede ufku biten tokenlar içinde en kalabalık
        kelimenin (sayı, graduation oranı, erken alıcı ort. getirisi).
        Sorgular zaman sıralı yapılmalı: pencereden çıkan kayıtlar kalıcı silinir."""
        lo = now_ts - self.cfg.narrative_window_s
        best = (0, 0.0, 0.0)
        for w in words:
            dq = self._words.get(w)
            if not dq:
                continue
            while dq and dq[0][0] < lo:
                dq.popleft()
            n = len(dq)
            if n >= min_n and n > best[0]:
                best = (n, sum(x[1] for x in dq) / n, sum(x[2] for x in dq) / n)
        return best

    def top(self, n: int = 20) -> list[tuple[str, int, float, float]]:
        rows = [(w, *self.wallet_score(w)) for w, s in self.wallets.items()
                if s[0] >= self.cfg.rep_min_tokens]
        return sorted(rows, key=lambda r: r[2], reverse=True)[:n]
