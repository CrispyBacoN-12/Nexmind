---
type: strategy
key: research-64
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, liquidity-sweep, gold]
---

# Liquidity Sweep (10-bar, gold)

Sixth version of Liquidity Sweep (gold), branching from v1 (research-59, PF 0.93, 20-bar lookback). Same unfiltered logic, shortened lookback to 10 bars - testing whether a more locally-relevant level (vs. one that may be stale after 20 bars) changes the result.

## Logic

```js
var i = bars.length - 1;
var lookback = 10;
if (i < lookback + 1) return null;
var c = bars[i];

var hi = -Infinity, lo = Infinity;
for (var k = i - lookback; k < i; k++) {
  if (bars[k].h > hi) hi = bars[k].h;
  if (bars[k].l < lo) lo = bars[k].l;
}

if (c.l < lo && c.c > lo) {
  return { side: "long", note: "liquidity sweep below " + lookback + "-bar low, closed back above" };
}
if (c.h > hi && c.c < hi) {
  return { side: "short", note: "liquidity sweep above " + lookback + "-bar high, closed back below" };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 514 trades, 53.3% win rate, profit factor 0.96, total P/L $-29.15, Sharpe -0.38.

## Live status

Rejected after review - not live. From research run #37.
