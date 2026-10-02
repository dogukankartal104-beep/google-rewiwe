"""Faz 0→2 köprüsü: karar anı özellikleri + gerçekleşen sonuç etiketleri → CSV,
ve skorların gerçekten tahmin gücü olup olmadığını gösteren rapor."""

from __future__ import annotations

import csv
import heapq
import statistics
from dataclasses import dataclass, field
from typing import Callable, Iterable, Optional

from . import pumpfun as pf
from .cohort import build_cohorts
from .config import Config
from .features import compute_features, insider_watch
from .paper import simulate
from .reputation import Reputation, token_outcome
from .risk import position_size
from .scoring import Verdict, evaluate, score
from .store import Store, Token, Trade


@dataclass
class Case:
    tok: Token
    f: dict[str, float]
    verdict: Verdict
    decision_trade: Trade
    after: list[Trade]
    end_ts: int
    watch: dict[str, int]
    decision_ts: int = 0
    trigger: str = "cp"  # cp = sabit karar anı, smart = akıllı cüzdan alımı tetikledi
    entry: bool = False  # stratejinin bu tokena girdiği değerlendirme
    final: bool = False  # tokenın strateji açısından son değerlendirmesi
    rescore: Optional[Callable[[int], bool]] = field(default=None, repr=False)


def make_rescorer(store: Store, cfg: Config, tok: Token, trades: list[Trade],
                  t_d: int) -> Callable[[int], bool]:
    """Pozisyon açıkken her `rescore_s`'de skorları yeniden hesaplar. İtibar kullanmaz
    (sonradan biriken itibar look-ahead olurdu); sonuçlar zaman dilimine göre önbelleklenir."""
    cache: dict[int, bool] = {}

    def check(ts: int) -> bool:
        b = (ts - t_d) // cfg.rescore_s
        if b <= 0:
            return False
        if b not in cache:
            cut = t_d + b * cfg.rescore_s
            tr = [t for t in trades if t.ts <= cut]
            users = {t.user for t in tr} | {tok.creator}
            fund = store.fundings_closure(users, cfg.funding_depth)
            f = compute_features(tok, tr, fund, cut, cfg.hubs, cfg.same_slot_size_tol,
                                 cfg.fresh_wallet_s, cfg.funding_depth)
            o, m, _ = score(f)
            cache[b] = o < cfg.rescore_exit_organic or m > cfg.rescore_exit_manip
        return cache[b]

    return check


def make_case(store: Store, cfg: Config, tok: Token, trades: list[Trade],
              rep: Reputation | None, t_d: Optional[int] = None,
              trigger: str = "cp") -> Case | None:
    """Tek token için `t_d` anındaki karar durumu (trades: en az t_d + horizon'a kadar)."""
    t_d = t_d if t_d is not None else tok.created_ts + cfg.ages[0]
    end = t_d + cfg.horizon_s
    before = [t for t in trades if t.ts <= t_d]
    after = [t for t in trades if t_d < t.ts <= end]
    if len(before) < 3:
        return None
    users = {t.user for t in before} | {tok.creator}
    fundings = store.fundings_closure(users, cfg.funding_depth)
    coh = build_cohorts(tok, before, fundings, cfg.hubs, cfg.same_slot_size_tol,
                        cfg.funding_depth)
    f = compute_features(tok, before, fundings, t_d, cfg.hubs, cfg.same_slot_size_tol,
                         cfg.fresh_wallet_s, cfg.funding_depth, rep, coh)
    return Case(tok, f, evaluate(tok, f, store, cfg), before[-1], after, end,
                insider_watch(tok, before, coh, rep), t_d, trigger,
                rescore=make_rescorer(store, cfg, tok, trades, t_d))


