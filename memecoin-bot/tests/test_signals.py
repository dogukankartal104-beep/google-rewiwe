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


def test_store_migrates_v1_schema_and_dedupes(tmp_path):
    import sqlite3

    from mbot.store import Store, Trade

    p = str(tmp_path / "old.db")
    db = sqlite3.connect(p)
    db.execute("CREATE TABLE trades (sig TEXT, idx INTEGER, slot INTEGER, ts INTEGER, mint TEXT, "
               "user TEXT, is_buy INTEGER, sol INTEGER, tok INTEGER, vsol INTEGER, vtok INTEGER, "
               "rsol INTEGER, PRIMARY KEY (sig, idx))")
    db.execute("INSERT INTO trades VALUES ('S1',0,10,100,'MINT','alice',1,5,6,7,8,NULL)")
    db.execute("INSERT INTO trades VALUES ('S2',0,11,101,'MINT','bob',0,1,2,3,4,9)")
    db.commit()
    db.close()

    s = Store(p)
    got = s.trades("MINT")
    assert [(t.user, t.is_buy, t.sol, t.rsol) for t in got] == [("alice", True, 5, None),
                                                                 ("bob", False, 1, 9)]
    assert s.db.execute("PRAGMA user_version").fetchone()[0] == 2
    s.add_trade(Trade(10, 100, "MINT", "alice", True, 5, 6, 7, 8, None, "S1", 0))  # aynı imza
    assert s.n_trades() == 2 and s.trades("YOK") == []
    assert len(s.trades("MINT", until_ts=100)) == 1


def test_store_resumes_interrupted_migration(tmp_path):
    import sqlite3

    from mbot.store import Store

    p = str(tmp_path / "half.db")
    Store(p).db.close()  # yeni şema oluştu, ama eski tablo yarıda kalmış gibi yap:
    db = sqlite3.connect(p)
    db.execute("CREATE TABLE trades_v1 (sig TEXT, idx INTEGER, slot INTEGER, ts INTEGER, "
               "mint TEXT, user TEXT, is_buy INTEGER, sol INTEGER, tok INTEGER, vsol INTEGER, "
               "vtok INTEGER, rsol INTEGER)")
    db.execute("INSERT INTO trades_v1 VALUES ('S1',0,10,100,'MINT','alice',1,5,6,7,8,NULL)")
    db.commit()
    db.close()
    s = Store(p)
    assert len(s.trades("MINT")) == 1
    assert not s.db.execute("SELECT 1 FROM sqlite_master WHERE name='trades_v1'").fetchone()
