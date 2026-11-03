"""Telegram kanal uye aktarici (yalnizca yonetici oldugun kanallar icin).

Davet baglantilarini yapistir -> hesabinin yonetici/kurucu oldugu kanallarin
uyelerini cek -> tek Excel dosyasi indir (her kanal ayri sayfa).
Telefon numarasi alinmaz; Telegram bunu yoneticilere de vermez.
"""
import asyncio
import io
import sqlite3
import json
import re
import threading
import webbrowser
from datetime import datetime
from urllib.parse import parse_qs, urlparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from openpyxl import Workbook
from openpyxl.utils import get_column_letter
from telethon import TelegramClient, errors, types
from telethon.tl.functions.messages import CheckChatInviteRequest

BASE = Path(__file__).parent
DB_FILE = BASE / "veri.db"
CFG_FILE = BASE / "ayarlar.json"
SESSION = str(BASE / "oturum")
PORT = 8765

loop = asyncio.new_event_loop()
threading.Thread(target=loop.run_forever, daemon=True).start()


def run(coro):
    return asyncio.run_coroutine_threadsafe(coro, loop).result()


class State:
    client = None
    phone = None
    phone_code_hash = None
    job = {"running": False, "log": [], "done": False}


S = State()


def load_cfg():
    try:
        return json.loads(CFG_FILE.read_text())
    except Exception:
        return {}


def log(msg):
    S.job["log"].append(f"{datetime.now():%H:%M:%S}  {msg}")


async def get_client():
    cfg = load_cfg()
    if not cfg.get("api_id"):
        raise RuntimeError("Once API ID ve API Hash gir.")
    if S.client is None:
        S.client = TelegramClient(SESSION, int(cfg["api_id"]), cfg["api_hash"], loop=loop)
    if not S.client.is_connected():
        await S.client.connect()
    return S.client


async def auth_state():
    cfg = load_cfg()
    if not cfg.get("api_id"):
        return {"step": "config"}
    c = await get_client()
    if await c.is_user_authorized():
        me = await c.get_me()
        return {"step": "ready", "me": f"{me.first_name or ''} (@{me.username or '-'})"}
    return {"step": "login"}


def parse_link(text):
    text = text.strip()
    m = re.search(r"t\.me/(?:\+|joinchat/)([\w-]+)", text)
    if m:
        return "invite", m.group(1)
    if re.search(r"t\.me/c/\d+", text):
        return "bad", None
    m = re.search(r"t\.me/([A-Za-z]\w{3,})", text) or re.fullmatch(r"@?([A-Za-z]\w{3,})", text)
    if m:
        return "public", m.group(1)
    return "bad", None


async def resolve(client, link):
    kind, val = parse_link(link)
    if kind == "bad":
        raise ValueError("Baglanti taninmadi (t.me/kanaladi veya t.me/+KOD olmali).")
    if kind == "public":
        return await client.get_entity(val)
    r = await client(CheckChatInviteRequest(val))
    if isinstance(r, types.ChatInviteAlready):
        return r.chat
    raise PermissionError("Bu hesap kanalda uye degil. Once hesapla kanala katil ve yonetici yap.")


def is_admin(ent):
    return bool(getattr(ent, "creator", False) or getattr(ent, "admin_rights", None))


db = sqlite3.connect(DB_FILE, check_same_thread=False)
db.row_factory = sqlite3.Row
dblock = threading.RLock()
with dblock:
    db.executescript("""
    CREATE TABLE IF NOT EXISTS channels(id INTEGER PRIMARY KEY AUTOINCREMENT, tg_id INTEGER UNIQUE,
        title TEXT, link TEXT, last_scan TEXT, error TEXT);
    CREATE TABLE IF NOT EXISTS members(channel_id INTEGER, user_id INTEGER, username TEXT, first TEXT,
        last TEXT, bot INTEGER, deleted INTEGER, joined TEXT, first_seen TEXT, last_seen TEXT,
        active INTEGER, PRIMARY KEY(channel_id,user_id));
    CREATE TABLE IF NOT EXISTS scans(id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id INTEGER, ts TEXT,
        total INTEGER, new_n INTEGER, left_n INTEGER);
    """)