def iter_cases(store: Store, cfg: Config, t0: int, t1: int, use_rep: bool = True,
               all_checkpoints: bool = False):
    """Olay sıralı backtest. Her token için `cfg.ages` karar anları + (itibar açıksa)
    akıllı cüzdan alımları tek bir zaman çizelgesinde işlenir; itibar her olayda sadece
    o ana kadar ufku bitmiş tokenları bilir → look-ahead yok.

    Varsayılan (strateji modu): token başına ilk BUY değerlendirmesi (entry) veya hiç
    BUY olmadıysa son karar anı (final) döner. all_checkpoints=True: tüm değerlendirmeler
    (model eğitimi için), entry/final işaretli."""
    ages = cfg.ages
    max_age = ages[-1]
    rep = Reputation(cfg) if use_rep else None
    if rep is not None:
        rep.refresh_from_store(store, t0)
    heap: list = []
    seq = 0

    def push(ts: int, kind: str, mint: str, payload=None) -> None:
        nonlocal seq
        seq += 1
        heapq.heappush(heap, (ts, seq, kind, mint, payload))

    toks = {}
    for tok in store.tokens_created_between(t0, t1):
        toks[tok.mint] = tok
        push(tok.created_ts, "load", tok.mint)
        for a in ages:
            push(tok.created_ts + a, "cp", tok.mint, a)
    trades_of: dict[str, list[Trade]] = {}
    cps_left = {m: len(ages) for m in toks}
    entered: set[str] = set()
    last_eval: dict[str, int] = {}

    while heap:
        ts, _, kind, mint, payload = heapq.heappop(heap)
        if rep is not None:
            rep.advance(ts)
        tok = toks[mint]
        if kind == "load":
            tr = store.trades(mint, until_ts=tok.created_ts + max_age + cfg.horizon_s)
            trades_of[mint] = tr
            if rep is not None:
                rep.defer(token_outcome(tok, tr, cfg))
                if cfg.smart_trigger:
                    lo, hi = tok.created_ts + cfg.smart_trigger_min_age_s, tok.created_ts + max_age
                    for t in tr:
                        if t.is_buy and lo <= t.ts < hi and t.user in rep.wallets:
                            push(t.ts, "smart", mint, t.user)
            continue
        if kind == "cp":
            cps_left[mint] -= 1
        done = cps_left[mint] == 0
        if mint in entered and not all_checkpoints:
            if done:
                trades_of.pop(mint, None)
            continue
        if kind == "smart":
            if mint in entered or not rep.is_smart(payload):
                continue
            if ts - last_eval.get(mint, -10**12) < cfg.eval_cooldown_s:
                continue
        c = make_case(store, cfg, tok, trades_of[mint], rep, ts, kind)
        last_eval[mint] = ts
        if c is not None:
            if mint not in entered and c.verdict.decision == "BUY":
                entered.add(mint)
                c.entry = c.final = True
            elif mint not in entered and kind == "cp" and done:
                c.final = True
            if all_checkpoints or c.final:
                yield c
        if done:
            trades_of.pop(mint, None)


