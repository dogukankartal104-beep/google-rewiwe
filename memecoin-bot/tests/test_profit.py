"""Kârlılık özellikleri: çoklu karar anı, akıllı cüzdan tetiği, güvene göre boyut,
yeniden skorlama çıkışı, anlatı sıcaklığı."""
from dataclasses import replace

from synth import T0, late_bloomer, load, manipulated, organic
from test_advanced import _past_tokens, _rows
from test_execution import _at

from mbot.config import Config
from mbot.dataset import build_rows, iter_cases, make_case
from mbot.features import compute_features
from mbot.model import train_all
from mbot.paper import simulate
from mbot.reputation import Reputation, TokenOutcome, name_words
from mbot.risk import position_size
from mbot.scoring import score
from mbot.store import Store


# ------------------------------------------------------------------ çoklu karar anı
def test_late_bloomer_caught_at_later_checkpoint():
    s = Store(":memory:")
    load(s, *late_bloomer())
    single = list(iter_cases(s, Config(decision_ages="120"), T0 - 1, T0 + 1))
    assert len(single) == 1 and single[0].verdict.decision == "PASS"  # eskiden kaçırılırdı

    multi = list(iter_cases(s, Config(), T0 - 1, T0 + 1))
    assert len(multi) == 1 and multi[0].entry  # strateji modunda tek giriş
    assert multi[0].decision_ts == T0 + 300 and multi[0].verdict.decision == "BUY"


def test_all_checkpoints_rows_flag_entry_once():
    s = Store(":memory:")
    load(s, *late_bloomer())
    load(s, *manipulated(tail=20))
    rows = build_rows(s, Config(), T0 - 1, T0 + 1)
    late = [r for r in rows if r["symbol"] == "LATE"]
    assert [r["age_s"] for r in late] == [60, 120, 300, 600]
    assert [r["entry"] for r in late] == [0, 0, 1, 0]
    assert sum(r["final"] for r in rows) == 2  # token başına tek strateji satırı
    man_final = [r for r in rows if r["symbol"] == "PUMP" and r["final"]]
    assert man_final[0]["age_s"] == 60 and man_final[0]["decision"] == "PASS"
    assert man_final[0]["y_ret"] != ""  # karşı-olgu getirisi raporlanabilir


# ------------------------------------------------------------------ akıllı cüzdan tetiği
def test_smart_wallet_buy_triggers_early_evaluation():
    cfg = Config(decision_ages="120")
    s = Store(":memory:")
    _past_tokens(s)  # o* cüzdanları geçmişte kârlı → akıllı
    load(s, *organic(tail=20))
    cases = list(iter_cases(s, cfg, T0 - 1, T0 + 1, all_checkpoints=True))
    smart = [c for c in cases if c.trigger == "smart"]
    assert smart and all(T0 + 15 <= c.decision_ts < T0 + 120 for c in smart)
    gaps = [b.decision_ts - a.decision_ts for a, b in zip(smart, smart[1:])]
    assert all(g >= cfg.eval_cooldown_s for g in gaps)

    off = list(iter_cases(s, replace(cfg, smart_trigger=0), T0 - 1, T0 + 1, all_checkpoints=True))
    assert not [c for c in off if c.trigger == "smart"]


# ------------------------------------------------------------------ güvene göre boyut
def test_kelly_sizing_bounds():
    cfg = Config(risk_per_trade=0.005, kelly_fraction=0.25, max_risk_per_trade=0.02)
    assert position_size(100, cfg) == 0.5
    assert position_size(100, cfg, p_win=0.7, payoff=2.0) == 2.0  # tavan
    assert abs(position_size(100, cfg, p_win=0.52, payoff=1.0) - 1.0) < 1e-9
    assert position_size(100, cfg, p_win=0.4, payoff=1.0) == 0.25  # negatif edge → yarım
    assert position_size(100, cfg, p_win=0.7, payoff=2.0, real_sol=10) == 0.2  # likidite
    assert position_size(100, replace(cfg, kelly_fraction=0), p_win=0.9, payoff=3) == 0.5


