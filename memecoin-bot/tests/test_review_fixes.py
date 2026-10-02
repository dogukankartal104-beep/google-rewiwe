"""Kod incelemesinde bulunan hataların geri gelmemesi için."""
from dataclasses import replace

from synth import SLOT0, T0, run_curve
from test_advanced import _rows

import mbot.model as model
from mbot.config import Config
from mbot.risk import RiskManager
from mbot.store import Store


def test_pending_orders_count_toward_max_open():
    r = RiskManager(Config(max_open=2))
    r.on_open("a", 0.05)
    assert r.can_open("b", T0)[0]
    assert r.can_open("b", T0, pending=1) == (False, "max açık pozisyon")


def test_numeric_looking_symbol_is_not_a_feature(tmp_path):
    rows = _rows()
    rows[0]["symbol"] = "420"  # ilk satırda sayı gibi görünen sembol
    assert "symbol" not in model.feature_keys(rows) and "mint" not in model.feature_keys(rows)
    model.train_all(rows, str(tmp_path))  # eskiden ValueError ile çökerdi


def test_walk_forward_purges_overlapping_tokens(monkeypatch):
    rows = _rows()
    for i in range(0, len(rows), 2):  # her token iki karar anı satırı taşısın
        rows[i + 1]["mint"] = rows[i]["mint"]
    seen = []
    real_fit = model.fit

    def spy(train, *a, **k):
        seen.append(train)
        return real_fit(train, *a, **k)

    monkeypatch.setattr(model, "fit", spy)
    rows_sorted = sorted(rows, key=model._when)
    size = len(rows) // 6
    model.walk_forward(rows, "win", embargo_s=1800)
    for k, train in enumerate(seen, start=1):
        test = rows_sorted[k * size:(k + 1) * size]
        t_start = model._when(test[0])
        assert not {r["mint"] for r in train} & {r["mint"] for r in test}
        assert all(model._when(r) + 1800 <= t_start for r in train)


def test_label_window_waits_for_last_checkpoint():
    assert Config(decision_ages="60,600", horizon_s=1800).label_lag_s == 2400


def test_store_returns_real_execution_order_within_slot():
    orders = [(SLOT0 + 5, T0, f"w{i}", i % 3 != 2, 0.3 if i % 3 != 2 else 0.5) for i in range(9)]
    trades = [replace(t, slot=SLOT0 + 5) for t in run_curve("M", orders)]
    s = Store(":memory:")
    for t in reversed(trades):  # imza özeti sırası ≠ yürütme sırası
        s.add_trade(t)
    got = s.trades("M")
    assert [t.vtok for t in got] == [t.vtok for t in trades]
