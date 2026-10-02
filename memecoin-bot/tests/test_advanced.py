import random
from dataclasses import replace

from synth import SLOT0, T0, load, manipulated, organic, run_curve

from mbot.cohort import build_cohorts
from mbot.config import Config
from mbot.dataset import build_rows, iter_cases
from mbot.features import mev_stats, order_slot
from mbot.model import LogisticModel, load_models, train_all, walk_forward
from mbot.optimize import walk_forward as exit_walk_forward
from mbot.reputation import Reputation, token_outcome
from mbot.scoring import evaluate
from mbot.store import Funding, Store, Token, Trade


def _shift(case, dt, mint, unique=False):
    tok, trades, fund = case
    tok = replace(tok, mint=mint, created_ts=tok.created_ts + dt)
    if unique:  # aksi halde copycat/seri-launcher filtresi haklı olarak eler
        tok = replace(tok, symbol=f"S{mint}", creator=f"c{mint}")
    trades = [replace(t, mint=mint, ts=t.ts + dt, sig=t.sig + mint) for t in trades]
    return tok, trades, fund


# ------------------------------------------------------------------ MEV
def test_slot_ordering_and_sandwich_detection():
    orders = [(SLOT0 + 50, T0, "pre", True, 2.0),
              (SLOT0 + 60, T0, "atk", True, 3.0),  # front-run
              (SLOT0 + 61, T0, "victim", True, 1.0),
              (SLOT0 + 62, T0, "atk", False, 1.0)]  # back-run: hepsini sat
    trades = run_curve("M", orders)
    same_slot = [replace(t, slot=SLOT0 + 60) for t in trades[1:]]
    shuffled = [same_slot[2], same_slot[0], same_slot[1]]
    assert [t.user for t in order_slot(shuffled)] == ["atk", "victim", "atk"]
    n, atk_share, wash = mev_stats([trades[0]] + shuffled)
    assert n == 1 and atk_share > 0.5 and wash > 0.5
    assert mev_stats(trades)[0] == 0  # farklı slotlarda → sandwich değil


def test_mev_raises_manipulation_score():
    from mbot.scoring import score
    tok, trades, fund = organic()
    from mbot.features import compute_features
    f = compute_features(tok, trades, fund, T0 + 120)
    base = score(f)[1]
    f2 = dict(f, mev_share=0.4, wash_slot_share=0.4)
    assert score(f2)[1] > base + 5


# ------------------------------------------------------------------ fonlama grafiği
def test_two_hop_funding_links():
    tok = Token("M", "m", "M", "dev", SLOT0, T0)
    trades = [Trade(SLOT0 + 5, T0, "M", "a", True, 10**8, 1, 1, 1),
              Trade(SLOT0 + 9, T0, "M", "b", True, 3 * 10**8, 1, 1, 1)]
    fund = {"a": Funding("a", "F1", 1, None), "b": Funding("b", "F2", 1, None),
            "F1": Funding("F1", "G", 1, None), "F2": Funding("F2", "G", 1, None)}
    assert build_cohorts(tok, trades, fund, set(), depth=1).cluster("a") != \
        build_cohorts(tok, trades, fund, set(), depth=1).cluster("b")
    c2 = build_cohorts(tok, trades, fund, set(), depth=2)
    assert c2.cluster("a") == c2.cluster("b")
    c_hub = build_cohorts(tok, trades, fund, {"G"}, depth=2)
    assert c_hub.cluster("a") != c_hub.cluster("b")


def test_store_funding_closure():
    s = Store(":memory:")
    for f in (Funding("a", "F1", 1, None), Funding("F1", "G", 1, None),
              Funding("G", "__deep__", 0, None)):
        s.put_funding(f, T0)
    assert set(s.fundings_closure(["a"], 1)) == {"a"}
    assert set(s.fundings_closure(["a"], 3)) == {"a", "F1", "G"}


# ------------------------------------------------------------------ itibar
def _past_tokens(store, n=8):
    for i in range(n):
        load(store, *_shift(organic(seed=100 + i, tail=20), -(i + 1) * 4000, f"P{i}"))


