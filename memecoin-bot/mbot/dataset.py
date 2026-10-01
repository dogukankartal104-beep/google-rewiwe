"""Faz 0→2 köprüsü: karar anı özellikleri + gerçekleşen sonuç etiketleri → CSV,
ve skorların gerçekten tahmin gücü olup olmadığını gösteren rapor."""

from __future__ import annotations

import csv
import statistics
from typing import Iterable

from . import pumpfun as pf
from .config import Config
from .features import compute_features
from .paper import simulate
from .scoring import evaluate
from .store import Store


def build_rows(store: Store, cfg: Config, t0: int, t1: int) -> list[dict]:
    rows = []
    size = cfg.equity_sol * cfg.risk_per_trade
    for tok in store.tokens_created_between(t0, t1):
        t_d = tok.created_ts + cfg.decision_age_s
        end = t_d + cfg.horizon_s
        trades = store.trades(tok.mint, until_ts=end)
        before = [t for t in trades if t.ts <= t_d]
        after = [t for t in trades if t.ts > t_d]
        if len(before) < 3:
            continue
        fundings = store.fundings(t.user for t in before)
        f = compute_features(tok, before, fundings, t_d, cfg.hubs, cfg.same_slot_size_tol,
                             cfg.fresh_wallet_s)
        v = evaluate(tok, f, store, cfg)

        p0 = pf.price(before[-1].vsol, before[-1].vtok)
        mults = [pf.price(t.vsol, t.vtok) / p0 for t in after]
        peak_i = max(range(len(mults)), key=mults.__getitem__) if mults else None
        dd_after_peak = (min(mults[peak_i:]) / mults[peak_i]) if peak_i is not None else 1.0
        pos = simulate(tok.mint, before[-1], after, size, end, cfg)
        rows.append({
            "mint": tok.mint, "symbol": tok.symbol, "created_ts": tok.created_ts,
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
            "y_graduated": int(tok.completed_ts is not None and tok.completed_ts <= end),
        })
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
    out = ["== Karar bazında strateji getirisi (fee + tx + slippage dahil) =="]
    for d in ("BUY", "WATCH", "PASS"):
        out.append(f"{d:6s} " + _stats([float(r["y_ret"]) for r in rows if r["decision"] == d]))
    out.append(f"{'TÜMÜ':6s} " + _stats([float(r["y_ret"]) for r in rows]))
    for key in ("organic", "manipulation", "survival"):
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
