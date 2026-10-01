from __future__ import annotations

import argparse
import asyncio
import logging
import time

from .config import Config
from .store import Store


def main() -> None:
    ap = argparse.ArgumentParser(prog="mbot", description="Pump.fun veri + skor + paper motoru")
    sub = ap.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("collect", help="Faz 0: event'leri kaydet (karar vermez)")
    c.add_argument("--funders", action="store_true", help="karar anında fonlayıcıları da çöz")
    p = sub.add_parser("paper", help="Faz 3: canlı akışta skorla + paper trade")
    p.add_argument("--no-funders", action="store_true")

    rf = sub.add_parser("resolve-funders", help="kayıtlı tokenların alıcılarının fonlayıcılarını çöz")
    rf.add_argument("--hours", type=float, default=24)

    d = sub.add_parser("dataset", help="özellik + etiket CSV'si üret")
    d.add_argument("--hours", type=float, default=24)
    d.add_argument("--out", default="data/dataset.csv")

    r = sub.add_parser("report", help="skorlar gerçekten tahmin ediyor mu?")
    r.add_argument("--csv", default="data/dataset.csv")

    sub.add_parser("stats", help="veritabanı özeti")

    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    cfg = Config.load()

    if a.cmd == "report":
        import csv

        from .dataset import report
        with open(a.csv) as fh:
            print(report(csv.DictReader(fh)))
        return

    store = Store(cfg.db_path)
    if a.cmd in ("collect", "paper"):
        from .engine import run
        trade = a.cmd == "paper"
        funders = (not a.no_funders) if trade else a.funders
        asyncio.run(run(cfg, store, trade=trade, resolve_funders=funders))
    elif a.cmd == "resolve-funders":
        asyncio.run(_resolve(cfg, store, a.hours))
    elif a.cmd == "dataset":
        from .dataset import build_rows, write_csv
        now = int(time.time())
        rows = build_rows(store, cfg, now - int(a.hours * 3600), now - cfg.horizon_s)
        write_csv(rows, a.out)
        print(f"{len(rows)} satır → {a.out}")
    elif a.cmd == "stats":
        for t in ("tokens", "trades", "funders", "paper_trades"):
            n = store.db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            print(f"{t:13s} {n}")
        row = store.db.execute(
            "SELECT COUNT(*), SUM(pnl_sol), AVG(pnl_sol > 0) FROM paper_trades").fetchone()
        if row[0]:
            print(f"paper: {row[0]} işlem, toplam {row[1]:+.4f} SOL, win {row[2]:.1%}")


async def _resolve(cfg: Config, store: Store, hours: float) -> None:
    from .funding import FundingResolver
    now = int(time.time())
    res = FundingResolver(cfg.rpc_url, store, cfg.funder_max_pages)
    try:
        for tok in store.tokens_created_between(now - int(hours * 3600), now):
            trades = store.trades(tok.mint, until_ts=tok.created_ts + cfg.decision_age_s)
            wallets = {t.user for t in trades if t.is_buy} | {tok.creator}
            got = await res.resolve_many(sorted(wallets), timeout_s=60)
            print(f"{tok.symbol[:12]:12s} {len(got)}/{len(wallets)} cüzdan çözüldü")
    finally:
        await res.aclose()
