# Protocol 2: pick the best 2 signals a day, using only what is known at entry

Written before any feature result was looked at. Fixed here: the feature list, the method, the numbers K,
perDay and percentile. Changing any of them after seeing the decision period is not allowed; changes go
into "Addenda".

## Idea
Protocol 1 produces many signals. If the signals that reach the target differ from the ones that hit the stop
by something visible at entry, we can take only the best 2 per day. "Best" must be decided at entry time:
choosing the 2 that later turned out to win is hindsight and cannot be traded.

## Method
1. Sample: every filled trade of protocol 1 (same entry, stop, 1R target, 8h, costs, funding), one per coin
   at a time. Learning uses the DISCOVERY period only (2025-01 to 2025-09).
2. Features (frozen list, all known when the candle closes): chg24, qv24 (log 24h quote volume), atrPct, hr,
   dow, fundNow, ret4, volX, limDist, ratio, trN, sweep, rrPlan, btc24, btc1h, riskPct, leg, oiChg, exN,
   absChg (|chg24|).
3. Learning: Spearman rank correlation of each feature with the net result on discovery. Keep features whose
   sign agrees in at least two thirds of the discovery months (months with >= 15 trades, at least 4 months).
   The K = 3 with the largest |correlation| form the score: sum of sign(rho) * z-score (mean and sd from
   discovery). Benjamini-Hochberg (q = 0.10) is reported over all features as a warning about chance.
4. Threshold: the 80th percentile of the discovery scores.
5. Selection (causal, walks through time): take a signal if score >= threshold, its coin is free, fewer than
   2 trades were taken that UTC day and fewer than 2 are open.
6. Exam: the DECISION period (2025-10 onward) with the numbers learned on discovery. Nothing is re-fitted.

## PASS conditions (decision period, all required)
1. Mean net % per trade > 0.
2. 90% lower bound (bootstrap by week) > 0.
3. Both halves positive.
4. Mean without the best 5 trades > 0.
5. Mean beats the 95th percentile of random selection (same number of picks per day, chosen at random
   among that day's signals).
6. Equity test (10% of equity at 2x, max 2 open): both halves positive and drawdown not worse in the second.

## Honest limits
- Looking for a pattern among 20 features always finds something in the discovery data. Only the decision
  period tells whether it is real. A pattern that disappears there is noise.
- A score that selects few trades per day cannot create expectancy the signals do not have; it can only
  concentrate it. If protocol 1 trades are no better than random times (placebo), this protocol can still pass
  only if the features carry information on their own.

## Addenda
(none yet)
