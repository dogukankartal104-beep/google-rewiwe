"""SQLite deposu: ham event'ler + fonlama kaynakları + paper işlemler.

Faz 0'ın asıl çıktısı bu veritabanıdır; tüm modeller buradan beslenir.
"""

from __future__ import annotations

import hashlib
import sqlite3
from collections import OrderedDict
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
-- 44 karakterlik adresler bir kez saklanır, trade'ler küçük tamsayı id taşır
CREATE TABLE IF NOT EXISTS addrs (id INTEGER PRIMARY KEY, addr TEXT NOT NULL UNIQUE);
-- sig_h: 88 karakterlik imzanın 8 byte özeti (sadece tekrar kaydı önlemek için)
CREATE TABLE IF NOT EXISTS trades (
    sig_h INTEGER, idx INTEGER, slot INTEGER, ts INTEGER, mint_id INTEGER, user_id INTEGER,
    is_buy INTEGER, sol INTEGER, tok INTEGER, vsol INTEGER, vtok INTEGER, rsol INTEGER,
    PRIMARY KEY (sig_h, idx)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS trades_mint ON trades(mint_id, slot);
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


def sig_hash(sig: str) -> int:
    return int.from_bytes(hashlib.blake2b(sig.encode(), digest_size=8).digest(), "big",
                          signed=True)


SCHEMA_VERSION = 2
ADDR_CACHE = 300_000  # ~45 MB üst sınır; günde ~30k token + ~100k+ cüzdan


class Store:
    def __init__(self, path: str):
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=NORMAL")
        self._ids: OrderedDict[str, int] = OrderedDict()
        if self._has_v1_trades():
            self.db.execute("ALTER TABLE trades RENAME TO trades_v1")
            self.db.execute("DROP INDEX IF EXISTS trades_mint")
        self.db.executescript(SCHEMA)
        # yarıda kesilmiş taşıma da burada tamamlanır (INSERT OR IGNORE tekrarları atlar)
        if self.db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND "
                           "name='trades_v1'").fetchone():
            self._migrate_v1()
        self.db.execute(f"PRAGMA user_version={SCHEMA_VERSION}")

    def _has_v1_trades(self) -> bool:
        cols = [r[1] for r in self.db.execute("PRAGMA table_info(trades)")]
        return "sig" in cols

    def _migrate_v1(self) -> None:
        """Eski (metin sütunlu) trade tablosunu yeni kompakt şemaya taşı."""
        cur = self.db.execute("SELECT slot,ts,mint,user,is_buy,sol,tok,vsol,vtok,rsol,sig,idx "
                              "FROM trades_v1")
        while rows := cur.fetchmany(20_000):
            for r in rows:
                self.add_trade(Trade(r[0], r[1], r[2], r[3], bool(r[4]), *r[5:]))
        self.db.execute("DROP TABLE trades_v1")
        self.db.commit()

    def commit(self) -> None:
        self.db.commit()

    # ------------------------------------------------------------ adres id'leri
    def _addr_id(self, addr: str, create: bool = True) -> Optional[int]:
        i = self._ids.get(addr)
        if i is not None:
            self._ids.move_to_end(addr)
            return i
        row = self.db.execute("SELECT id FROM addrs WHERE addr=?", (addr,)).fetchone()
        if row is None:
            if not create:
                return None
            i = self.db.execute("INSERT INTO addrs (addr) VALUES (?)", (addr,)).lastrowid
        else:
            i = row[0]
        self._ids[addr] = i
        if len(self._ids) > ADDR_CACHE:
            self._ids.popitem(last=False)
        return i

    # ------------------------------------------------------------ writes
    def add_trade(self, t: Trade) -> None:
        self.db.execute(
            "INSERT OR IGNORE INTO trades VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (sig_hash(t.sig), t.idx, t.slot, t.ts, self._addr_id(t.mint), self._addr_id(t.user),
             int(t.is_buy), t.sol, t.tok, t.vsol, t.vtok, t.rsol),
        )

    def add_event(self, ev, slot: int, sig: str, idx: int) -> None:
        if isinstance(ev, TradeEvent):
            self.add_trade(Trade(slot, ev.timestamp, ev.mint, ev.user, ev.is_buy, ev.sol_amount,
                                 ev.token_amount, ev.virtual_sol_reserves,
                                 ev.virtual_token_reserves, ev.real_sol_reserves, sig, idx))
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
        mid = self._addr_id(mint, create=False)
        if mid is None:
            return []
        q = ("SELECT t.slot,t.ts,a.addr,t.is_buy,t.sol,t.tok,t.vsol,t.vtok,t.rsol,t.sig_h,t.idx "
             "FROM trades t JOIN addrs a ON a.id = t.user_id WHERE t.mint_id=?")
        args: list = [mid]
        if until_ts is not None:
            q += " AND t.ts <= ?"
            args.append(until_ts)
        q += " ORDER BY t.slot, t.sig_h, t.idx"
        return [Trade(r[0], r[1], mint, r[2], bool(r[3]), r[4], r[5], r[6], r[7], r[8],
                      str(r[9]), r[10]) for r in self.db.execute(q, args)]

    def n_trades(self) -> int:
        return self.db.execute("SELECT COUNT(*) FROM trades").fetchone()[0]

    def fundings(self, wallets: Iterable[str]) -> dict[str, Funding]:
        ws = list(set(wallets))
        out: dict[str, Funding] = {}
        for i in range(0, len(ws), 500):
            chunk = ws[i : i + 500]
            q = f"SELECT wallet,funder,lamports,first_ts FROM funders WHERE wallet IN ({','.join('?' * len(chunk))})"
            for r in self.db.execute(q, chunk):
                out[r[0]] = Funding(*r)
        return out

    def fundings_closure(self, wallets: Iterable[str], depth: int) -> dict[str, Funding]:
        """Cüzdanların + (depth-1) kademe fonlayıcılarının kayıtları."""
        out: dict[str, Funding] = {}
        frontier = set(wallets)
        for _ in range(max(1, depth)):
            got = self.fundings(frontier - out.keys())
            out.update(got)
            frontier = {f.funder for f in got.values()
                        if f.funder and f.funder != "__deep__"} - out.keys()
            if not frontier:
                break
        return out

    def tokens_ended_before(self, ts: int, horizon_s: int) -> list[Token]:
        rows = self.db.execute(
            "SELECT mint,name,symbol,creator,created_slot,created_ts,completed_ts FROM tokens "
            "WHERE created_ts IS NOT NULL AND created_ts + ? <= ? ORDER BY created_ts",
            (horizon_s, ts),
        ).fetchall()
        return [Token(*r) for r in rows]

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