def now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


async def add_channels(links):
    client = await get_client()
    ids = []
    for link in links:
        try:
            ent = await resolve(client, link)
            title = getattr(ent, "title", None) or link
            if not is_admin(ent):
                log(f"ATLANDI  {title}: bu hesap burada yonetici degil. Kanal sahibinden bu hesabi yonetici yaptir.")
                continue
            with dblock:
                db.execute("INSERT INTO channels(tg_id,title,link) VALUES(?,?,?) "
                           "ON CONFLICT(tg_id) DO UPDATE SET title=excluded.title, link=excluded.link",
                           (ent.id, title, link))
                ids.append(db.execute("SELECT id FROM channels WHERE tg_id=?", (ent.id,)).fetchone()[0])
                db.commit()
            log(f"EKLENDI  {title}")
        except Exception as e:
            log(f"HATA     {link}: {e}")
    return ids


async def scan_channel(client, ch):
    ent = await resolve(client, ch["link"])
    if not is_admin(ent):
        raise PermissionError("bu hesap artik yonetici degil")
    rows = {}
    async for u in client.iter_participants(ent, limit=None):
        joined = getattr(getattr(u, "participant", None), "date", None)
        rows[u.id] = (u.username or "", u.first_name or "", u.last_name or "", int(bool(u.bot)),
                      int(bool(u.deleted)), joined.strftime("%Y-%m-%d %H:%M") if joined else "")
    ts = now()
    with dblock:
        old = {r["user_id"]: r["active"] for r in db.execute(
            "SELECT user_id,active FROM members WHERE channel_id=?", (ch["id"],))}
        first = not old and not db.execute("SELECT 1 FROM scans WHERE channel_id=?", (ch["id"],)).fetchone()
        new_n = None if first else sum(1 for i in rows if not old.get(i))
        left_n = None if first else sum(1 for i, a in old.items() if a and i not in rows)
        db.execute("UPDATE members SET active=0 WHERE channel_id=?", (ch["id"],))
        for uid, (un, fn, ln, bot, dele, jn) in rows.items():
            db.execute("""INSERT INTO members VALUES(?,?,?,?,?,?,?,?,?,?,1)
                ON CONFLICT(channel_id,user_id) DO UPDATE SET username=excluded.username,first=excluded.first,
                last=excluded.last,bot=excluded.bot,deleted=excluded.deleted,joined=excluded.joined,
                last_seen=excluded.last_seen,active=1""", (ch["id"], uid, un, fn, ln, bot, dele, jn, ts, ts))
        db.execute("INSERT INTO scans(channel_id,ts,total,new_n,left_n) VALUES(?,?,?,?,?)",
                   (ch["id"], ts, len(rows), new_n, left_n))
        db.execute("UPDATE channels SET last_scan=?, error=NULL, title=? WHERE id=?",
                   (ts, getattr(ent, "title", ch["title"]), ch["id"]))
        db.commit()
    total = getattr(ent, "participants_count", None)
    note = f" (Telegram toplam {total} dedi, {len(rows)} kisilik liste verdi)" if total and len(rows) < total else ""
    log(f"TAMAM    {ch['title']}: {len(rows)} uye" + ("" if first else f", +{new_n} / -{left_n}") + note)


async def scan(channel_ids=None, keep_log=False):
    S.job.update(running=True, done=False)
    if not keep_log:
        S.job["log"] = []
    try:
        client = await get_client()
        with dblock:
            if channel_ids:
                q = ",".join("?" * len(channel_ids))
                chans = [dict(r) for r in db.execute(f"SELECT * FROM channels WHERE id IN ({q})", channel_ids)]
            else:
                chans = [dict(r) for r in db.execute("SELECT * FROM channels")]
        for ch in chans:
            try:
                await scan_channel(client, ch)
            except errors.FloodWaitError as e:
                log(f"HATA     {ch['title']}: Telegram {e.seconds} sn beklemeni istedi.")
            except Exception as e:
                with dblock:
                    db.execute("UPDATE channels SET error=? WHERE id=?", (str(e), ch["id"]))
                    db.commit()
                log(f"HATA     {ch['title']}: {e}")
        log("Bitti.")
    finally:
        S.job.update(running=False, done=True)


