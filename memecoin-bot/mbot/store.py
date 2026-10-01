"""SQLite deposu: ham event'ler + fonlama kaynakları + paper işlemler.

Faz 0'ın asıl çıktısı bu veritabanıdır; tüm modeller buradan beslenir.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

from .pumpfun import CompleteEvent, CreateEvent, TradeEvent

SCHEMA = """
CREATE TABLE IF NOT EXISTS tokens (
    mint TEXT PRIMARY KEY, name TEXT, symbol TEXT, uri TEXT,
    creator TEXT, bonding_curve TEXT,
    created_slot INTEGER, created_ts INTEGER, completed_ts INTEGER
);
CREATE INDEX IF NOT EXISTS tokens_created ON tokens(created_ts);
CREATE INDEX IF NOT EXISTS tokens_creator ON tokens(creator);
CREATE TABLE IF NOT EXISTS trades (
    sig TEXT, idx INTEGER, slot INTEGER, ts INTEGER, mint TEXT, user TEXT,
    is_buy INTEGER, sol INTEGER, tok INTEGER, vsol INTEGER, vtok INTEGER, rsol INTEGER,
    PRIMARY KEY (sig, idx)
);
CREATE INDEX IF NOT EXISTS trades_mint ON trades(mint, slot);
CREATE TABLE IF NOT EXISTS funders (
    wallet TEXT PRIMARY KEY, funder TEXT, lamports INTEGER,
    first_ts INTEGER, resolved_ts INTEGER
);
CREATE TABLE IF NOT EXISTS paper_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT, opened_ts INTEGER, closed_ts INTEGER,
    cost_sol REAL, proceeds_sol REAL, pnl_sol REAL, exit_reason TEXT, scores TEXT
);
"""


@dataclass(frozen=True)
class Trade:
    slot: int
    ts: int
    mint: str
    user: str
    is_buy: bool
    sol: int
    tok: int
    vsol: int
    vtok: int
    rsol: Optional[int] = None
    sig: str = ""
    idx: int = 0


@dataclass(frozen=True)
class Token:
    mint: str
    name: str
    symbol: str
    creator: str
    created_slot: int
    created_ts: int
    completed_ts: Optional[int] = None


@dataclass(frozen=True)
class Funding:
    wallet: str
    funder: Optional[str]  # None = bulunamadı, "__deep__" = çok eski/aktif cüzdan
    lamports: int
    first_ts: Optional[int]


class Store:
    def __init__(self, path: str):
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=NORMAL")
        self.db.executescript(SCHEMA)

    def commit(self) -> None:
        self.db.commit()

    # ------------------------------------------------------------ writes
    def add_event(self, ev, slot: int, sig: str, idx: int) -> None:
        if isinstance(ev, TradeEvent):
            self.db.execute(
                "INSERT OR IGNORE INTO trades VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (sig, idx, slot, ev.timestamp, ev.mint, ev.user, int(ev.is_buy), ev.sol_amount,
                 ev.token_amount, ev.virtual_sol_reserves, ev.virtual_token_reserves,
                 ev.real_sol_reserves),
            )
        elif isinstance(ev, CreateEvent):
            self.db.execute(
                "INSERT OR IGNORE INTO tokens (mint,name,symbol,uri,creator,bonding_curve,"
                "created_slot,created_ts) VALUES (?,?,?,?,?,?,?,?)",
                (ev.mint, ev.name, ev.symbol, ev.uri, ev.creator, ev.bonding_curve, slot,
                 ev.timestamp),
            )
        elif isinstance(ev, CompleteEvent):
            self.db.execute(
                "UPDATE tokens SET completed_ts=? WHERE mint=?", (ev.timestamp, ev.mint)
            )

    def fill_created_ts(self, mint: str, ts: int) -> None:
        """Eski CreateEvent layout'unda timestamp yok → ilk trade'den doldur."""
        self.db.execute(
            "UPDATE tokens SET created_ts=? WHERE mint=? AND created_ts IS NULL", (ts, mint)
        )

    def put_funding(self, f: Funding, now_ts: int) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO funders VALUES (?,?,?,?,?)",
            (f.wallet, f.funder, f.lamports, f.first_ts, now_ts),
        )

    def add_paper_trade(self, mint, opened, closed, cost, proceeds, reason, scores) -> None:
        self.db.execute(
            "INSERT INTO paper_trades (mint,opened_ts,closed_ts,cost_sol,proceeds_sol,pnl_sol,"
            "exit_reason,scores) VALUES (?,?,?,?,?,?,?,?)",
            (mint, opened, closed, cost, proceeds, proceeds - cost, reason, scores),
        )

    # ------------------------------------------------------------ reads
    def token(self, mint: str) -> Optional[Token]:
        row = self.db.execute(
            "SELECT mint,name,symbol,creator,created_slot,created_ts,completed_ts "
            "FROM tokens WHERE mint=?", (mint,),
        ).fetchone()
        return Token(*row) if row else None

    def tokens_created_between(self, t0: int, t1: int) -> list[Token]:
        rows = self.db.execute(
            "SELECT mint,name,symbol,creator,created_slot,created_ts,completed_ts FROM tokens "
            "WHERE created_ts >= ? AND created_ts < ? ORDER BY created_ts", (t0, t1),
        ).fetchall()
        return [Token(*r) for r in rows]

    def trades(self, mint: str, until_ts: Optional[int] = None) -> list[Trade]:
        q = ("SELECT slot,ts,mint,user,is_buy,sol,tok,vsol,vtok,rsol,sig,idx FROM trades "
             "WHERE mint=?")
        args: list = [mint]
        if until_ts is not None:
            q += " AND ts <= ?"
            args.append(until_ts)
        q += " ORDER BY slot, sig, idx"
        return [Trade(r[0], r[1], r[2], r[3], bool(r[4]), *r[5:]) for r in self.db.execute(q, args)]

    def fundings(self, wallets: Iterable[str]) -> dict[str, Funding]:
        ws = list(set(wallets))
        out: dict[str, Funding] = {}
        for i in range(0, len(ws), 500):
            chunk = ws[i : i + 500]
            q = f"SELECT wallet,funder,lamports,first_ts FROM funders WHERE wallet IN ({','.join('?' * len(chunk))})"
            for r in self.db.execute(q, chunk):
                out[r[0]] = Funding(*r)
        return out

    def creator_launches(self, creator: str, t0: int, t1: int) -> int:
        return self.db.execute(
            "SELECT COUNT(*) FROM tokens WHERE creator=? AND created_ts>=? AND created_ts<?",
            (creator, t0, t1),
        ).fetchone()[0]

    def symbol_clones(self, symbol: str, t0: int, t1: int) -> int:
        return self.db.execute(
            "SELECT COUNT(*) FROM tokens WHERE UPPER(symbol)=UPPER(?) AND created_ts>=? "
            "AND created_ts<?", (symbol, t0, t1),
        ).fetchone()[0]
