"""Telegram bildirimleri + sağlık izleme. Bot haftalarca tek başına çalışırken bir şey
bozulursa (akış durdu, bağlantı koptu, disk doldu, kill switch) haberin olsun.

Ayar: MBOT_TELEGRAM_TOKEN (BotFather'dan) ve MBOT_TELEGRAM_CHAT_ID. Boşsa sessizce
sadece log'a yazar. Aynı uyarı `alert_cooldown_s` içinde tekrar gönderilmez.
"""

from __future__ import annotations

import logging
import shutil
import time
from pathlib import Path
from typing import Optional

import httpx

log = logging.getLogger("mbot")


class Notifier:
    def __init__(self, token: str = "", chat_id: str = "", cooldown_s: int = 1800):
        self.token, self.chat_id, self.cooldown_s = token, chat_id, cooldown_s
        self._last: dict[str, float] = {}
        self.sent: list[str] = []  # testler ve log için

    @property
    def enabled(self) -> bool:
        return bool(self.token and self.chat_id)

    async def send(self, text: str, key: Optional[str] = None, now: Optional[float] = None) -> bool:
        """key verilirse aynı uyarı cooldown boyunca tekrar gönderilmez."""
        now = time.time() if now is None else now
        if key is not None:
            if now - self._last.get(key, -1e18) < self.cooldown_s:
                return False
            self._last[key] = now
        self.sent.append(text)
        log.info("BİLDİRİM %s", text.replace("\n", " | "))
        if not self.enabled:
            return False
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.post(f"https://api.telegram.org/bot{self.token}/sendMessage",
                                 json={"chat_id": self.chat_id, "text": text})
            return r.status_code == 200
        except httpx.HTTPError as e:
            log.warning("telegram gönderilemedi: %s", e)
            return False


def disk_free_gb(path: str) -> float:
    p = Path(path).resolve()
    while not p.exists() and p != p.parent:
        p = p.parent
    return shutil.disk_usage(p).free / 1e9


def db_size_mb(path: str) -> float:
    total = 0
    for suffix in ("", "-wal", "-shm"):
        f = Path(path + suffix)
        if f.exists():
            total += f.stat().st_size
    return total / 1e6


class HealthMonitor:
    """Engine.tick tarafından dakikada bir çağrılır."""

    def __init__(self, notifier: Notifier, db_path: str, stall_s: int = 300,
                 min_free_gb: float = 1.0):
        self.n, self.db_path, self.stall_s, self.min_free_gb = notifier, db_path, stall_s, min_free_gb
        self.last_event = time.time()
        self.connected = False
        self.disconnected_since: Optional[float] = time.time()
        self._halt_reported: Optional[str] = None
        self._day: Optional[str] = None

    def on_event(self, now: Optional[float] = None) -> None:
        self.last_event = time.time() if now is None else now

    def set_connected(self, ok: bool, now: Optional[float] = None) -> None:
        now = time.time() if now is None else now
        self.connected = ok
        self.disconnected_since = None if ok else (self.disconnected_since or now)

    async def check(self, engine, now: Optional[float] = None) -> None:
        now = time.time() if now is None else now
        if self.connected and now - self.last_event > self.stall_s:
            await self.n.send(f"⚠️ Veri akışı durdu: {int((now - self.last_event) / 60)} dakikadır "
                              "event gelmiyor (RPC/WebSocket sorunu olabilir).", "stall", now)
        if self.disconnected_since and now - self.disconnected_since > self.stall_s:
            await self.n.send(f"🔌 WebSocket {int((now - self.disconnected_since) / 60)} dakikadır "
                              "bağlı değil.", "disconnected", now)
        free = disk_free_gb(self.db_path)
        if free < self.min_free_gb:
            await self.n.send(f"💾 Disk dolmak üzere: {free:.2f} GB boş kaldı "
                              f"(veritabanı {db_size_mb(self.db_path):.0f} MB).", "disk", now)
        halt = engine.risk.halted(int(now))
        if halt and halt != self._halt_reported:
            await self.n.send(f"🛑 İşlem durdu: {halt}. Equity {engine.risk.equity:.3f} SOL.",
                              None, now)
        self._halt_reported = halt
        day = time.strftime("%Y-%m-%d", time.gmtime(now))
        if self._day is None:
            self._day = day
        elif day != self._day:
            self._day = day
            await self.n.send(daily_summary(engine, now), None, now)


def daily_summary(engine, now: float) -> str:
    db = engine.store.db
    since = int(now) - 86_400
    toks = db.execute("SELECT COUNT(*) FROM tokens WHERE created_ts >= ?", (since,)).fetchone()[0]
    pt = db.execute("SELECT COUNT(*), COALESCE(SUM(pnl_sol),0), AVG(pnl_sol > 0) FROM paper_trades "
                    "WHERE closed_ts >= ?", (since,)).fetchone()
    lines = [
        "📊 Günlük özet (son 24 saat)",
        f"Yeni token: {toks}   toplam trade: {engine.store.n_trades()}",
        f"Veritabanı: {db_size_mb(engine.store_path):.0f} MB, boş disk {disk_free_gb(engine.store_path):.1f} GB",
        f"Paper: {pt[0]} işlem, {pt[1]:+.4f} SOL" + (f", kazanma %{pt[2] * 100:.0f}" if pt[0] else ""),
        f"Equity: {engine.risk.equity:.3f} SOL, açık pozisyon: {len(engine.positions)}",
    ]
    return "\n".join(lines)
