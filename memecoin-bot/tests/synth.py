"""Sentetik pump.fun senaryoları: gerçek curve matematiğiyle trade akışı üretir."""

from __future__ import annotations

import random
from dataclasses import replace

from mbot import pumpfun as pf
from mbot.store import Funding, Store, Token, Trade

T0 = 1_780_000_000
SLOT0 = 400_000_000


def run_curve(mint: str, orders: list[tuple[int, int, str, bool, float]], fee_bps: int = 100) -> list[Trade]:
    """orders: (slot, ts, user, is_buy, amount) — buy: SOL, sell: tutulan tokenın oranı."""
    vsol, vtok = pf.INITIAL_VIRTUAL_SOL, pf.INITIAL_VIRTUAL_TOKEN
    hold: dict[str, int] = {}
    out = []
    for i, (slot, ts, user, is_buy, amt) in enumerate(sorted(orders, key=lambda o: o[0])):
        if is_buy:
            lam = int(amt * pf.LAMPORTS)
            tok, vsol, vtok = pf.buy_quote(lam, vsol, vtok, fee_bps)
            hold[user] = hold.get(user, 0) + tok
            out.append(Trade(slot, ts, mint, user, True, lam, tok, vsol, vtok, None, f"s{i}", 0))
        else:
            tok = int(hold.get(user, 0) * amt)
            if tok <= 0:
                continue
            sol, vsol, vtok = pf.sell_quote(tok, vsol, vtok, fee_bps)
            hold[user] -= tok
            out.append(Trade(slot, ts, mint, user, False, sol, tok, vsol, vtok, None, f"s{i}", 0))
    return out


def _tail(orders: list, rnd: random.Random, n: int, sell_users: list[str]) -> None:
    """Karar anından (120 s) sonra akış: yeni alıcılar + verilen cüzdanların satışları."""
    for i in range(n):
        slot = SLOT0 + 330 + i * 25
        orders.append((slot, T0 + (slot - SLOT0) * 2 // 5, f"late{i}", True, 0.3))
    for j, w in enumerate(sell_users):
        slot = SLOT0 + 340 + j * 7
        orders.append((slot, T0 + (slot - SLOT0) * 2 // 5, w, False, 1.0))


def organic(mint: str = "ORG", seed: int = 1, n: int = 70, tail: int = 0) -> tuple[Token, list[Trade], dict[str, Funding]]:
    rnd = random.Random(seed)
    tok = Token(mint, "Organic", "ORG", "creatorO", SLOT0, T0)
    orders = [(SLOT0, T0, "creatorO", True, 0.4)]
    fund = {"creatorO": Funding("creatorO", "__deep__", 0, T0 - 90 * 86_400)}
    for i in range(n):
        # ivmelenen geliş: ikinci yarıda daha yoğun
        frac = rnd.random() ** 0.7
        slot = SLOT0 + 5 + int(frac * 295)
        w = f"o{i}"
        orders.append((slot, T0 + (slot - SLOT0) * 2 // 5, w, True, round(rnd.lognormvariate(-1.2, 1.0), 3)))
        fund[w] = Funding(w, f"funder{i}" if i % 3 else "__deep__", 10**9,
                          T0 - rnd.randint(3, 400) * 86_400)
        if rnd.random() < 0.12:
            s2 = min(SLOT0 + 299, slot + rnd.randint(5, 60))
            orders.append((s2, T0 + (s2 - SLOT0) * 2 // 5, w, False, 0.5))
    if tail:
        _tail(orders, rnd, tail, [])
    return tok, run_curve(mint, orders), fund


def manipulated(mint: str = "MAN", seed: int = 2, tail: int = 0) -> tuple[Token, list[Trade], dict[str, Funding]]:
    rnd = random.Random(seed)
    tok = Token(mint, "Pump", "PUMP", "creatorM", SLOT0, T0)
    orders = [(SLOT0, T0, "creatorM", True, 1.5)]
    fund = {"creatorM": Funding("creatorM", "devfunder", 5 * 10**9, T0 - 3600),
            "hub": Funding("hub", "creatorM", 50 * 10**9, T0 - 3000)}
    for i in range(12):  # launch bundle
        orders.append((SLOT0, T0, f"b{i}", True, 0.8))
        fund[f"b{i}"] = Funding(f"b{i}", "hub", 10**9, T0 - 1800)
    for burst in range(6):  # aynı slot + aynı boyut patlamaları
        slot = SLOT0 + 20 + burst * 40
        for j in range(4):
            w = f"w{burst}_{j}"
            orders.append((slot, T0 + (slot - SLOT0) * 2 // 5, w, True, 1.0 + rnd.random() * 0.05))
            fund[w] = Funding(w, "hub", 10**9, T0 - 1200)
            s2 = slot + 15
            orders.append((s2, T0 + (s2 - SLOT0) * 2 // 5, w, False, 1.0))  # round-trip
    for i in range(6):
        slot = SLOT0 + 10 + i * 45
        orders.append((slot, T0 + (slot - SLOT0) * 2 // 5, f"r{i}", True, 0.2))
        fund[f"r{i}"] = Funding(f"r{i}", f"rf{i}", 10**9, T0 - 200 * 86_400)
    if tail:  # creator + bundle cüzdanları boşaltır
        _tail(orders, rnd, tail, ["creatorM"] + [f"b{i}" for i in range(12)])
    return tok, run_curve(mint, orders), fund


def load(store: Store, tok: Token, trades: list[Trade], fund: dict[str, Funding]) -> None:
    store.db.execute(
        "INSERT INTO tokens (mint,name,symbol,uri,creator,bonding_curve,created_slot,created_ts)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (tok.mint, tok.name, tok.symbol, "", tok.creator, "", tok.created_slot, tok.created_ts),
    )
    for t in trades:
        store.add_trade(replace(t, sig=t.sig + tok.mint))
    for f in fund.values():
        store.put_funding(f, T0)
    store.commit()


def late_bloomer(mint: str = "LATE", seed: int = 7) -> tuple[Token, list[Trade], dict[str, Funding]]:
    """İlk 2 dakikada sessiz, 5. dakikaya doğru organik talep alan token."""
    rnd = random.Random(seed)
    tok = Token(mint, "Late Bloom", "LATE", "creatorL", SLOT0, T0)
    orders = [(SLOT0, T0, "creatorL", True, 0.3)]
    fund = {"creatorL": Funding("creatorL", "__deep__", 0, T0 - 90 * 86_400)}
    for i in range(6):
        slot = SLOT0 + 20 + i * 40
        orders.append((slot, T0 + (slot - SLOT0) * 2 // 5, f"e{i}", True, 0.2))
        fund[f"e{i}"] = Funding(f"e{i}", f"ef{i}", 1, T0 - 50 * 86_400)
    for i in range(60):
        slot = SLOT0 + 330 + int(rnd.random() * 400)
        w = f"l{i}"
        orders.append((slot, T0 + (slot - SLOT0) * 2 // 5, w, True, round(rnd.lognormvariate(-1.6, 0.8), 3)))
        fund[w] = Funding(w, f"lf{i}" if i % 3 else "__deep__", 1, T0 - rnd.randint(3, 300) * 86_400)
    for i in range(20):
        slot = SLOT0 + 800 + i * 30
        orders.append((slot, T0 + (slot - SLOT0) * 2 // 5, f"z{i}", True, 0.3))
    return tok, run_curve(mint, orders), fund