def dashboard():
    with dblock:
        chans = []
        for c in db.execute("SELECT * FROM channels ORDER BY title"):
            last = db.execute("SELECT * FROM scans WHERE channel_id=? ORDER BY id DESC LIMIT 1", (c["id"],)).fetchone()
            chans.append({"id": c["id"], "title": c["title"], "last_scan": c["last_scan"], "error": c["error"],
                          "total": last["total"] if last else None,
                          "new": last["new_n"] if last else None, "left": last["left_n"] if last else None})
        uniq = db.execute("SELECT COUNT(DISTINCT user_id) FROM members WHERE active=1").fetchone()[0]
        multi = db.execute("SELECT COUNT(*) FROM (SELECT user_id FROM members WHERE active=1 "
                           "GROUP BY user_id HAVING COUNT(*)>1)").fetchone()[0]
        bots = db.execute("SELECT COUNT(*) FROM members WHERE active=1 AND bot=1").fetchone()[0]
        dele = db.execute("SELECT COUNT(*) FROM members WHERE active=1 AND deleted=1").fetchone()[0]
        scans = db.execute("SELECT channel_id,substr(ts,1,10) d,total FROM scans ORDER BY ts, id").fetchall()
    latest, series = {}, []
    for r in scans:
        latest[r["channel_id"]] = r["total"]
        day = r["d"]
        if series and series[-1][0] == day:
            series[-1][1] = sum(latest.values())
        else:
            series.append([day, sum(latest.values())])
    return {"channels": chans, "unique": uniq, "multi": multi, "bots": bots, "deleted": dele,
            "sum": sum(c["total"] or 0 for c in chans), "series": series}


def members(channel, q, limit, offset):
    where, args = ["m.active=1"], []
    if channel:
        where.append("m.channel_id=?"); args.append(channel)
    if q:
        where.append("(CAST(m.user_id AS TEXT) LIKE ? OR m.username LIKE ? OR m.first LIKE ? OR m.last LIKE ?)")
        args += [f"%{q}%"] * 4
    w = " AND ".join(where)
    with dblock:
        total = db.execute(f"SELECT COUNT(*) FROM members m WHERE {w}", args).fetchone()[0]
        rows = db.execute(f"SELECT m.user_id,m.username,m.first,m.last,m.bot,m.deleted,m.joined,c.title "
                          f"FROM members m JOIN channels c ON c.id=m.channel_id WHERE {w} "
                          f"ORDER BY m.rowid DESC LIMIT ? OFFSET ?", args + [limit, offset]).fetchall()
    return {"total": total, "rows": [list(r) for r in rows]}


def build_xlsx(channels=None):
    wb = Workbook()
    wb.remove(wb.active)
    used = set()
    with dblock:
        if channels:
            chans = db.execute(f"SELECT * FROM channels WHERE id IN ({','.join('?' * len(channels))})",
                               channels).fetchall()
        else:
            chans = db.execute("SELECT * FROM channels").fetchall()
        for c in chans:
            name = re.sub(r"[\\/*?:\[\]]", "", c["title"])[:28].strip() or "kanal"
            base, n = name, 2
            while name.lower() in used:
                name = f"{base[:25]}_{n}"; n += 1
            used.add(name.lower())
            ws = wb.create_sheet(name)
            ws.append(["Telegram ID", "Kullanici adi", "Ad", "Soyad", "Bot", "Silinmis hesap", "Katilma tarihi"])
            for r in db.execute("SELECT user_id,username,first,last,bot,deleted,joined FROM members "
                                "WHERE channel_id=? AND active=1", (c["id"],)):
                ws.append([r[0], r[1], r[2], r[3], "Evet" if r[4] else "", "Evet" if r[5] else "", r[6]])
            for i, w in enumerate([16, 22, 20, 20, 6, 14, 18], 1):
                ws.column_dimensions[get_column_letter(i)].width = w
    if not used:
        wb.create_sheet("bos")
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


