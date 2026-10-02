import asyncio

from synth import T0

from mbot.config import Config
from mbot.engine import Engine
from mbot.notify import HealthMonitor, Notifier
from mbot.store import Store


def _engine(**kw):
    cfg = Config(db_path=":memory:", **kw)
    return Engine(cfg, Store(":memory:"), resolver=None, trade=True)


def test_notifier_cooldown_and_disabled_mode():
    n = Notifier(cooldown_s=1800)
    assert not n.enabled

    async def go():
        await n.send("a", "k", now=T0)
        await n.send("a again", "k", now=T0 + 60)  # cooldown içinde → bastırılır
        await n.send("a later", "k", now=T0 + 1801)
        await n.send("free", None, now=T0 + 1802)

    asyncio.run(go())
    assert n.sent == ["a", "a later", "free"]


def test_health_alerts_stall_disconnect_disk_halt_and_daily_summary():
    eng = _engine()
    h = HealthMonitor(eng.notifier, ":memory:", stall_s=300, min_free_gb=1e9)  # disk hep "dolu"

    async def go():
        h.set_connected(True, now=T0)
        h.on_event(now=T0)
        await h.check(eng, now=T0 + 100)  # akış normal, sadece disk uyarısı
        await h.check(eng, now=T0 + 400)  # 400 sn event yok → akış durdu
        h.set_connected(False, now=T0 + 500)
        await h.check(eng, now=T0 + 900)
        for m in "abcdefgh":  # 8 ardışık kayıp → kill switch
            eng.risk.on_close(m, -0.001, T0 + 900)
        await h.check(eng, now=T0 + 960)
        await h.check(eng, now=T0 + 1020)  # aynı durma sebebi tekrar bildirilmez
        await h.check(eng, now=T0 + 86_400)  # gün değişti → günlük özet

    asyncio.run(go())
    text = "\n".join(eng.notifier.sent)
    assert "Disk dolmak üzere" in text and "Veri akışı durdu" in text
    assert "WebSocket" in text and text.count("İşlem durdu") == 1
    assert "Günlük özet" in text and "Equity" in text


def test_trade_notifications_respect_flag():
    eng = _engine(notify_trades=0)
    eng.notify("x")  # döngü yokken çökmemeli
    assert eng.notifier.sent == []
