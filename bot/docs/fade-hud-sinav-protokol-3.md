# Protocol 3: measure everything else (exits, costs, stability, more entry features)

Written before the results of protocols 1 and 2 were read and before any of the measurements below ran.
Rules that stay fixed: discovery = 2025-01 to 2025-09, decision = 2025-10 onward. Anything is chosen on
discovery and judged on decision. Nothing is re-fitted on decision. Changes go into "Addenda".

## A. Exits and stops (same fills as protocol 1, only the exit changes)
Grid on every filled trade: stop = {0.75, 1, 1.25, 1.5} x the original risk, target = {0.5, 0.75, 1, 1.5, 2} R
of the ORIGINAL risk, hold = {16, 32, 48} candles. Costs as protocol 1 (20 bp + 20 bp on stops); funding is
left out of the grid (it was small in protocol 1). The best cell by DISCOVERY mean is the only one carried to
the decision period; the whole grid is printed for both periods so a lucky cell is visible. Benjamini-Hochberg
(q = 0.10) over all 60 cells on the decision period. A cell is only worth adopting if the chosen cell has a
positive decision mean AND beats the protocol 1 cell (1.0 / 1R / 32) on decision.
Also printed: MAE and MFE (how far price went against / in favour inside 32 candles), the share of trades
whose MFE reached 0.5 / 1 / 1.5 / 2 R, and the tie bounds (stop wins vs target wins when both are inside one
candle).

## B. Costs
Net mean of the decision period at round-trip cost {10, 20, 30, 40, 60} bp and stop slippage {0, 20, 40} bp.
Break-even cost = the round-trip cost at which the decision mean is zero.

## C. Stability
Per month and per quarter (mean, n); share of total profit from the 10 most profitable coins and the mean
without them; by hour (UTC), weekday, session, side, grade, setup type, BTC 24h regime bucket; days with 3 or
more signals and how many of them point the same way (one market move counted several times).

## D. More entry features (frozen list, appended to protocol 2's)
topLS (top traders' position long/short ratio), globalLS (all accounts' long/short ratio), takerLS (taker
buy/sell volume ratio), oi1h / oi4h / oi24h (open interest change in %, from the 5 minute metrics),
oiOverVol (open interest value / 24h quote volume), prem (futures premium over index, %, at the signal candle),
sigCount30d (signals on the same coin in the previous 30 days), hrsSinceSig (hours since the previous signal
on the coin). Method, K = 3, daily cap = 2, threshold = 80th percentile, the six pass conditions: exactly as
protocol 2.

## E. Not measured here
Liquidation fuel: the brief names it but does not define leverage mix or liquidation price rules precisely
enough to implement without making them up. It gets its own protocol once the rule is written down.

## Addenda
(none yet)
