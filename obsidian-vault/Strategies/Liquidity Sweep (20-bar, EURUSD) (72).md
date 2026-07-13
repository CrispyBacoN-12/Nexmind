---
type: strategy
key: research-72
status: rejected
symbol: "EURUSD=X"
timeframe: "1h"
tags: [strategy, research, liquidity-sweep]
---

# Liquidity Sweep (20-bar, EURUSD)

Ports the original unfiltered Liquidity Sweep pattern (research-59, gold, PF 0.93 near-breakeven) to EURUSD=X, unchanged. Forex majors are known for extended range-bound stretches - testing whether this trend-agnostic structural pattern finds a real edge there.

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

- Research pipeline backtest (1y, 1h): 388 trades, 53.9% win rate, profit factor 0.77, total P/L $-0.01, Sharpe -2.74.

## Live status

Rejected after review - not live. From research run #45.
