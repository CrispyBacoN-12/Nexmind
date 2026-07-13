---
type: strategy
key: research-62
status: approved
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, sma, liquidity-sweep, gold]
---

# Liquidity Sweep (20-bar, gold, SMA50-aligned)

Fourth version of Liquidity Sweep (gold), branching from v1 (research-59, PF 0.93). This time: gate by SMA50 trend alignment - only take the bullish sweep-and-reclaim when price is above SMA50, only the bearish one when below. Same trend filter that made Engulfing the best-performing pattern in this project (research-48, 61% blind-test win rate).

## Logic

```js
var i = bars.length - 1;
var lookback = 20;
if (i < lookback + 1) return null;
var c = bars[i];
var s = snaps[i];
if (s.sma50 == null) return null;

var hi = -Infinity, lo = Infinity;
for (var k = i - lookback; k < i; k++) {
  if (bars[k].h > hi) hi = bars[k].h;
  if (bars[k].l < lo) lo = bars[k].l;
}

if (c.l < lo && c.c > lo && c.c > s.sma50) {
  return { side: "long", note: "liquidity sweep below " + lookback + "-bar low, above SMA50, closed back above" };
}
if (c.h > hi && c.c < hi && c.c < s.sma50) {
  return { side: "short", note: "liquidity sweep above " + lookback + "-bar high, below SMA50, closed back below" };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 54 trades, 57.4% win rate, profit factor 1.13, total P/L $9.24, Sharpe 0.94.

## Live status

Approved - available as `research-62` if assigned to a portfolio's strategy key. From research run #35.
