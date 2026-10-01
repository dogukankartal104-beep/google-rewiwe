"""Canlı akış: WebSocket → depo → (opsiyonel) karar + paper trading.

Gerçek emir GÖNDERMEZ. Canlı yürütme modülü ancak paper sonuçları
dataset/report ile tutarlı çıktıktan sonra eklenmelidir (Faz 4).
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Optional

import websockets

from . import pumpfun as pf
from .config import Config
from .features import compute_features
from .funding import FundingResolver
from .paper import Position, close, on_trade, open_position
from .risk import RiskManager
from .scoring import Verdict, evaluate
from .store import Store, Trade

log = logging.getLogger("mbot")


class Engine:
    def __init__(self, cfg: Config, store: Store, resolver: Optional[FundingResolver], trade: bool):
        self.cfg, self.store, self.resolver, self.trade = cfg, store, resolver, trade
        self.risk = RiskManager(cfg)
        self.pending_eval: dict[str, Optional[int]] = {}  # mint → created_ts
        self.pending_fill: dict[str, tuple[float, Verdict]] = {}
        self.positions: dict[str, tuple[Position, Verdict]] = {}
        self.last: dict[str, Trade] = {}
        self.n_events = 0

    # ------------------------------------------------------------- events
    def on_event(self, ev: pf.Event, slot: int, sig: str, idx: int) -> None:
        self.store.add_event(ev, slot, sig, idx)
        self.n_events += 1
        if isinstance(ev, pf.CreateEvent):
            self.pending_eval[ev.mint] = ev.timestamp
        elif isinstance(ev, pf.TradeEvent):
            t = Trade(slot, ev.timestamp, ev.mint, ev.user, ev.is_buy, ev.sol_amount,
                      ev.token_amount, ev.virtual_sol_reserves, ev.virtual_token_reserves,
                      ev.real_sol_reserves, sig, idx)
            if ev.mint in self.pending_eval and self.pending_eval[ev.mint] is None:
                self.pending_eval[ev.mint] = ev.timestamp
                self.store.fill_created_ts(ev.mint, ev.timestamp)
            self.last[ev.mint] = t
            self._on_trade(t)
        elif isinstance(ev, pf.CompleteEvent) and ev.mint in self.positions:
            last = self.last[ev.mint]
            self._finish(ev.mint, last.vsol, last.vtok, ev.timestamp, "graduated")

    def _on_trade(self, t: Trade) -> None:
        if t.mint in self.pending_fill:  # latency: kararın ardından gelen ilk trade'de dol
            size, verdict = self.pending_fill.pop(t.mint)
            p = open_position(t.mint, size, t.vsol, t.vtok, t.ts, self.cfg)
            self.positions[t.mint] = (p, verdict)
            self.risk.on_open(t.mint, p.cost_sol)
            log.info("PAPER BUY  %s %.3f SOL ref=%.3e", t.mint, size, p.ref_price)
            return
        if t.mint in self.positions:
            p, _ = self.positions[t.mint]
            if on_trade(p, t, self.cfg):
                self._record(t.mint)

    def _finish(self, mint: str, vsol: int, vtok: int, ts: int, reason: str) -> None:
        p, _ = self.positions[mint]
        close(p, vsol, vtok, ts, reason, self.cfg)
        self._record(mint)

    def _record(self, mint: str) -> None:
        p, v = self.positions.pop(mint)
        self.risk.on_close(mint, p.pnl_sol, p.closed_ts or int(time.time()))
        self.store.add_paper_trade(mint, p.opened_ts, p.closed_ts, p.cost_sol, p.proceeds_sol,
                                   p.exit_reason, json.dumps(v.as_dict(), ensure_ascii=False))
        log.info("PAPER EXIT %s %s pnl=%+.4f SOL (%+.1f%%) equity=%.3f", mint, p.exit_reason,
                 p.pnl_sol, p.ret * 100, self.risk.equity)

    # ------------------------------------------------------------- timer
    async def tick(self) -> None:
        now = int(time.time())
        for mint, cts in list(self.pending_eval.items()):
            if cts is not None and now >= cts + self.cfg.decision_age_s:
                del self.pending_eval[mint]
                asyncio.create_task(self._evaluate(mint, cts + self.cfg.decision_age_s))
            elif cts is None and mint not in self.last and len(self.pending_eval) > 50_000:
                del self.pending_eval[mint]  # hiç trade gelmeyen ölü launch
        for mint, (p, _) in list(self.positions.items()):
            if now - p.opened_ts >= self.cfg.time_stop_s:
                last = self.last[mint]
                self._finish(mint, last.vsol, last.vtok, now, "time")
        self.store.commit()

    async def _evaluate(self, mint: str, t_d: int) -> None:
        tok = self.store.token(mint)
        trades = self.store.trades(mint, until_ts=t_d)
        if tok is None or len(trades) < self.cfg.min_trades:
            return
        vol: dict[str, int] = {}
        for t in trades:
            if t.is_buy:
                vol[t.user] = vol.get(t.user, 0) + t.sol
        buyers = sorted(vol, key=vol.get, reverse=True)
        if self.resolver:  # RPC bütçesi: hacmin çoğunu taşıyan ilk 60 alıcı
            fundings = await self.resolver.resolve_many(buyers[:60] + [tok.creator])
        else:
            fundings = self.store.fundings(buyers)
        f = compute_features(tok, trades, fundings, t_d, self.cfg.hubs,
                             self.cfg.same_slot_size_tol, self.cfg.fresh_wallet_s)
        v = evaluate(tok, f, self.store, self.cfg)
        log.info("%-5s %s %-10s org=%3.0f man=%3.0f surv=%3.0f eff=%d/%d  %s", v.decision, mint,
                 tok.symbol[:10], v.organic, v.manipulation, v.survival, f["effective_buyers"],
                 f["unique_buyers"], "; ".join(v.reasons))
        if v.decision == "BUY" and self.trade:
            ok, why = self.risk.can_open(mint, int(time.time()))
            if ok:
                self.pending_fill[mint] = (self.risk.size_sol(), v)
            else:
                log.info("RISK BLOCK %s: %s", mint, why)


async def run(cfg: Config, store: Store, trade: bool, resolve_funders: bool) -> None:
    resolver = FundingResolver(cfg.rpc_url, store, cfg.funder_max_pages) if resolve_funders else None
    engine = Engine(cfg, store, resolver, trade)

    async def ticker() -> None:
        while True:
            await asyncio.sleep(1)
            await engine.tick()

    tick_task = asyncio.create_task(ticker())
    backoff = 1
    try:
        while True:
            try:
                async with websockets.connect(cfg.ws_url, ping_interval=20, max_size=None) as ws:
                    await ws.send(json.dumps({
                        "jsonrpc": "2.0", "id": 1, "method": "logsSubscribe",
                        "params": [{"mentions": [pf.PROGRAM_ID]}, {"commitment": "confirmed"}],
                    }))
                    log.info("bağlandı: %s", cfg.ws_url)
                    backoff = 1
                    async for raw in ws:
                        msg = json.loads(raw)
                        if msg.get("method") != "logsNotification":
                            continue
                        res = msg["params"]["result"]
                        val = res["value"]
                        if val.get("err") is not None:
                            continue
                        for i, ev in enumerate(pf.parse_logs(val.get("logs") or [])):
                            engine.on_event(ev, res["context"]["slot"], val["signature"], i)
            except (OSError, websockets.WebSocketException) as e:
                log.warning("WS koptu (%s), %ss sonra tekrar", e, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)
    finally:
        tick_task.cancel()
        store.commit()
        if resolver:
            await resolver.aclose()
