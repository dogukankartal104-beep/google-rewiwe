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

    t = sub.add_parser("train", help="Faz 2: win/rug/graduation modellerini walk-forward ile eğit")
    t.add_argument("--csv", default="data/dataset.csv")

    o = sub.add_parser("optimize", help="çıkış kurallarını walk-forward ile seç")
    o.add_argument("--hours", type=float, default=168)
    o.add_argument("--include-watch", action="store_true", help="WATCH kararlarını da aday say")
    o.add_argument("--folds", type=int, default=4)

    lt = sub.add_parser("latency", help="edge gecikmeye dayanıyor mu? (hız edge'i testi)")
    lt.add_argument("--hours", type=float, default=168)
    lt.add_argument("--include-watch", action="store_true")

    mc = sub.add_parser("montecarlo", help="kötü bir ayda ne kadar kaybedebilirim?")
    mc.add_argument("--source", choices=["csv", "paper"], default="csv",
                    help="csv: dataset BUY'ları, paper: gerçekleşen paper işlemler")
    mc.add_argument("--csv", default="data/dataset.csv")
    mc.add_argument("--days", type=float, default=30, help="simüle edilen dönem uzunluğu")
    mc.add_argument("--max-dd", type=float, default=0.20, help="kabul edilebilir drawdown")
    mc.add_argument("--sims", type=int, default=5000)

    sub.add_parser("reconcile", help="paper işlemler backtest'in tahminiyle uyumlu mu?")
    co = sub.add_parser("costs", help="maliyet artınca edge dayanıyor mu?")
    co.add_argument("--hours", type=float, default=168)
    co.add_argument("--include-watch", action="store_true")
    dr = sub.add_parser("drift", help="model eskidi mi?")
    dr.add_argument("--hours", type=float, default=48)
    gl = sub.add_parser("golive", help="canlıya geçiş kontrol listesi")
    gl.add_argument("--hours", type=float, default=168)

    w = sub.add_parser("wallets", help="en yüksek itibarlı cüzdanlar")
    w.add_argument("--top", type=int, default=25)

    sub.add_parser("stats", help="veritabanı özeti")

    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    cfg = Config.load()

    if a.cmd == "train":
        import csv

        from .model import train_all
        with open(a.csv) as fh:
            print(train_all(list(csv.DictReader(fh)), cfg.model_dir))
        return

    if a.cmd == "montecarlo" and a.source == "csv":
        import csv

        from .montecarlo import report as mc_report
        with open(a.csv) as fh:
            rows = [r for r in csv.DictReader(fh)
                    if r["decision"] == "BUY" and str(r["y_ret"]) != ""
                    and str(r.get("final", "1")) == "1"]
        rets = [float(r["y_ret"]) for r in rows]
        ts = [int(float(r["created_ts"])) for r in rows]
        print(mc_report(rets, _per_period(ts, a.days), cfg.risk_per_trade, a.max_dd, a.sims,
                        kill_after=cfg.max_consecutive_losses))
        return

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
    elif a.cmd == "optimize":
        from .dataset import iter_cases
        from .optimize import walk_forward
        now = int(time.time())
        keep = {"BUY", "WATCH"} if a.include_watch else {"BUY"}
        cases = [c for c in iter_cases(store, cfg, now - int(a.hours * 3600), now - cfg.horizon_s)
                 if c.verdict.decision in keep]
        print(walk_forward(cases, cfg, a.folds))
    elif a.cmd == "latency":
        from .dataset import iter_cases
        from .optimize import latency_report
        now = int(time.time())
        keep = {"BUY", "WATCH"} if a.include_watch else {"BUY"}
        cases = [c for c in iter_cases(store, cfg, now - int(a.hours * 3600), now - cfg.horizon_s)
                 if c.verdict.decision in keep]
        print(latency_report(cases, cfg))
    elif a.cmd == "montecarlo":
        from .montecarlo import report as mc_report
        rows = store.db.execute(
            "SELECT opened_ts, pnl_sol / cost_sol FROM paper_trades WHERE cost_sol > 0").fetchall()
        print(mc_report([r[1] for r in rows], _per_period([r[0] for r in rows], a.days),
                        cfg.risk_per_trade, a.max_dd, a.sims,
                        kill_after=cfg.max_consecutive_losses))
    elif a.cmd == "reconcile":
        from .analysis import reconcile
        print(reconcile(store, cfg).text)
    elif a.cmd == "costs":
        from .analysis import cost_report
        from .dataset import iter_cases
        now = int(time.time())
        keep = {"BUY", "WATCH"} if a.include_watch else {"BUY"}
        cases = [c for c in iter_cases(store, cfg, now - int(a.hours * 3600), now - cfg.horizon_s)
                 if c.verdict.decision in keep]
        print(cost_report(cases, cfg))
    elif a.cmd == "drift":
        from .analysis import drift
        print(drift(store, cfg, a.hours).text)
    elif a.cmd == "golive":
        from .analysis import golive
        print(golive(store, cfg, a.hours))
    elif a.cmd == "wallets":
        from .reputation import Reputation
        rep = Reputation(cfg)
        rep.refresh_from_store(store, int(time.time()))
        print(f"{len(rep.done)} token, {len(rep.wallets)} cüzdan, ortalama getiri {rep.prior:+.1%}")
        print(f"{'cüzdan':44s} {'token':>5s} {'skor':>7s} {'win':>6s} akıllı")
        for wal, n, mean, win in rep.top(a.top):
            print(f"{wal:44s} {n:5d} {mean:+7.1%} {win:6.1%} {'✓' if rep.is_smart(wal) else ''}")
    elif a.cmd == "stats":
        for t in ("tokens", "trades", "funders", "paper_trades"):
            n = store.db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            print(f"{t:13s} {n}")
        row = store.db.execute(
            "SELECT COUNT(*), SUM(pnl_sol), AVG(pnl_sol > 0) FROM paper_trades").fetchone()
        if row[0]:
            print(f"paper: {row[0]} işlem, toplam {row[1]:+.4f} SOL, win {row[2]:.1%}")


def _per_period(ts: list[int], days: float) -> int:
    """Gözlenen işlem sıklığından dönem başına beklenen işlem sayısı."""
    if len(ts) < 2:
        return max(1, len(ts))
    span_days = max(1 / 24, (max(ts) - min(ts)) / 86_400)
    return max(1, round(len(ts) / span_days * days))


async def _resolve(cfg: Config, store: Store, hours: float) -> None:
    from .funding import FundingResolver
    now = int(time.time())
    res = FundingResolver(cfg.rpc_url, store, cfg.funder_max_pages)
    try:
        for tok in store.tokens_created_between(now - int(hours * 3600), now):
            trades = store.trades(tok.mint, until_ts=tok.created_ts + cfg.decision_age_s)
            wallets = {t.user for t in trades if t.is_buy} | {tok.creator}
            got = await res.resolve_many(sorted(wallets), timeout_s=60, depth=cfg.funding_depth,
                                         hubs=frozenset(cfg.hubs))
            print(f"{tok.symbol[:12]:12s} {len(got)}/{len(wallets)} cüzdan çözüldü")
    finally:
        await res.aclose()