def test_reputation_learns_profitable_wallets():
    cfg = Config()
    store = Store(":memory:")
    _past_tokens(store)
    rep = Reputation(cfg)
    assert rep.refresh_from_store(store, T0) == 8
    smart = [w for w in rep.wallets if rep.is_smart(w)]
    assert len(smart) > 20
    n, mean, win = rep.wallet_score(smart[0])
    assert n >= cfg.rep_min_tokens and mean >= cfg.rep_smart_mean
    assert rep.creator_stats("creatorO")[0] == 8


def test_reputation_has_no_lookahead():
    cfg = Config()
    store = Store(":memory:")
    _past_tokens(store)
    load(store, *organic(tail=20))  # T0'da yeni token
    rows = {r["symbol"]: r for r in build_rows(store, cfg, T0 - 1, T0 + 1)}
    assert rows["ORG"]["smart_clusters"] > 0 and rows["ORG"]["rep_known_share"] > 0
    for r in rows.values():  # itibar açıkken de oranlar [0,1] ve skorlar [0,100]
        assert 0 <= r["fresh_wallet_share"] <= 1 and 0 <= r["funding_coverage"] <= 1
        assert all(0 <= r[k] <= 100 for k in ("organic", "manipulation", "survival"))

    # Geçmiş tokenların ufku karar anında henüz bitmemişse itibar kullanılamaz
    store2 = Store(":memory:")
    for i in range(8):
        load(store2, *_shift(organic(seed=100 + i, tail=20), -(i + 1) * 60, f"P{i}"))
    load(store2, *organic(tail=20))
    rows2 = {r["symbol"]: r for r in build_rows(store2, cfg, T0 - 1, T0 + 1)}
    assert rows2["ORG"]["smart_clusters"] == 0 and rows2["ORG"]["rep_known_share"] == 0


def test_serial_rugger_creator_filtered():
    cfg = Config()
    tok, trades, fund = manipulated(tail=20)
    o = replace(token_outcome(tok, trades, cfg), rugged=True)
    rep = Reputation(cfg)
    for i in range(3):
        rep.add(replace(o, mint=f"old{i}"))
    from mbot.features import compute_features
    f = compute_features(tok, [t for t in trades if t.ts <= T0 + 120], fund, T0 + 120, rep=rep)
    assert f["creator_prev_tokens"] == 3 and f["creator_rug_rate"] == 1.0
    v = evaluate(tok, f, None, cfg)
    assert v.decision == "PASS" and any("creator geçmişi" in r for r in v.reasons)


# ------------------------------------------------------------------ model
def _rows(n=600, seed=0):
    rnd = random.Random(seed)
    rows = []
    for i in range(n):
        a, b = rnd.gauss(0, 1), rnd.gauss(0, 1)
        win = rnd.random() < 1 / (1 + 2.718 ** -(2 * a))
        rug = rnd.random() < 1 / (1 + 2.718 ** -(2 * b - 1))
        rows.append({"mint": f"m{i}", "created_ts": str(T0 + i), "sig_a": a, "sig_b": b,
                     "noise": rnd.random(), "decision": "BUY",
                     "y_ret": 0.3 if win else -0.3, "y_rug": int(rug), "y_graduated": 0})
    return rows


def test_walk_forward_finds_planted_signal():
    wf = walk_forward(_rows(), "win")
    assert len(wf) == 5 and all(r["auc"] > 0.7 for r in wf)
    assert all(r["top20_ret"] > 0 for r in wf)


def test_train_saves_only_predictive_models(tmp_path):
    out = train_all(_rows(), str(tmp_path))
    models = load_models(str(tmp_path))
    assert set(models) == {"win", "rug"}  # graduation hep 0 → kaydedilmez
    assert "KAYDEDİLMEDİ" in out
    assert models["win"].predict({"sig_a": 2.0}) > 0.8 > models["win"].predict({"sig_a": 0}) > 0.2
    assert "en az 200" in train_all(_rows(50), str(tmp_path))


def test_model_gates_buy():
    cfg = Config()
    store = Store(":memory:")
    tok, trades, fund = organic()
    load(store, tok, trades, fund)
    from mbot.features import compute_features
    f = compute_features(tok, trades, fund, T0 + 120)
    assert evaluate(tok, f, store, cfg).decision == "BUY"
    bad = LogisticModel(["n_trades"], [0.0], [1.0], [0.0], -3.0)  # P ≈ 0.05
    v = evaluate(tok, f, store, cfg, {"win": bad})
    assert v.decision == "PASS" and v.probs["p_win"] < 0.1