def test_walk_forward_reports_kelly_vs_flat(tmp_path):
    out = train_all(_rows(), str(tmp_path))
    assert "güvene göre boyut" in out
    import json
    meta = json.loads((tmp_path / "win.json").read_text())["meta"]
    assert meta["payoff"] and abs(meta["payoff"] - 1.0) < 1e-6  # ±0.3 getiriler


# ------------------------------------------------------------------ yeniden skorlama
def test_rescore_exit_in_simulation():
    cfg = Config()
    d = _at(1.0, T0)
    after = [_at(1.1, T0 + 10 * i) for i in range(1, 30)]
    p = simulate("M", d, after, 1.0, T0 + 1800, cfg, rescore=lambda ts: ts >= T0 + 100)
    assert p.exit_reason == "rescore_exit" and p.closed_ts == T0 + 100


def test_rescorer_flags_manipulated_not_organic():
    cfg = Config()
    s = Store(":memory:")
    for case in (organic(tail=20), manipulated(tail=20)):
        load(s, *case)
    res = {}
    for mint in ("ORG", "MAN"):
        tok = s.token(mint)
        c = make_case(s, cfg, tok, s.trades(mint), None, T0 + 120)
        res[mint] = c.rescore(T0 + 120 + cfg.rescore_s)
    assert res == {"ORG": False, "MAN": True}


# ------------------------------------------------------------------ anlatı sıcaklığı
def test_narrative_heat():
    assert name_words("Dog Wif Hat", "WIF") == frozenset({"dog", "wif", "hat"})
    assert name_words("The Official Coin", "SOL") == frozenset()
    cfg = Config()
    rep = Reputation(cfg)
    for i in range(6):
        rep.add(TokenOutcome(f"d{i}", f"c{i}", T0 - 1000 + i, {"w": 0.5}, False, i < 3,
                             frozenset({"dog"})))
    rep.add(TokenOutcome("x", "cx", T0 - 900, {}, False, False, frozenset({"cat"})))
    n, grad, ret = rep.narrative(frozenset({"dog", "wif"}), T0)
    assert (n, grad, ret) == (6, 0.5, 0.5)
    assert rep.narrative(frozenset({"cat"}), T0)[0] == 0  # 5'ten az örnek

    tok, trades, fund = organic()
    hot = replace(tok, name="Dog Wif", symbol="DOGW")
    base = compute_features(tok, trades, fund, T0 + 120, rep=rep)
    f_hot = compute_features(hot, trades, fund, T0 + 120, rep=rep)
    assert f_hot["narrative_n"] == 6 and base["narrative_n"] == 0
    assert score(f_hot)[0] > score(base)[0]
    # pencere dışına çıkınca unutulur (sorgular zaman sıralı olmalı: eski kayıtlar silinir)
    assert rep.narrative(frozenset({"dog"}), T0 + cfg.narrative_window_s + 1)[0] == 0


# ------------------------------------------------------------------ canlı motor
def test_engine_smart_trigger_and_checkpoints():
    import asyncio

    from mbot.engine import Engine
    from mbot.store import Trade

    cfg = Config(decision_ages="60,120,300")
    s = Store(":memory:")
    _past_tokens(s)
    tok, trades, fund = organic()
    load(s, replace(tok, creator="freshdev"), trades, fund)  # geçmiş tokenların creator'ı seri launcher

    async def go():
        eng = Engine(cfg, s, resolver=None, trade=False)
        eng.refresh_reputation(T0)
        smart_w = next(w for w in eng.rep.wallets if eng.rep.is_smart(w))
        eng.pending_eval["ORG"] = [T0, 0]
        buy = Trade(trades[-1].slot, T0 + 100, "ORG", smart_w, True, 10**8, 1, 1, 1)
        eng._maybe_smart_trigger(buy)
        assert eng.last_eval["ORG"] == T0 + 100
        eng._maybe_smart_trigger(replace(buy, ts=T0 + 110))  # cooldown içinde → yok sayılır
        assert eng.last_eval["ORG"] == T0 + 100
        await asyncio.sleep(0.05)
        assert "ORG" in eng.entered  # organik token + akıllı cüzdan → BUY
        await eng.tick()  # BUY verilmiş token karar anı kuyruğundan çıkar
        assert "ORG" not in eng.pending_eval

    asyncio.run(go())
