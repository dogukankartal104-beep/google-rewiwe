// Kısa süreli canlı tape teyidi. Sinyal adayı onaydan geçince, yayınlamadan
// önce birkaç saniyelik aggTrade akışı toplanır: akış yönü gerçekten lehimize mi?
// Başarısız olursa null döner ve sistem REST verisiyle devam eder (fail-safe).
import { warn } from './util.js';

let WebSocketImpl = null;
try {
  const mod = await import('ws');
  WebSocketImpl = mod.default || mod.WebSocket;
} catch {
  WebSocketImpl = globalThis.WebSocket || null;
}

export const tapeAvailable = () => Boolean(WebSocketImpl);

export function collectTape(symbol, seconds = 45) {
  if (!WebSocketImpl) return Promise.resolve(null);

  return new Promise((resolve) => {
    const url = `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@aggTrade`;
    let ws;
    const acc = {
      trades: 0, sellN: 0, vol: 0, buyVol: 0, sellVol: 0, whale: 0,
      sizes: [], first: null, last: null,
    };
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws?.close(); } catch { /* yoksay */ }
      if (acc.trades < 5) return resolve(null);
      resolve({
        trades: acc.trades,
        sellN: acc.sellN,
        vol: acc.vol,
        buyVol: acc.buyVol,
        sellVol: acc.sellVol,
        whale: acc.whale,
        drift: acc.first && acc.last ? ((acc.last - acc.first) / acc.first) * 100 : null,
      });
    };

    const timer = setTimeout(finish, Math.max(5, seconds) * 1000);

    try {
      ws = new WebSocketImpl(url);
    } catch (e) {
      warn('tape ws acilmadi:', e.message);
      clearTimeout(timer);
      return resolve(null);
    }

    const onMsg = (raw) => {
      try {
        const d = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
        const p = +d.p, q = +d.q;
        if (!Number.isFinite(p) || !Number.isFinite(q)) return;
        const usd = p * q;
        // m=true  -> alıcı maker, yani taker SATTI
        const sell = d.m === true;
        acc.trades++;
        acc.vol += usd;
        if (sell) { acc.sellN++; acc.sellVol += usd; } else { acc.buyVol += usd; }
        if (usd >= 50000) acc.whale += usd;
        if (acc.first === null) acc.first = p;
        acc.last = p;
      } catch { /* bozuk mesaj, yoksay */ }
    };

    if (ws.on) {
      ws.on('message', onMsg);
      ws.on('error', (e) => { warn('tape ws hata:', e.message); finish(); });
      ws.on('close', finish);
    } else {
      ws.onmessage = (ev) => onMsg(ev.data);
      ws.onerror = () => finish();
      ws.onclose = () => finish();
    }
  });
}