PAGE_FILE = BASE / "index.html"


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype="application/json", extra=None):
        data = body if isinstance(body, bytes) else body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def j(self, obj, code=200):
        self.send(code, json.dumps(obj, ensure_ascii=False))

    def do_GET(self):
        u = urlparse(self.path)
        qs = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path == "/":
            self.send(200, PAGE_FILE.read_text(encoding="utf-8"), "text/html; charset=utf-8")
        elif u.path == "/api/state":
            try:
                self.j(run(auth_state()))
            except Exception as e:
                self.j({"step": "config", "error": str(e)})
        elif u.path == "/api/dashboard":
            self.j(dashboard())
        elif u.path == "/api/members":
            self.j(members(int(qs["channel"]) if qs.get("channel") else None, qs.get("q", ""),
                           min(int(qs.get("limit", 50)), 500), int(qs.get("offset", 0))))
        elif u.path == "/api/status":
            self.j({"running": S.job["running"], "done": S.job["done"], "log": S.job["log"], "ids": S.job.get("ids", [])})
        elif u.path == "/download":
            data = build_xlsx([int(x) for x in qs["channel"].split(",") if x] if qs.get("channel") else None)
            name = f"telegram_uyeler_{datetime.now():%Y%m%d_%H%M}.xlsx"
            self.send(200, data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                      {"Content-Disposition": f'attachment; filename="{name}"'})
        else:
            self.send(404, "yok")

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        d = json.loads(self.rfile.read(n) or b"{}")
        try:
            if self.path == "/api/config":
                CFG_FILE.write_text(json.dumps({"api_id": int(d["api_id"]), "api_hash": d["api_hash"].strip()}))
                S.client = None
                self.j({"ok": True})
            elif self.path == "/api/send_code":
                async def f():
                    c = await get_client()
                    S.phone = d["phone"].strip()
                    S.phone_code_hash = (await c.send_code_request(S.phone)).phone_code_hash
                run(f()); self.j({"ok": True})
            elif self.path == "/api/sign_in":
                async def f():
                    c = await get_client()
                    try:
                        await c.sign_in(S.phone, d.get("code", "").strip(), phone_code_hash=S.phone_code_hash)
                    except errors.SessionPasswordNeededError:
                        if not d.get("password"):
                            raise RuntimeError("Iki adimli sifre gerekli, sifre alanini doldur.")
                        await c.sign_in(password=d["password"])
                run(f()); self.j({"ok": True})
            elif self.path in ("/api/add", "/api/scan"):
                if S.job["running"]:
                    return self.j({"error": "Bir islem zaten calisiyor."}, 409)
                if self.path == "/api/add":
                    links = [x for x in re.split(r"[\s,]+", d.get("links", "")) if x]
                    quick = bool(d.get("quick"))
                    async def f():
                        S.job.update(running=True, done=False, log=[], ids=[])
                        try:
                            ids = await add_channels(links)
                            S.job["ids"] = ids
                        except Exception as e:
                            ids = []
                            log(f"HATA     {e}")
                        S.job["running"] = False
                        if quick and ids:
                            await scan(ids, keep_log=True)
                        else:
                            S.job["done"] = True
                    asyncio.run_coroutine_threadsafe(f(), loop)
                else:
                    asyncio.run_coroutine_threadsafe(scan([d["channel_id"]] if d.get("channel_id") else None), loop)
                self.j({"ok": True})
            elif self.path == "/api/delete":
                with dblock:
                    for t in ("members", "scans"):
                        db.execute(f"DELETE FROM {t} WHERE channel_id=?", (d["channel_id"],))
                    db.execute("DELETE FROM channels WHERE id=?", (d["channel_id"],))
                    db.commit()
                self.j({"ok": True})
            elif self.path == "/api/logout":
                async def f():
                    c = await get_client(); await c.log_out(); S.client = None
                run(f()); self.j({"ok": True})
            else:
                self.send(404, "yok")
        except Exception as e:
            self.j({"error": f"{type(e).__name__}: {e}"}, 400)


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    url = f"http://127.0.0.1:{PORT}"
    print(f"Panel aciliyor: {url}  (kapatmak icin Ctrl+C)")
    try:
        webbrowser.open(url)
    except Exception:
        pass
    srv.serve_forever()
