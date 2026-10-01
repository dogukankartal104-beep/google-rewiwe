"""Cüzdanın ilk fonlayıcısını RPC'den çöz.

Taze bundler cüzdanlarının geçmişi kısa olduğundan tek istekte çözülür (ucuz);
binlerce imzası olan köklü cüzdanlar "__deep__" işaretlenir (bağ kurmaz, organik sinyal).
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Optional

import httpx

from .store import Funding, Store


class FundingResolver:
    def __init__(self, rpc_url: str, store: Store, max_pages: int = 3, concurrency: int = 8):
        self.rpc_url = rpc_url
        self.store = store
        self.max_pages = max_pages
        self.sem = asyncio.Semaphore(concurrency)
        self.client = httpx.AsyncClient(timeout=15)
        self._id = 0

    async def aclose(self) -> None:
        await self.client.aclose()

    async def _rpc(self, method: str, params: list) -> Any:
        self._id += 1
        for attempt in range(4):
            async with self.sem:
                r = await self.client.post(
                    self.rpc_url,
                    json={"jsonrpc": "2.0", "id": self._id, "method": method, "params": params},
                )
            if r.status_code == 429:
                await asyncio.sleep(0.5 * 2**attempt)
                continue
            r.raise_for_status()
            body = r.json()
            if "error" in body:
                raise RuntimeError(f"{method}: {body['error']}")
            return body["result"]
        raise RuntimeError(f"{method}: rate limited")

    async def resolve(self, wallet: str) -> Funding:
        oldest: Optional[dict] = None
        before: Optional[str] = None
        for _ in range(self.max_pages):
            opts: dict = {"limit": 1000, "commitment": "confirmed"}
            if before:
                opts["before"] = before
            sigs = await self._rpc("getSignaturesForAddress", [wallet, opts])
            if not sigs:
                break
            oldest, before = sigs[-1], sigs[-1]["signature"]
            if len(sigs) < 1000:
                break
        else:
            return Funding(wallet, "__deep__", 0, None)
        if oldest is None:
            return Funding(wallet, None, 0, None)
        tx = await self._rpc(
            "getTransaction",
            [oldest["signature"], {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0,
                                   "commitment": "confirmed"}],
        )
        funder, lamports = find_funder(tx, wallet)
        return Funding(wallet, funder, lamports, oldest.get("blockTime"))

    async def resolve_many(self, wallets: list[str], timeout_s: float = 20) -> dict[str, Funding]:
        known = self.store.fundings(wallets)
        todo = [w for w in set(wallets) if w not in known]

        async def one(w: str) -> Optional[Funding]:
            try:
                return await self.resolve(w)
            except Exception:
                return None

        tasks = [asyncio.create_task(one(w)) for w in todo]
        if tasks:
            done, pending = await asyncio.wait(tasks, timeout=timeout_s)
            for t in pending:
                t.cancel()
            now = int(time.time())
            for t in done:
                f = t.result()
                if f is not None:
                    self.store.put_funding(f, now)
                    known[f.wallet] = f
            self.store.commit()
        return known


def find_funder(tx: Optional[dict], wallet: str) -> tuple[Optional[str], int]:
    """İlk tx'te cüzdana SOL gönderen system transfer/createAccount'u bul."""
    if not tx:
        return None, 0
    ixs = list(tx["transaction"]["message"].get("instructions", []))
    for inner in (tx.get("meta") or {}).get("innerInstructions") or []:
        ixs.extend(inner.get("instructions", []))
    for ix in ixs:
        if ix.get("program") != "system":
            continue
        parsed = ix.get("parsed") or {}
        info = parsed.get("info") or {}
        kind = parsed.get("type")
        if kind in ("transfer", "transferWithSeed") and info.get("destination") == wallet:
            return info.get("source"), int(info.get("lamports", 0))
        if kind in ("createAccount", "createAccountWithSeed") and info.get("newAccount") == wallet:
            return info.get("source"), int(info.get("lamports", 0))
    return None, 0
