"""Wallet → davranışsal cohort. 15 bağlantılı cüzdan = 1 alıcı.

Bağ kuralları (union-find):
  1. Aynı fonlayıcı (hub değilse)
  2. Doğrudan fonlama: A, B'yi fonladı
  3. Launch slot'unda alım (creator ile bundle) → creator cluster'ı
  4. Aynı slot'ta ±tol boyutta alım yapan farklı cüzdanlar (bundle imzası)
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from .store import Funding, Token, Trade

NON_LINKING = {None, "__deep__"}


class _UF:
    def __init__(self) -> None:
        self.p: dict[str, str] = {}

    def find(self, x: str) -> str:
        self.p.setdefault(x, x)
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[rb] = ra


@dataclass
class Cohorts:
    of: dict[str, str]  # wallet → cluster id
    members: dict[str, set[str]]
    creator_cluster: str

    def cluster(self, wallet: str) -> str:
        return self.of.get(wallet, wallet)


def build_cohorts(
    token: Token,
    trades: list[Trade],
    fundings: dict[str, Funding],
    hubs: set[str],
    size_tol: float = 0.15,
) -> Cohorts:
    uf = _UF()
    wallets = {t.user for t in trades} | {token.creator}
    for w in wallets:
        uf.find(w)

    # 1 + 2: fonlama grafiği
    by_funder: dict[str, list[str]] = defaultdict(list)
    for w in wallets:
        f = fundings.get(w)
        if f is None or f.funder in NON_LINKING or f.funder in hubs:
            continue
        by_funder[f.funder].append(w)
        if f.funder in wallets:
            uf.union(f.funder, w)
    for group in by_funder.values():
        for w in group[1:]:
            uf.union(group[0], w)

    # 3 + 4: slot bazlı bundle imzası
    buys_by_slot: dict[int, list[Trade]] = defaultdict(list)
    for t in trades:
        if t.is_buy:
            buys_by_slot[t.slot].append(t)
    for slot, buys in buys_by_slot.items():
        if slot == token.created_slot:
            for t in buys:
                uf.union(token.creator, t.user)
            continue
        distinct = {t.user for t in buys}
        if len(distinct) < 3:
            continue
        buys = sorted(buys, key=lambda t: t.sol)
        for a, b in zip(buys, buys[1:]):
            if a.user != b.user and b.sol <= a.sol * (1 + size_tol):
                uf.union(a.user, b.user)

    of = {w: uf.find(w) for w in wallets}
    members: dict[str, set[str]] = defaultdict(set)
    for w, c in of.items():
        members[c].add(w)
    return Cohorts(of, dict(members), of[token.creator])
