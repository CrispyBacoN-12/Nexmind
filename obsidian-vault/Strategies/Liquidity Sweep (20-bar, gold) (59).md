---
type: strategy
key: research-59
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, liquidity-sweep, gold]
---

# Liquidity Sweep (20-bar, gold)

Liquidity Sweep pattern for gold (GC=F), tested for the first time ever in this project: price wicks beyond the prior 20-bar high/low (sweeping resting liquidity) but closes back inside that range on the same bar - a stop-hunt-then-reversal signature, the opposite read of a genuine breakout. Long on a sweep below the prior low that closes back above it; short on a sweep above the prior high that closes back below it.

## Logic

```js
var i = bars.length - 1;
var lookback = 20;
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

- Research pipeline backtest (1y, 1h): 394 trades, 52.3% win rate, profit factor 0.93, total P/L $-39.10, Sharpe -0.64.

## Live status

Rejected after review - not live. From research run #32.
