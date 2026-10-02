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
from .cohort import build_cohorts
from .features import compute_features, insider_watch
from .funding import FundingResolver
from .model import load_models
from .paper import Position, close, expected_tokens, on_trade, open_position
from .reputation import Reputation
from .risk import RiskManager
from .scoring import Verdict, evaluate
from .store import Store, Trade

log = logging.getLogger("mbot")


class Engine:
    def __init__(self, cfg: Config, store: Store, resolver: Optional[FundingResolver], trade: bool):
        self.cfg, self.store, self.resolver, self.trade = cfg, store, resolver, trade
        self.risk = RiskManager(cfg)
        self.pending_eval: dict[str, int] = {}  # mint → created_ts
        # mint → (boyut, karar, insider watch, karar anında beklenen token)
        self.pending_fill: dict[str, tuple[float, Verdict, dict[str, int], int]] = {}
        self.positions: dict[str, tuple[Position, Verdict]] = {}
        self.last: dict[str, Trade] = {}
        self.n_events = 0
        self._last_prune = 0
        self.models = load_models(cfg.model_dir)
        self.rep = Reputation(cfg)
        self._last_rep = 0
        if self.models:
            log.info("modeller yüklendi: %s", ", ".join(self.models))

    def refresh_reputation(self, now: int) -> None:
        n = self.rep.refresh_from_store(self.store, now)
        self._last_rep = now
        if n:
            smart = sum(1 for w in self.rep.wallets if self.rep.is_smart(w))
            log.info("itibar: +%d token, %d cüzdan, %d akıllı", n, len(self.rep.wallets), smart)

    # ------------------------------------------------------------- events
    def on_event(self, ev: pf.Event, slot: int, sig: str, idx: int) -> None:
        self.store.add_event(ev, slot, sig, idx)
        self.n_events += 1
        if isinstance(ev, pf.CreateEvent):
            cts = ev.timestamp
            if cts is None:  # eski layout: timestamp yok → duvar saati
                cts = int(time.time())
                self.store.fill_created_ts(ev.mint, cts)
            self.pending_eval[ev.mint] = cts
        elif isinstance(ev, pf.TradeEvent):
            t = Trade(slot, ev.timestamp, ev.mint, ev.user, ev.is_buy, ev.sol_amount,
                      ev.token_amount, ev.virtual_sol_reserves, ev.virtual_token_reserves,
                      ev.real_sol_reserves, sig, idx)
            self.last[ev.mint] = t
            self._on_trade(t)
        elif isinstance(ev, pf.CompleteEvent) and ev.mint in self.positions:
            last = self.last[ev.mint]
            self._finish(ev.mint, last.vsol, last.vtok, ev.timestamp, "graduated")

    def _on_trade(self, t: Trade) -> None:
        if t.mint in self.pending_fill:  # latency: kararın ardından gelen ilk trade'de dol
            size, verdict, watch, want = self.pending_fill.pop(t.mint)
            if expected_tokens(size, t.vsol, t.vtok, self.cfg) * (1 + self.cfg.max_entry_slippage) < want:
                log.info("SLIPPAGE  %s fiyat kaçtı, alım dolmadı", t.mint)
                return
            p = open_position(t.mint, size, t.vsol, t.vtok, t.ts, self.cfg, watch)
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
            if now >= cts + self.cfg.decision_age_s:
                del self.pending_eval[mint]
                asyncio.create_task(self._evaluate(mint, cts + self.cfg.decision_age_s))
        for mint, (p, _) in list(self.positions.items()):
            if now - p.opened_ts >= self.cfg.time_stop_s:
                last = self.last[mint]
                self._finish(mint, last.vsol, last.vtok, now, "time")
        if now - self._last_rep >= self.cfg.rep_refresh_s:
            self.refresh_reputation(now)
        if now - self._last_prune >= 60:
            self.prune(now)
        self.store.commit()

    def prune(self, now: int, idle_s: int = 3600) -> None:
        """Günde ~30k token açılıyor; 1 saattir trade görmeyenleri bellekten at."""
        self._last_prune = now
        keep = self.positions.keys() | self.pending_fill.keys()
        for mint in [m for m, t in self.last.items() if t.ts < now - idle_s and m not in keep]:
            del self.last[mint]

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
            await self.resolver.resolve_many(buyers[:60] + [tok.creator],
                                             depth=self.cfg.funding_depth,
                                             hubs=frozenset(self.cfg.hubs))
        users = {t.user for t in trades} | {tok.creator}
        fundings = self.store.fundings_closure(users, self.cfg.funding_depth)
        coh = build_cohorts(tok, trades, fundings, self.cfg.hubs, self.cfg.same_slot_size_tol,
                            self.cfg.funding_depth)
        f = compute_features(tok, trades, fundings, t_d, self.cfg.hubs,
                             self.cfg.same_slot_size_tol, self.cfg.fresh_wallet_s,
                             self.cfg.funding_depth, self.rep, coh)
        v = evaluate(tok, f, self.store, self.cfg, self.models)
        log.info("%-5s %s %-10s org=%3.0f man=%3.0f surv=%3.0f eff=%d/%d smart=%d mev=%.0f%% %s %s",
                 v.decision, mint, tok.symbol[:10], v.organic, v.manipulation, v.survival,
                 f["effective_buyers"], f["unique_buyers"], f["smart_clusters"],
                 f["mev_share"] * 100, v.probs or "", "; ".join(v.reasons))
        if v.decision == "BUY" and self.trade:
            ok, why = self.risk.can_open(mint, int(time.time()), f["real_sol"])
            if ok:
                watch = insider_watch(tok, trades, coh, self.rep)
                size = self.risk.size_sol(f["real_sol"])
                last = trades[-1]
                self.pending_fill[mint] = (size, v, watch,
                                           expected_tokens(size, last.vsol, last.vtok, self.cfg))
            else:
                log.info("RISK BLOCK %s: %s", mint, why)


async def run(cfg: Config, store: Store, trade: bool, resolve_funders: bool) -> None:
    resolver = FundingResolver(cfg.rpc_url, store, cfg.funder_max_pages) if resolve_funders else None
    engine = Engine(cfg, store, resolver, trade)
    engine.refresh_reputation(int(time.time()))

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
