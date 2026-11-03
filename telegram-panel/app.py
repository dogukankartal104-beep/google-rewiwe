"""Telegram kanal uye aktarici (yalnizca yonetici oldugun kanallar icin).

Davet baglantilarini yapistir -> hesabinin yonetici/kurucu oldugu kanallarin
uyelerini cek -> tek Excel dosyasi indir (her kanal ayri sayfa).
Telefon numarasi alinmaz; Telegram bunu yoneticilere de vermez.
"""
import asyncio
import io
import json
import re
import threading
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from openpyxl import Workbook
from openpyxl.utils import get_column_letter
from telethon import TelegramClient, errors, types
from telethon.tl.functions.messages import CheckChatInviteRequest

BASE = Path(__file__).parent
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
    job = {"running": False, "log": [], "results": {}, "done": False}
    xlsx = None


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


async def scan(links):
    S.job.update(running=True, done=False, log=[], results={})
    try:
        client = await get_client()
        for link in links:
            link = link.strip()
            if not link:
                continue
            try:
                ent = await resolve(client, link)
                title = getattr(ent, "title", None) or getattr(ent, "username", None) or link
                if not is_admin(ent):
                    log(f"ATLANDI  {title}: bu hesap burada yonetici degil. "
                        "Kanal sahibi hesaptan bu hesabi yonetici yap (Uyeleri goruntule yetkisi yeter).")
                    continue
                rows = []
                async for u in client.iter_participants(ent, limit=None):
                    part = getattr(u, "participant", None)
                    joined = getattr(part, "date", None)
                    rows.append([
                        u.id, u.username or "", u.first_name or "", u.last_name or "",
                        "Evet" if u.bot else "", "Evet" if u.deleted else "",
                        joined.strftime("%Y-%m-%d %H:%M") if joined else "",
                    ])
                total = getattr(ent, "participants_count", None)
                note = ""
                if total and len(rows) < total:
                    note = f" (Telegram toplam {total} dedi, {len(rows)} kisilik liste verdi)"
                S.job["results"][title] = rows
                log(f"TAMAM    {title}: {len(rows)} uye{note}")
            except errors.FloodWaitError as e:
                log(f"HATA     {link}: Telegram {e.seconds} sn beklemeni istedi, sonra tekrar dene.")
            except Exception as e:
                log(f"HATA     {link}: {e}")
        build_xlsx()
        log("Bitti." if S.job["results"] else "Hicbir kanaldan veri alinamadi.")
    finally:
        S.job.update(running=False, done=True)


def build_xlsx():
    wb = Workbook()
    wb.remove(wb.active)
    used = set()
    for title, rows in S.job["results"].items():
        name = re.sub(r"[\\/*?:\[\]]", "", title)[:28].strip() or "kanal"
        base, n = name, 2
        while name.lower() in used:
            name = f"{base[:25]}_{n}"
            n += 1
        used.add(name.lower())
        ws = wb.create_sheet(name)
        ws.append(["Telegram ID", "Kullanici adi", "Ad", "Soyad", "Bot", "Silinmis hesap", "Katilma tarihi"])
        for r in rows:
            ws.append(r)
        for i, w in enumerate([16, 22, 20, 20, 6, 14, 18], 1):
            ws.column_dimensions[get_column_letter(i)].width = w
    if not used:
        wb.create_sheet("bos")
    buf = io.BytesIO()
    wb.save(buf)
    S.xlsx = buf.getvalue()


PAGE = (BASE / "index.html").read_text(encoding="utf-8") if (BASE / "index.html").exists() else "index.html eksik"


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
        if self.path == "/":
            self.send(200, PAGE, "text/html; charset=utf-8")
        elif self.path == "/api/state":
            try:
                self.j(run(auth_state()))
            except Exception as e:
                self.j({"step": "config", "error": str(e)})
        elif self.path == "/api/status":
            self.j({"running": S.job["running"], "done": S.job["done"], "log": S.job["log"],
                    "counts": {k: len(v) for k, v in S.job["results"].items()}})
        elif self.path == "/download":
            if not S.xlsx:
                return self.send(404, "Henuz dosya yok")
            name = f"telegram_uyeler_{datetime.now():%Y%m%d_%H%M}.xlsx"
            self.send(200, S.xlsx,
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
                    r = await c.send_code_request(S.phone)
                    S.phone_code_hash = r.phone_code_hash
                run(f())
                self.j({"ok": True})
            elif self.path == "/api/sign_in":
                async def f():
                    c = await get_client()
                    try:
                        await c.sign_in(S.phone, d.get("code", "").strip(), phone_code_hash=S.phone_code_hash)
                    except errors.SessionPasswordNeededError:
                        if not d.get("password"):
                            return "password"
                        await c.sign_in(password=d["password"])
                run(f())
                self.j({"ok": True})
            elif self.path == "/api/scan":
                if S.job["running"]:
                    return self.j({"error": "Zaten calisiyor."}, 409)
                links = [x for x in re.split(r"[\s,]+", d.get("links", "")) if x]
                asyncio.run_coroutine_threadsafe(scan(links), loop)
                self.j({"ok": True, "count": len(links)})
            elif self.path == "/api/logout":
                async def f():
                    c = await get_client()
                    await c.log_out()
                    S.client = None
                run(f())
                self.j({"ok": True})
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
