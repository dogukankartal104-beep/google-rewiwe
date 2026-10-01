"""Pump.fun bonding-curve programı: event decode + curve matematiği.

Event'ler Anchor `emit!` ile log'a "Program data: <base64>" olarak yazılır.
İlk 8 byte = sha256("event:<Name>")[:8]. Layout program güncellemeleriyle
uzayabildiği için sadece bilinen önek alanları okunur, fazlası yok sayılır.
"""

from __future__ import annotations

import base64
import binascii
import struct
from dataclasses import dataclass
from typing import Optional, Union

from .b58 import b58encode

PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"

TRADE_DISC = bytes([189, 219, 127, 211, 78, 230, 97, 238])
CREATE_DISC = bytes([27, 114, 169, 77, 222, 235, 99, 118])
COMPLETE_DISC = bytes([95, 114, 97, 156, 212, 46, 152, 8])

LAMPORTS = 10**9
TOKEN_DECIMALS = 6

# Curve başlangıç durumu (pump.fun global config varsayılanları).
INITIAL_VIRTUAL_SOL = 30 * LAMPORTS
INITIAL_VIRTUAL_TOKEN = 1_073_000_000 * 10**TOKEN_DECIMALS
INITIAL_REAL_TOKEN = 793_100_000 * 10**TOKEN_DECIMALS
# virtual_token - real_token sabit kalır; real token rezervini buradan türetiriz.
TOKEN_RESERVE_GAP = INITIAL_VIRTUAL_TOKEN - INITIAL_REAL_TOKEN


@dataclass(frozen=True)
class TradeEvent:
    mint: str
    sol_amount: int  # lamports
    token_amount: int  # raw (6 decimals)
    is_buy: bool
    user: str
    timestamp: int
    virtual_sol_reserves: int
    virtual_token_reserves: int
    real_sol_reserves: Optional[int] = None
    real_token_reserves: Optional[int] = None


@dataclass(frozen=True)
class CreateEvent:
    name: str
    symbol: str
    uri: str
    mint: str
    bonding_curve: str
    user: str
    creator: str
    timestamp: Optional[int] = None


@dataclass(frozen=True)
class CompleteEvent:
    user: str
    mint: str
    bonding_curve: str
    timestamp: int


Event = Union[TradeEvent, CreateEvent, CompleteEvent]


class _Reader:
    def __init__(self, data: bytes):
        self.d = data
        self.o = 0

    def remaining(self) -> int:
        return len(self.d) - self.o

    def take(self, n: int) -> bytes:
        if self.o + n > len(self.d):
            raise ValueError("buffer underrun")
        b = self.d[self.o : self.o + n]
        self.o += n
        return b

    def u64(self) -> int:
        return struct.unpack("<Q", self.take(8))[0]

    def i64(self) -> int:
        return struct.unpack("<q", self.take(8))[0]

    def boolean(self) -> bool:
        return self.take(1)[0] != 0

    def pubkey(self) -> str:
        return b58encode(self.take(32))

    def string(self) -> str:
        (n,) = struct.unpack("<I", self.take(4))
        return self.take(n).decode("utf-8", "replace")


def decode_event(data: bytes) -> Optional[Event]:
    if len(data) < 8:
        return None
    disc, r = data[:8], _Reader(data[8:])
    try:
        if disc == TRADE_DISC:
            mint, sol, tok, is_buy, user, ts, vsol, vtok = (
                r.pubkey(), r.u64(), r.u64(), r.boolean(), r.pubkey(), r.i64(), r.u64(), r.u64(),
            )
            rsol = rtok = None
            if r.remaining() >= 16:
                rsol, rtok = r.u64(), r.u64()
            return TradeEvent(mint, sol, tok, is_buy, user, ts, vsol, vtok, rsol, rtok)
        if disc == CREATE_DISC:
            name, symbol, uri = r.string(), r.string(), r.string()
            mint, curve, user = r.pubkey(), r.pubkey(), r.pubkey()
            creator = r.pubkey() if r.remaining() >= 32 else user
            ts = r.i64() if r.remaining() >= 8 else None
            return CreateEvent(name, symbol, uri, mint, curve, user, creator, ts)
        if disc == COMPLETE_DISC:
            return CompleteEvent(r.pubkey(), r.pubkey(), r.pubkey(), r.i64())
    except (ValueError, struct.error):
        return None
    return None


def parse_logs(logs: list[str]) -> list[Event]:
    events: list[Event] = []
    for line in logs:
        if not line.startswith("Program data: "):
            continue
        try:
            raw = base64.b64decode(line[len("Program data: ") :], validate=True)
        except (binascii.Error, ValueError):
            continue
        ev = decode_event(raw)
        if ev is not None:
            events.append(ev)
    return events


# ---------------------------------------------------------------- curve math

def price(vsol: int, vtok: int) -> float:
    """SOL / token (UI birimleri)."""
    return (vsol / LAMPORTS) / (vtok / 10**TOKEN_DECIMALS)


INITIAL_PRICE = price(INITIAL_VIRTUAL_SOL, INITIAL_VIRTUAL_TOKEN)


def real_sol(vsol: int, rsol: Optional[int] = None) -> int:
    return rsol if rsol is not None else max(0, vsol - INITIAL_VIRTUAL_SOL)


def curve_progress(vtok: int) -> float:
    """0 = yeni launch, 1 = graduation (satılabilir token kalmadı)."""
    real_tok = max(0, vtok - TOKEN_RESERVE_GAP)
    return min(1.0, max(0.0, 1 - real_tok / INITIAL_REAL_TOKEN))


def buy_quote(sol_in: int, vsol: int, vtok: int, fee_bps: int) -> tuple[int, int, int]:
    """SOL harca → (alınan token, yeni vsol, yeni vtok). Fee SOL'den kesilir."""
    net = sol_in * (10_000 - fee_bps) // 10_000
    new_vsol = vsol + net
    new_vtok = (vsol * vtok + new_vsol - 1) // new_vsol  # ceil: program lehine
    return vtok - new_vtok, new_vsol, new_vtok


def sell_quote(tok_in: int, vsol: int, vtok: int, fee_bps: int) -> tuple[int, int, int]:
    """Token sat → (net SOL, yeni vsol, yeni vtok)."""
    new_vtok = vtok + tok_in
    new_vsol = (vsol * vtok + new_vtok - 1) // new_vtok
    gross = vsol - new_vsol
    return gross * (10_000 - fee_bps) // 10_000, new_vsol, new_vtok
