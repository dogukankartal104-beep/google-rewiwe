import base64
import os
import struct

from mbot import pumpfun as pf
from mbot.b58 import b58decode, b58encode


def _pk(seed: int) -> bytes:
    return bytes([seed]) * 32


def test_b58_roundtrip():
    for raw in (b"\0\0abc", os.urandom(32), b"\0" * 32):
        assert b58decode(b58encode(raw)) == raw
    assert b58encode(b58decode(pf.PROGRAM_ID)) == pf.PROGRAM_ID


def _trade_bytes(extra: bool) -> bytes:
    body = (_pk(1) + struct.pack("<QQ?", 2 * 10**9, 5 * 10**12, True) + _pk(2)
            + struct.pack("<qQQ", 1_780_000_000, 32 * 10**9, 1_000_000 * 10**6))
    if extra:
        body += struct.pack("<QQ", 2 * 10**9, 700_000_000 * 10**6) + os.urandom(64)
    return pf.TRADE_DISC + body


def test_decode_trade_both_layouts():
    for extra in (False, True):
        line = "Program data: " + base64.b64encode(_trade_bytes(extra)).decode()
        evs = pf.parse_logs(["Program log: Instruction: Buy", line, "Program data: !!notb64",
                             "Program data: " + base64.b64encode(b"\1" * 40).decode()])
        assert len(evs) == 1
        e = evs[0]
        assert isinstance(e, pf.TradeEvent)
        assert e.mint == b58encode(_pk(1)) and e.user == b58encode(_pk(2))
        assert e.is_buy and e.sol_amount == 2 * 10**9 and e.timestamp == 1_780_000_000
        assert e.real_sol_reserves == (2 * 10**9 if extra else None)


def test_decode_create_and_complete():
    def s(x: str) -> bytes:
        return struct.pack("<I", len(x.encode())) + x.encode()

    raw = pf.CREATE_DISC + s("Dog Wif") + s("WIF") + s("ipfs://x") + _pk(3) + _pk(4) + _pk(5)
    (e,) = pf.parse_logs(["Program data: " + base64.b64encode(raw).decode()])
    assert (e.name, e.symbol, e.creator, e.timestamp) == ("Dog Wif", "WIF", b58encode(_pk(5)), None)
    raw2 = raw + _pk(6) + struct.pack("<q", 123)
    (e2,) = pf.parse_logs(["Program data: " + base64.b64encode(raw2).decode()])
    assert e2.creator == b58encode(_pk(6)) and e2.timestamp == 123
    raw3 = pf.COMPLETE_DISC + _pk(1) + _pk(2) + _pk(3) + struct.pack("<q", 9)
    (c,) = pf.parse_logs(["Program data: " + base64.b64encode(raw3).decode()])
    assert isinstance(c, pf.CompleteEvent) and c.timestamp == 9


def test_truncated_event_is_ignored():
    assert pf.decode_event(_trade_bytes(False)[:50]) is None


def test_curve_round_trip_loses_fees():
    v, t = pf.INITIAL_VIRTUAL_SOL, pf.INITIAL_VIRTUAL_TOKEN
    tok, v2, t2 = pf.buy_quote(10**9, v, t, 100)
    sol, v3, t3 = pf.sell_quote(tok, v2, t2, 100)
    assert 0.97 * 10**9 < sol < 0.99 * 10**9
    assert v3 >= v and t3 == t
    assert pf.curve_progress(t) == 0.0
    assert pf.curve_progress(pf.TOKEN_RESERVE_GAP) == 1.0
    assert pf.price(v2, t2) > pf.INITIAL_PRICE
