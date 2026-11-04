# Protocol 4: market-wide context, a realistic account, signal quality, sizing, other signals

Written before the unseen period (2021-12 to 2024-12) was run or read. The unseen period is used ONCE, for
the single hypothesis H1 below. Everything else is descriptive: it can suggest a candidate for a later
protocol, it cannot approve anything.

## H1 (the only hypothesis with an exam)
Origin: protocols 1-3 on 2025-2026 data showed LONG signals taken while BTC was down more than 3% over 24h
had a high mean (about +1.5% per trade, 3476 trades). That was seen in the data, so it is a hypothesis, not
a result.

Rule (frozen): protocol 1's trade (same entry, stop, 1R target, 32 candles, costs, funding) but ONLY for
LONG signals whose BTC 24h change at the signal candle is below -3%. One position per coin, at most 2 open
at once, first come first served (the realistic account).

Exam: the unseen period 2021-12-01 to 2024-12-31, run once. PASS needs ALL of:
1. mean net % per trade > 0;
2. 90% lower bound of the mean (bootstrap by week) > 0;
3. both halves of the unseen period positive;
4. mean without the best 5 trades > 0;
5. beats the control (the same rule with LONG signals taken while BTC 24h >= -3%, same period, same
   account rules) by a positive margin;
6. at least 100 trades in the exam (otherwise the answer is "not enough data", not a pass).
The 2025-2026 numbers for the same rule are printed as secondary information and do not decide anything.

## Descriptive measurements (both datasets)
A. Market-wide: number of coins signalling in the same hour, BTC 24h and 4h change, hours since BTC's 72h
   low, tables of mean net by bucket and side.
B. Realistic account: the exit grid of protocol 3 re-evaluated with the cap of 2 open positions. Occupancy
   uses the full hold time (conservative: positions that exit early would free capacity sooner).
C. Signal quality: first signal on the coin (no signal in the previous 30 days) vs repeats, coin size
   tertiles by 24h volume, leg size, stop size.
D. Risk and sizing: account curve of the H1 rule for 5 / 10 / 15% of equity per trade at 1x / 2x / 3x, worst
   drawdown, longest losing streak, worst week, and the effect of stopping for the day at -2R.
E. Other signals: funding level buckets, open-interest change buckets, top-trader vs all-account long/short
   gap.

## Addenda
(none yet)
