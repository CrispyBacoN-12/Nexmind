---
type: strategy
key: research-71
status: rejected
symbol: "BTC-USD"
timeframe: "1h"
tags: [strategy, research, liquidity-sweep]
---

# Liquidity Sweep (20-bar, BTC-USD)

Ports the original unfiltered Liquidity Sweep pattern (research-59, gold, PF 0.93 near-breakeven) to BTC-USD, unchanged. It's a structural range-reversion pattern with no trend gate - testing whether a more consolidation-prone market gives it a real edge where gold only broke even.

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

- Research pipeline backtest (1y, 1h): 602 trades, 55.8% win rate, profit factor 0.97, total P/L $-685.83, Sharpe -0.36.

## Live status

Rejected after review - not live. From research run #44.
