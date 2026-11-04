# Protocol 1: the original FADE HUD rule, tested on the Binance archive

Written BEFORE any result was looked at. Changes after seeing results go in the "Addenda" section at the
bottom, dated, never edited into the rule above.

## Hypothesis
Fading a large 24h move (short after a pump, long after a dump) with the original HUD setup finder
(`btEval`, copied unchanged) has a positive expectancy per trade after realistic costs.

## Rule (frozen)
- Universe: every Binance USDT-M perpetual that has archive data, delisted contracts included.
- Scan at every closed 15m candle. Move = close[i] / close[i-96] - 1 (96 closed 15m candles).
  Move >= +8% evaluates SHORT only, move <= -8% evaluates LONG only.
- Setup: `btEval` from `fade-hud.html`, unchanged apart from two documented edits (see "Code notes"),
  fed the last 500 closed candles. CFG as in the HUD except `stopMode = 0` (limit style).
- Skip the signal when the stop distance is below 4% of the entry price.
- Entry: LIMIT at the setup's entry level, placed after candle i closed; filled the first time a later
  candle trades through it (high >= level for SHORT, low <= level for LONG); cancelled if not filled
  within 8 candles. Unfilled limits are counted and reported.
- Stop: the setup's stop. Target: 1R (distance entry to stop). Time exit: close of the 32nd candle
  starting at the fill candle (8 hours).
- If stop and target are both inside the same candle, the STOP counts.
- One position or pending order per coin; at most 2 open or pending at once (chronological, first come).
- Costs: 20 bp round trip, plus 20 bp extra slippage on stop exits. Funding paid or earned during the
  hold is added. Everything is reported gross, net of costs, and net of costs plus funding.

## Periods
- DISCOVERY: 2025-01-01 to 2025-09-30. DECISION: 2025-10-01 to the last full archive day.
- UNSEEN (third exam, optional): 2021-12 to 2024-12. Only run once, after the rule is frozen.

## Reported
n, mean %, median %, win rate, 90% lower bound of the mean (bootstrap, resampling whole weeks),
both halves of each period separately, mean without the best 5 trades, maximum drawdown,
coverage (measured symbols / universe, download errors, signals dropped for missing data).
Placebo: the same trade (same coin, side, stop distance, limit mechanics) at random shifted times.
Equity test: one account, 10% of equity per trade at 2x isolated, at most 2 open, compounded in order.
Multiple cells tested: Benjamini-Hochberg at q = 0.10.

## PASS conditions (decision period, all required)
1. Mean net % per trade > 0.
2. 90% bootstrap lower bound of the mean > 0.
3. Both halves of the decision period have a positive mean.
4. Mean without the best 5 trades > 0.
5. Real mean beats the placebo mean.
6. Equity test: return positive in both halves and the maximum drawdown does not get worse in the second.
Only if all six hold may paid signals be published from this rule.

## Code notes (edits to the HUD code)
1. `const en = last.c;` is later reassigned (`en = en2`). In JavaScript this throws a TypeError for every
   signal that reaches that line, and the HUD's backtest swallows errors with an empty `catch`, so the
   HUD backtest could never produce a trade. Changed to `let en`. This is a bug fix, not a rule change.
2. `oiArr` (an array of open interest points) is replaced by `oiAt(ts)`, a function that returns the
   latest 5 minute open interest point at or before `ts`, loaded lazily from the archive. Same lookup,
   different data plumbing.

## Addenda
- A1 (2026-11-04, before the first run): on the candle where a limit order fills, a target only counts if
  that candle CLOSED beyond the target (price provably passed it after the fill). The stop is always checked.
  Reason: inside one candle the order of events is unknown, and the HUD counted such targets as wins.
- A2 (2026-11-04, before the first run): placebo comes in two kinds. A = random time on the same coin.
  B = random time on the same coin that also had a >= 8% move in the same direction (isolates the setup
  finder from the plain idea "fade any big move"). Condition 5 uses B.
