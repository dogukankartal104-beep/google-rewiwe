from synth import SLOT0, T0, load, manipulated, organic

from mbot import pumpfun as pf
from mbot.config import Config
from mbot.dataset import build_rows, report
from mbot.engine import Engine
from mbot.paper import on_trade, open_position, simulate
from mbot.risk import RiskManager
from mbot.store import Store, Trade

V, K = pf.INITIAL_VIRTUAL_SOL * 2, pf.INITIAL_VIRTUAL_TOKEN // 2


def _at(mult: float, ts: int) -> Trade:
    """Fiyatı referansın `mult` katı olan bir piyasa trade'i."""
    vtok = int(K / mult**0.5)
    vsol = int(V * K / vtok)  # vsol/vtok oranı = mult * V/K
    return Trade(SLOT0, ts, "M", "x", True, 1, 1, vsol, vtok)


def test_stop_fills_at_gap_price_not_stop_price():
    cfg = Config()
    p = open_position("M", 1.0, V, K, T0, cfg)
    assert not on_trade(p, _at(0.9, T0 + 5), cfg)
    assert on_trade(p, _at(0.4, T0 + 6), cfg)  # -%30 stop, -%60 gap
    assert p.exit_reason == "stop" and p.ret < -0.55


def test_tp_then_trailing():
    cfg = Config()
    p = open_position("M", 1.0, V, K, T0, cfg)
    on_trade(p, _at(1.7, T0 + 10), cfg)
    assert p.tp1_done and p.tokens > 0
    on_trade(p, _at(3.0, T0 + 20), cfg)
    assert on_trade(p, _at(2.2, T0 + 30), cfg)
    assert p.exit_reason == "trail" and p.ret > 0.5


def test_time_stop_and_no_fill_without_flow():
    cfg = Config()
    d = _at(1.0, T0)
    assert simulate("M", d, [], 1.0, T0 + 1800, cfg) is None
    p = simulate("M", d, [_at(1.0, T0 + 1), _at(1.1, T0 + 2000)], 1.0, T0 + 3000, cfg)
    assert p.exit_reason == "time"


def test_costs_dominate_tiny_positions():
    cfg = Config()
    p = simulate("M", _at(1.0, T0), [_at(1.0, T0 + 1), _at(1.0, T0 + 50)], 0.05, T0 + 60, cfg)
    assert p.ret < -0.08  # 2x0.002 SOL tx + fee, 0.05 SOL pozisyonda %8+ kayıp


def test_risk_manager_limits():
    cfg = Config(equity_sol=10, daily_loss_limit=0.03, max_consecutive_losses=3, max_open=2)
    r = RiskManager(cfg)
    assert r.can_open("a", T0)[0]
    r.on_open("a", 0.05)
    r.on_open("b", 0.05)
    assert r.can_open("c", T0) == (False, "max açık pozisyon")
    r.on_close("a", -0.2, T0)
    r.on_close("b", -0.15, T0)
    assert r.can_open("c", T0) == (False, "günlük kayıp limiti")
    assert r.can_open("c", T0 + 86_400)[0]  # ertesi gün açılır
    for m in "xyz":
        r.on_close(m, -0.01, T0 + 86_400)
    assert "kill switch" in r.can_open("c", T0 + 3 * 86_400)[1]


def test_dataset_and_report():
    cfg = Config()
    store = Store(":memory:")
    for tok, trades, fund in (organic(tail=20), manipulated(tail=20)):
        load(store, tok, trades, fund)
    rows = {r["symbol"]: r for r in build_rows(store, cfg, T0 - 1, T0 + 1)}
    assert rows["ORG"]["decision"] == "BUY" and rows["PUMP"]["decision"] == "PASS"
    assert rows["ORG"]["y_filled"] == rows["PUMP"]["y_filled"] == 1
    # creator cluster boşaltınca stop'u beklemeden çık
    assert rows["PUMP"]["y_exit"] == "insider_exit" and rows["PUMP"]["y_ret"] < -0.3
    no_watch = Config(insider_exit_frac=99)
    plain = {r["symbol"]: r for r in build_rows(store, no_watch, T0 - 1, T0 + 1)}
    assert plain["PUMP"]["y_exit"] == "stop"
    assert rows["PUMP"]["y_ret"] > plain["PUMP"]["y_ret"]
    # karar anından sonraki veri özellikleri değiştirmemeli (look-ahead yok)
    assert rows["ORG"]["n_trades"] == len([t for t in organic()[1] if t.ts <= T0 + 120])
    rows = list(rows.values())
    out = report(rows)
    assert "PASS" in out and "organic skor dilimi" in out


def test_engine_paper_flow():
    import asyncio

    cfg = Config(decision_age_s=120)
    store = Store(":memory:")
    tok, trades, fund = organic()
    load(store, tok, trades, fund)
    eng = Engine(cfg, store, resolver=None, trade=True)
    eng.pending_fill["ORG"] = (0.05, None, {})
    nxt = trades[-1]
    eng._on_trade(nxt)
    assert "ORG" in eng.positions
    crash = Trade(nxt.slot + 1, nxt.ts + 1, "ORG", "z", False, 1, 1, nxt.vsol // 3, nxt.vtok * 3)
    eng.positions["ORG"] = (eng.positions["ORG"][0], type("V", (), {"as_dict": lambda s: {}})())
    eng._on_trade(crash)
    assert "ORG" not in eng.positions
    assert store.db.execute("SELECT exit_reason FROM paper_trades").fetchone()[0] == "stop"
    asyncio.run(eng._evaluate("ORG", T0 + 120))  # fonlama store'dan, hata vermemeli


def test_engine_prunes_idle_tokens():
    eng = Engine(Config(), Store(":memory:"), resolver=None, trade=True)
    old = Trade(1, T0, "OLD", "u", True, 1, 1, 1, 1)
    held = Trade(1, T0, "HELD", "u", True, 1, 1, 1, 1)
    fresh = Trade(2, T0 + 3500, "NEW", "u", True, 1, 1, 1, 1)
    eng.last = {"OLD": old, "HELD": held, "NEW": fresh}
    eng.pending_fill["HELD"] = (0.05, None, {})
    eng.prune(T0 + 3700)
    assert set(eng.last) == {"HELD", "NEW"}
