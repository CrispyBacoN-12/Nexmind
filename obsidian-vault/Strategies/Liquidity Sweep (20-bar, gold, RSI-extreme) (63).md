---
type: strategy
key: research-63
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, rsi, liquidity-sweep, gold]
---

# Liquidity Sweep (20-bar, gold, RSI-extreme)

Fifth version of Liquidity Sweep (gold), branching from v1 (research-59, PF 0.93). Requires RSI to have touched an extreme (<35 within the prior 8 bars for a long sweep, >65 for a short sweep) before the sweep fires - filtering for sweeps that follow genuine momentum exhaustion rather than firing on any wick-and-reclaim regardless of prior momentum.

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

var recentOversold = false, recentOverbought = false;
for (var j = 1; j <= 8; j++) {
  var s2 = snaps[i - j];
  if (!s2 || s2.rsi == null) break;
  if (s2.rsi < 35) recentOversold = true;
  if (s2.rsi > 65) recentOverbought = true;
}

if (c.l < lo && c.c > lo && recentOversold) {
  return { side: "long", note: "liquidity sweep below " + lookback + "-bar low after RSI oversold, closed back above" };
}
if (c.h > hi && c.c < hi && recentOverbought) {
  return { side: "short", note: "liquidity sweep above " + lookback + "-bar high after RSI overbought, closed back below" };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 213 trades, 53.5% win rate, profit factor 1.06, total P/L $19.11, Sharpe 0.49.

## Live status

Rejected after review - not live. From research run #36.
