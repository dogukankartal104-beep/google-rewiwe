"""Token state → özellik vektörü. Hepsi karar anına kadarki veriden (look-ahead yok)."""

from __future__ import annotations

import math
from collections import Counter, defaultdict

from . import pumpfun as pf
from .cohort import build_cohorts
from .store import Funding, Token, Trade

SIZE_BINS = 13  # log2(sol / 0.01 SOL), 0.01 … ~40 SOL


def _entropy(counts: list[int]) -> float:
    n = sum(counts)
    if n < 2:
        return 0.0
    used = [c for c in counts if c]
    h = -sum(c / n * math.log(c / n) for c in used)
    return h / math.log(min(n, SIZE_BINS))


def _hhi(weights: dict[str, float]) -> float:
    tot = sum(weights.values())
    return sum((w / tot) ** 2 for w in weights.values()) if tot > 0 else 1.0


def compute_features(
    token: Token,
    trades: list[Trade],
    fundings: dict[str, Funding],
    now_ts: int,
    hubs: set[str] | None = None,
    size_tol: float = 0.15,
    fresh_wallet_s: int = 86_400,
) -> dict[str, float]:
    hubs = hubs or set()
    buys = [t for t in trades if t.is_buy]
    sells = [t for t in trades if not t.is_buy]
    coh = build_cohorts(token, trades, fundings, hubs, size_tol)

    buy_vol = sum(t.sol for t in buys) / pf.LAMPORTS
    sell_vol = sum(t.sol for t in sells) / pf.LAMPORTS
    buyers = {t.user for t in buys}
    buyer_clusters = {coh.cluster(w) for w in buyers}

    # holdings (sadece curve akışından)
    hold: dict[str, int] = defaultdict(int)
    bought: dict[str, int] = defaultdict(int)
    for t in trades:
        hold[t.user] += t.tok if t.is_buy else -t.tok
        if t.is_buy:
            bought[t.user] += t.tok
    pos = {w: h for w, h in hold.items() if h > 0}
    held = sum(pos.values()) or 1
    top10 = sum(sorted(pos.values(), reverse=True)[:10]) / held
    creator_hold = sum(h for w, h in pos.items() if coh.cluster(w) == coh.creator_cluster) / held

    # cluster bazında alım hacmi
    cl_buy: dict[str, float] = defaultdict(float)
    for t in buys:
        cl_buy[coh.cluster(t.user)] += t.sol
    largest_cluster_share = max(cl_buy.values()) / sum(cl_buy.values()) if cl_buy else 1.0

    # fonlayıcı yoğunluğu (bilinmeyen/köklü cüzdan = kendi başına bir kaynak)
    fund_w: dict[str, float] = defaultdict(float)
    fresh = known = 0
    for t in buys:
        f = fundings.get(t.user)
        src = t.user if (f is None or f.funder in (None, "__deep__") or f.funder in hubs) else f.funder
        fund_w[src] += t.sol
    for w in buyers:
        f = fundings.get(w)
        if f is not None and f.first_ts is not None:
            known += 1
            fresh += token.created_ts - f.first_ts < fresh_wallet_s
    # boyut entropisi
    bins = Counter(
        min(SIZE_BINS - 1, max(0, int(math.log2(max(t.sol, 1) / 1e7)))) for t in buys
    )
    # zamanlama
    bundle = sum(t.sol for t in buys if t.slot == token.created_slot) / pf.LAMPORTS
    slot_users: dict[int, set[str]] = defaultdict(set)
    for t in buys:
        slot_users[t.slot].add(t.user)
    burst = sum(1 for t in buys if len(slot_users[t.slot]) >= 3)

    # round-trip: aldığının yarısından fazlasını zaten satan cüzdanların alım hacmi
    rt_wallets = {w for w in buyers if bought[w] > 0 and hold[w] <= bought[w] * 0.5}
    rt_vol = sum(t.sol for t in buys if t.user in rt_wallets) / pf.LAMPORTS

    # alıcı ivmesi: pencerenin 2. yarısındaki yeni alıcılar / 1. yarı
    mid = token.created_ts + (now_ts - token.created_ts) / 2
    seen: set[str] = set()
    first_half = second_half = 0
    for t in buys:
        if t.user in seen:
            continue
        seen.add(t.user)
        if t.ts <= mid:
            first_half += 1
        else:
            second_half += 1

    last = trades[-1] if trades else None
    rsol = pf.real_sol(last.vsol, last.rsol) / pf.LAMPORTS if last else 0.0
    age = max(1, now_ts - token.created_ts)

    return {
        "age_s": float(age),
        "n_trades": float(len(trades)),
        "n_buys": float(len(buys)),
        "n_sells": float(len(sells)),
        "unique_buyers": float(len(buyers)),
        "effective_buyers": float(len(buyer_clusters)),
        "cohesion": 1 - len(buyer_clusters) / len(buyers) if buyers else 1.0,
        "largest_cluster_buy_share": largest_cluster_share,
        "creator_cluster_hold": creator_hold,
        "top10_share": top10,
        "funder_hhi": _hhi(fund_w),
        "fresh_wallet_share": fresh / known if known else 0.0,
        "funding_coverage": known / len(buyers) if buyers else 0.0,
        "size_entropy": _entropy(list(bins.values())),
        "bundle_share": bundle / buy_vol if buy_vol else 0.0,
        "burst_share": burst / len(buys) if buys else 0.0,
        "repeat_ratio": len(buys) / len(buyers) if buyers else 0.0,
        "round_trip_share": rt_vol / buy_vol if buy_vol else 0.0,
        "buy_vol_sol": buy_vol,
        "sell_vol_sol": sell_vol,
        "net_flow_sol": buy_vol - sell_vol,
        "sell_buy_ratio": sell_vol / buy_vol if buy_vol else 1.0,
        "real_sol": rsol,
        "vol_to_liq": (buy_vol + sell_vol) / max(rsol, 0.1),
        "buyer_accel": second_half / max(1, first_half),
        "new_buyers_per_min": len(buyers) / (age / 60),
        "price_mult": pf.price(last.vsol, last.vtok) / pf.INITIAL_PRICE if last else 1.0,
        "curve_progress": pf.curve_progress(last.vtok) if last else 0.0,
    }
