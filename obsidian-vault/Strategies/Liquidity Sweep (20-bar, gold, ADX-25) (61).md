---
type: strategy
key: research-61
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, adx, liquidity-sweep, gold]
---

# Liquidity Sweep (20-bar, gold, ADX<25)

Third version of Liquidity Sweep (gold), branching from v1 (research-59, PF 0.93, -$39.10/394 trades) rather than v2 (depth filter, which made things worse). This time: require ADX < 25, restricting the pattern to ranging/low-trend conditions - a sweep-and-reclaim is a reversal signature, and firing during strong trends may just be catching pauses before continuation rather than genuine reversals.

## Logic

```js
var i = bars.length - 1;
var lookback = 20;
if (i < lookback + 1) return null;
var c = bars[i];
var s = snaps[i];
if (s.adx == null) return null;
if (s.adx >= 25) return null;

var hi = -Infinity, lo = Infinity;
for (var k = i - lookback; k < i; k++) {
  if (bars[k].h > hi) hi = bars[k].h;
  if (bars[k].l < lo) lo = bars[k].l;
}

if (c.l < lo && c.c > lo) {
  return { side: "long", note: "liquidity sweep below " + lookback + "-bar low, ADX " + Math.round(s.adx) + ", closed back above" };
}
if (c.h > hi && c.c < hi) {
  return { side: "short", note: "liquidity sweep above " + lookback + "-bar high, ADX " + Math.round(s.adx) + ", closed back below" };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 192 trades, 51.0% win rate, profit factor 0.83, total P/L $-46.68, Sharpe -1.59.

## Live status

Rejected after review - not live. From research run #34.
