// Backtest: replay the live engine over recent history. Runs INSIDE the bot on Railway (the sandbox
// cannot reach Binance). Results go into shadow_signals tagged 'bt:' so the live numbers stay separate.
//
// Honest limits (also shown in the report): order-book depth and the live tape do not exist in history,
// BTC's 15m move is not replayed (treated as calm), and funding is the current value. Open-interest
// history only goes back ~30 days, hence the 14-day cap. So this tests the pattern and the stop/target
// logic, not the full live filter stack; treat it as a ranking tool, not a promise.
import { CFG, ENV } from './config.js';
import { api, toK, TFM } from './binance.js';
import { analyze } from './analyze.js';
import { decide, decideLong, VERDICT_LIVE } from './decide.js';
import { planOf } from './plan.js';
import { stepTrack } from './tracker.js';
import { pool, log, warn, seans } from './util.js';
import * as db from './db.js';

let RUNNING = false;
export const backtestRunning = () => RUNNING;

/* Pure part, testable: which bar indexes of a kline series are candidate moments.
   A moment = 24h move beyond minChg, spaced by `step` bars, with enough future bars left to track. */
export function candidateMoments(k, { barsPerDay, minChg, step, future, warm = 100 }) {
  const out = [];
  for (let i = Math.max(warm, barsPerDay); i < k.length - future - 1; i += step) {
    const chg = (k[i].c / k[i - barsPerDay].c - 1) * 100;
    if (Math.abs(chg) >= minChg) out.push({ i, chg, dir: chg > 0 ? 'S' : 'L' });
  }
  return out;
}

export async function runBacktest({ days = 7, symbols = 40, maxAnalyses = 400, tickers = [], buildRow } = {}) {
  if (RUNNING) throw new Error('a backtest is already running');
  RUNNING = true;
  const t0 = Date.now();
  days = Math.min(14, Math.max(2, Math.round(days)));
  const tf = ENV.tf, mins = TFM[tf] || 15;
  const barsPerDay = Math.round(1440 / mins);
  const sum = { symbols: 0, analyses: 0, setups: 0, stored: 0, errors: 0, days };
  try {
    const universe = tickers.slice().sort((a, b) => b.v - a.v).slice(0, symbols).map((x) => x.s);
    await pool(universe, 2, async (sym) => {
      if (sum.analyses >= maxAnalyses) return;
      let k;
      try {
        k = toK(await api('/fapi/v1/klines', { symbol: sym, interval: tf, limit: Math.min(1500, days * barsPerDay + 120) }));
      } catch { sum.errors++; return; }
      sum.symbols++;
      const moments = candidateMoments(k, { barsPerDay, minChg: ENV.scanMinChg, step: 8, future: CFG.trackBars });
      const lastAt = { S: 0, L: 0 };
      for (const mo of moments) {
        if (sum.analyses >= maxAnalyses) break;
        const bar = k[mo.i];
        const sigT = bar.t + mins * 6e4;
        if (sigT - lastAt[mo.dir] < CFG.reSignalMin * 6e4) continue;
        sum.analyses++;
        try {
          const m = await analyze(sym, tf, { limit: 140, endTime: sigT - 1, ticker24: null });
          const d = mo.dir === 'S' ? decide(m, null, {}) : decideLong(m, null, {});
          if (!VERDICT_LIVE.includes(d.vd)) continue;
          const P = planOf(m, mo.dir, null);
          const row = buildRow(m, mo.dir, d, P);
          row.key = `bt${sym}${mo.dir}${sigT}`;
          row.created_at = new Date(sigT).toISOString();
          row.session = seans(sigT);
          row.skip_why = 'bt:' + d.grade;
          const res = stepTrack(row, k.slice(mo.i + 1), mins);
          delete res.stop_now;
          sum.setups++;
          lastAt[mo.dir] = sigT;
          if (!res.closed_at) continue;               // not finished within the data we have
          await db.insertShadow({ ...row, status: res.status });
          await db.patchShadow(row.key, res);
          sum.stored++;
        } catch (e) { sum.errors++; if (sum.errors < 4) warn(`backtest ${sym}: ${e.message}`); }
      }
    });
    sum.sec = Math.round((Date.now() - t0) / 1000);
    log(`backtest bitti · ${JSON.stringify(sum)}`);
    return sum;
  } finally {
    RUNNING = false;
  }
}