def build_rows(store: Store, cfg: Config, t0: int, t1: int) -> list[dict]:
    """Model eğitimi için tüm değerlendirmeler. `final` = rapordaki token başına tek satır:
    girilen tokenlarda giriş anı, hiç girilmeyenlerde ilk karar anı ("ilk fırsatta
    girseydik ne olurdu?" karşı-olgusu; son karar anında genelde akış kalmamış olur)."""
    rows = []
    for c in iter_cases(store, cfg, t0, t1, all_checkpoints=True):
        tok, f, v, after = c.tok, c.f, c.verdict, c.after
        size = position_size(cfg.equity_sol, cfg, f["real_sol"])
        p0 = pf.price(c.decision_trade.vsol, c.decision_trade.vtok)
        mults = [pf.price(t.vsol, t.vtok) / p0 for t in after]
        peak_i = max(range(len(mults)), key=mults.__getitem__) if mults else None
        dd_after_peak = (min(mults[peak_i:]) / mults[peak_i]) if peak_i is not None else 1.0
        pos = simulate(tok.mint, c.decision_trade, after, size, c.end_ts, cfg, c.watch, c.rescore)
        rows.append({
            "mint": tok.mint, "symbol": tok.symbol, "created_ts": tok.created_ts,
            "decision_ts": c.decision_ts, "trigger": c.trigger,
            "entry": int(c.entry), "final": int(c.final),
            **{k: round(val, 5) for k, val in f.items()},
            "organic": round(v.organic, 2), "manipulation": round(v.manipulation, 2),
            "survival": round(v.survival, 2), "decision": v.decision,
            "reasons": "; ".join(v.reasons),
            "y_filled": int(pos is not None),
            "y_ret": round(pos.ret, 5) if pos else "",
            "y_exit": pos.exit_reason if pos else "",
            "y_max_mult": round(max(mults), 4) if mults else 1.0,
            "y_min_mult": round(min(mults), 4) if mults else 1.0,
            "y_rug": int(dd_after_peak <= 0.2),
            "y_graduated": int(tok.completed_ts is not None and tok.completed_ts <= c.end_ts),
        })
    entered = {r["mint"] for r in rows if r["entry"]}
    first_cp: set[str] = set()
    for r in rows:
        if r["mint"] in entered:
            continue
        r["final"] = int(r["trigger"] == "cp" and r["mint"] not in first_cp)
        if r["final"]:
            first_cp.add(r["mint"])
    return rows


def write_csv(rows: list[dict], path: str) -> None:
    if not rows:
        return
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)


def _stats(rets: list[float]) -> str:
    if not rets:
        return "n=0"
    srt = sorted(rets)
    trimmed = srt[:-5] if len(srt) > 10 else srt
    return (
        f"n={len(rets):5d}  win={sum(r > 0 for r in rets) / len(rets):5.1%}  "
        f"ort={statistics.fmean(rets):+7.2%}  ort(top5 hariç)={statistics.fmean(trimmed):+7.2%}  "
        f"medyan={statistics.median(rets):+7.2%}  "
        f"p10={srt[len(srt) // 10]:+7.1%}  p90={srt[(len(srt) * 9) // 10]:+7.1%}"
    )


def report(rows: Iterable[dict]) -> str:
    rows = [r for r in rows if str(r["y_ret"]) != ""]
    if rows and "final" in rows[0]:  # strateji görünümü: token başına tek satır
        rows = [r for r in rows if str(r["final"]) == "1"]
    out = ["== Karar bazında strateji getirisi (fee + tx + slippage dahil) =="]
    for d in ("BUY", "WATCH", "PASS"):
        out.append(f"{d:6s} " + _stats([float(r["y_ret"]) for r in rows if r["decision"] == d]))
    out.append(f"{'TÜMÜ':6s} " + _stats([float(r["y_ret"]) for r in rows]))
    for key in ("organic", "manipulation", "survival", "smart_clusters", "mev_share"):
        if not rows or key not in rows[0]:
            continue
        out.append(f"\n== {key} skor dilimi (yükseldikçe getiri monoton değişiyor mu?) ==")
        srt = sorted(rows, key=lambda r: float(r[key]))
        q = max(1, len(srt) // 5)
        for i in range(5):
            chunk = srt[i * q : (i + 1) * q if i < 4 else len(srt)]
            if not chunk:
                continue
            lo, hi = float(chunk[0][key]), float(chunk[-1][key])
            rug = sum(int(r["y_rug"]) for r in chunk) / len(chunk)
            out.append(f"Q{i + 1} [{lo:5.1f}-{hi:5.1f}] rug={rug:5.1%}  "
                       + _stats([float(r["y_ret"]) for r in chunk]))
    out.append(
        "\nKural: BUY satırında 'ort(top5 hariç)' > 0 değilse, n < 500 ise veya skor dilimleri"
        "\nmonoton değilse CANLIYA GEÇME. Birkaç şanslı işleme dayanan edge, edge değildir."
    )
    return "\n".join(out)
