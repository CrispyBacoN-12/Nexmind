---
type: strategy
key: research-60
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, atr, liquidity-sweep, gold]
---

# Liquidity Sweep (20-bar, gold, depth-filtered)

Tuning pass on research-59 (Liquidity Sweep, gold): baseline was near break-even (PF 0.93, -$39.10 over 394 trades) but fired on any wick beyond the 20-bar high/low, including trivial one-tick pokes. Same logic, one change: require the sweep depth beyond the level to be at least 0.3x ATR, so only meaningful stop-hunts qualify.

## Logic

```js
var i = bars.length - 1;
var lookback = 20;
if (i < lookback + 1) return null;
var c = bars[i];
var s = snaps[i];
if (s.atr == null) return null;

var hi = -Infinity, lo = Infinity;
for (var k = i - lookback; k < i; k++) {
  if (bars[k].h > hi) hi = bars[k].h;
  if (bars[k].l < lo) lo = bars[k].l;
}

var sweepDepthLow = lo - c.l;
var sweepDepthHigh = c.h - hi;

if (c.l < lo && c.c > lo && sweepDepthLow >= s.atr * 0.3) {
  return { side: "long", note: "liquidity sweep below " + lookback + "-bar low, depth " + sweepDepthLow.toFixed(2) + ", closed back above" };
}
if (c.h > hi && c.c < hi && sweepDepthHigh >= s.atr * 0.3) {
  return { side: "short", note: "liquidity sweep above " + lookback + "-bar high, depth " + sweepDepthHigh.toFixed(2) + ", closed back below" };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 190 trades, 51.6% win rate, profit factor 0.84, total P/L $-48.64, Sharpe -1.43.

## Live status

Rejected after review - not live. From research run #33.