# ------------------------------------------------------------------ çıkış optimizasyonu
def test_exit_optimizer_runs_walk_forward():
    cfg = Config()
    store = Store(":memory:")
    for i in range(60):
        load(store, *_shift(organic(seed=200 + i, tail=15 + i % 10), i * 10, f"T{i}", unique=True))
    cases = [c for c in iter_cases(store, cfg, T0 - 1, T0 + 10_000, use_rep=False)
             if c.verdict.decision in ("BUY", "WATCH")]
    assert len(cases) >= 50
    grid = {"stop_loss": [0.3], "tp1": [0.1, 5.0], "tp1_fraction": [0.5],
            "trailing": [0.25], "time_stop_s": [900]}
    out = exit_walk_forward(cases, cfg, folds=4, grid=grid)
    assert "fold 4" in out and "Toplam görülmemiş veri" in out
    assert "Sadece" in exit_walk_forward(cases[:20], cfg, folds=4, grid=grid)


# ------------------------------------------------------------------ hız / likidite / rejim
from test_execution import _at  # noqa: E402

from mbot.dataset import Case  # noqa: E402
from mbot.optimize import latency_report  # noqa: E402
from mbot.paper import simulate as _simulate  # noqa: E402
from mbot.risk import position_size  # noqa: E402
from mbot.reputation import TokenOutcome  # noqa: E402


def test_position_capped_by_curve_liquidity():
    cfg = Config(equity_sol=100, risk_per_trade=0.01, max_liq_frac=0.02)
    assert position_size(100, cfg) == 1.0
    assert position_size(100, cfg, real_sol=10) == 0.2  # sığ curve → küçük pozisyon
    assert position_size(100, cfg, real_sol=80) == 1.0


def test_slippage_cap_blocks_chasing():
    cfg = Config(max_entry_slippage=0.15)
    d = _at(1.0, T0)
    assert _simulate("M", d, [_at(1.5, T0 + 1), _at(1.5, T0 + 99)], 1.0, T0 + 999, cfg) is None
    assert _simulate("M", d, [_at(1.05, T0 + 1), _at(1.1, T0 + 99)], 1.0, T0 + 999, cfg) is not None


def test_latency_report_flags_speed_edge():
    cfg = Config()
    tok = Token("M", "m", "M", "dev", SLOT0, T0)
    after = [_at(1.7, T0 + 1)] + [_at(1.7, T0 + 2 + i) for i in range(10)]
    case = Case(tok, {"real_sol": 30.0}, None, _at(1.0, T0), after, T0 + 1800, {})
    out = latency_report([case] * 5, cfg)
    assert "hız edge'i" in out  # sadece gecikmesiz giren kazanıyor

    slow = [_at(1.0 + 0.01 * i, T0 + 1 + i) for i in range(60)]  # yavaş, kalıcı yükseliş
    case2 = Case(tok, {"real_sol": 30.0}, None, _at(1.0, T0), slow, T0 + 1800, {})
    assert "gecikmeye dayanıklı" in latency_report([case2] * 5, replace(cfg, time_stop_s=50))


def test_bad_market_regime_blocks_entries():
    cfg = Config(regime_min_tokens=30, regime_max_rug=0.6)
    rep = Reputation(cfg)
    for i in range(40):
        rep.add(TokenOutcome(f"r{i}", f"c{i}", T0 - 600 + i, {}, rugged=i % 10 < 8, graduated=False))
    n, rug, _ = rep.regime(T0)
    assert n == 40 and rug == 0.8
    assert rep.regime(T0 + 7200)[0] == 0  # pencere dışına çıkınca unutulur

    store = Store(":memory:")
    tok, trades, fund = organic()
    load(store, tok, trades, fund)
    from mbot.features import compute_features
    rep2 = Reputation(cfg)
    for i in range(40):
        rep2.add(TokenOutcome(f"r{i}", f"c{i}", T0 - 600 + i, {}, rugged=i % 10 < 8, graduated=False))
    f = compute_features(tok, trades, fund, T0 + 120, rep=rep2)
    v = evaluate(tok, f, store, cfg)
    assert v.decision == "PASS" and any("rejimi" in r for r in v.reasons)
