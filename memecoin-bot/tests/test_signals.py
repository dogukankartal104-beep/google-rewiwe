from synth import SLOT0, T0, load, manipulated, organic

from mbot.cohort import build_cohorts
from mbot.config import Config
from mbot.features import compute_features
from mbot.scoring import evaluate
from mbot.store import Funding, Store, Token, Trade


def _t(slot, user, sol=10**8):
    return Trade(slot, T0, "M", user, True, sol, 1, 1, 1)


def test_cohort_rules():
    tok = Token("M", "m", "M", "dev", SLOT0, T0)
    trades = [_t(SLOT0, "bundled"), _t(SLOT0 + 5, "a"), _t(SLOT0 + 9, "b"), _t(SLOT0 + 20, "c"),
              _t(SLOT0 + 30, "d"), _t(SLOT0 + 30, "e", 105_000_000), _t(SLOT0 + 30, "f", 4 * 10**8)]
    fund = {"a": Funding("a", "F", 1, None), "b": Funding("b", "F", 1, None),
            "c": Funding("c", "BINANCE", 1, None), "dev": Funding("dev", "BINANCE", 1, None)}
    coh = build_cohorts(tok, trades, fund, hubs={"BINANCE"})
    assert coh.cluster("bundled") == coh.creator_cluster
    assert coh.cluster("a") == coh.cluster("b")
    assert coh.cluster("c") != coh.creator_cluster  # hub üzerinden bağ kurulmaz
    assert coh.cluster("d") == coh.cluster("e")  # aynı slot, ±%15 boyut
    assert coh.cluster("f") != coh.cluster("d")


def test_organic_beats_manipulated():
    cfg = Config()
    store = Store(":memory:")
    res = {}
    for name, (tok, trades, fund) in {"org": organic(), "man": manipulated()}.items():
        load(store, tok, trades, fund)
        f = compute_features(tok, trades, fund, T0 + 120)
        res[name] = (f, evaluate(tok, f, store, cfg))
    (fo, vo), (fm, vm) = res["org"], res["man"]

    assert fo["effective_buyers"] > 50 and fm["effective_buyers"] < 10
    assert fm["unique_buyers"] > 3 * fm["effective_buyers"]
    assert vo.organic > vm.organic + 30
    assert vm.manipulation > vo.manipulation + 30
    assert vo.survival > vm.survival
    assert vm.decision == "PASS" and any("bundle" in r for r in vm.reasons)
    assert vo.decision in ("BUY", "WATCH"), vo.reasons


def test_serial_launcher_filtered():
    cfg = Config()
    store = Store(":memory:")
    tok, trades, fund = organic()
    load(store, tok, trades, fund)
    for i in range(3):
        store.db.execute("INSERT INTO tokens (mint,symbol,creator,created_ts) VALUES (?,?,?,?)",
                         (f"old{i}", "X", tok.creator, T0 - 1000 * (i + 1)))
    f = compute_features(tok, trades, fund, T0 + 120)
    v = evaluate(tok, f, store, cfg)
    assert v.decision == "PASS" and any("seri launcher" in r for r in v.reasons)


def test_find_funder_parses_system_transfer():
    from mbot.funding import find_funder

    tx = {"transaction": {"message": {"instructions": [
        {"program": "compute-budget", "parsed": None},
        {"program": "system", "parsed": {"type": "transfer",
                                          "info": {"source": "S", "destination": "X", "lamports": 7}}},
        {"program": "system", "parsed": {"type": "transfer",
                                          "info": {"source": "F", "destination": "W", "lamports": 5}}},
    ]}}, "meta": {"innerInstructions": [{"instructions": [
        {"program": "system", "parsed": {"type": "createAccount",
                                          "info": {"source": "G", "newAccount": "N", "lamports": 9}}}]}]}}
    assert find_funder(tx, "W") == ("F", 5)
    assert find_funder(tx, "N") == ("G", 9)
    assert find_funder(tx, "nobody") == (None, 0)
    assert find_funder(None, "W") == (None, 0)
