from dataclasses import replace

from synth import SLOT0, T0, load, manipulated, organic
from test_advanced import _shift
from test_execution import _at

from mbot.analysis import cost_report, drift, golive, reconcile
from mbot.config import Config
from mbot.dataset import Case, iter_cases
from mbot.model import LogisticModel
from mbot.paper import simulate
from mbot.risk import position_size
from mbot.store import Store, Token

NOW = T0 + 3 * 3600


def _store(n_org=40, n_man=20):
    s = Store(":memory:")
    for i in range(n_org):
        load(s, *_shift(organic(seed=500 + i, tail=20), i * 30, f"O{i}", unique=True))
    for i in range(n_man):
        load(s, *_shift(manipulated(seed=i, tail=20), i * 30 + 15, f"X{i}", unique=True))
    return s


def _paper_from_backtest(s, cfg, bias=0.0):
    """Backtest'in kendi sonuçlarını paper işlem gibi yaz (bias: gerçek dünyadaki kayıp)."""
    for c in iter_cases(s, cfg, T0 - 1, NOW):
        if c.verdict.decision != "BUY":
            continue
        p = simulate(c.tok.mint, c.decision_trade, c.after,
                     position_size(cfg.equity_sol, cfg, c.f["real_sol"]), c.end_ts, cfg, c.watch)
        if p:
            s.add_paper_trade(c.tok.mint, p.opened_ts, p.closed_ts, p.cost_sol,
                              p.proceeds_sol + bias * p.cost_sol, p.exit_reason, "{}")
    s.commit()


def test_reconcile_matches_and_flags_optimistic_backtest():
    cfg = Config()
    s = _store()
    _paper_from_backtest(s, cfg)
    r = reconcile(s, cfg, NOW)
    assert r.n_pairs >= 20 and abs(r.gap) < 1e-9 and r.exit_match == 1.0
    assert "uyumlu" in r.text

    s2 = _store()
    _paper_from_backtest(s2, cfg, bias=-0.10)  # gerçekte her işlem 10 puan kötü
    r2 = reconcile(s2, cfg, NOW)
    assert abs(r2.gap + 0.10) < 1e-6 and "iyimser" in r2.text


def test_cost_breakeven():
    cfg = Config()
    tok = Token("M", "m", "M", "dev", SLOT0, T0)
    slow = [_at(1.0 + 0.004 * i, T0 + 1 + i) for i in range(60)]
    case = Case(tok, {"real_sol": 30.0}, None, _at(1.0, T0), slow, T0 + 1800, {})
    out = cost_report([case] * 5, replace(cfg, time_stop_s=50))
    assert "maliyet ×0" in out and "maliyet ×5.0" in out
    assert "sıfırlanıyor" in out or "Mevcut maliyetlerde bile" in out or "dayanıyor" in out


def test_drift_detects_inverted_model(tmp_path):
    cfg = Config(model_dir=str(tmp_path))
    s = _store()
    # cohesion yüksek = kazanır diyen (tersine) model: manipüle tokenlar yüksek cohesion'lı ve kaybettirir
    LogisticModel(["cohesion"], [0.0], [0.05], [3.0], 0.0, {"wf_auc": [0.8, 0.8]}).save(tmp_path / "win.json")
    d = drift(s, cfg, hours=4, now=NOW)
    assert d.stale and "ESKİDİ" in d.text and "cohesion" in d.text

    LogisticModel(["cohesion"], [0.3], [0.4], [-3.0], 0.0, {"wf_auc": [0.8]}).save(tmp_path / "win.json")
    assert not drift(s, cfg, hours=4, now=NOW).stale


def test_golive_blocks_without_evidence(tmp_path):
    cfg = Config(model_dir=str(tmp_path))
    out = golive(Store(":memory:"), cfg, now=NOW)
    assert "🔴 CANLIYA HAZIR DEĞİL" in out and "Paper işlem sayısı" in out

    s = _store()
    _paper_from_backtest(s, cfg)
    out2 = golive(s, replace(cfg, golive_min_paper=10), hours=4, now=NOW)
    assert "✅ Paper işlem sayısı" in out2
    assert "❌ Model walk-forward" in out2 and "🔴" in out2  # model yok → hâlâ hazır değil
