---
type: strategy
key: research-14
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, di, macd, gold]
---

# MACD-DI Momentum Ignition

gold-specific entries: trend-continuation pullbacks (gold often stair-steps in a macro trend with sharp pullbacks), momentum-ignition on MACD/DI alignment, and range-fade mean-reversion for the many choppy non-trend days

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.macdHist == null || p.macdHist == null || s.plusDI == null || s.minusDI == null) return null;
var crossedUp = p.macdHist <= 0 && s.macdHist > 0;
var crossedDown = p.macdHist >= 0 && s.macdHist < 0;
if (crossedUp && s.plusDI > s.minusDI) {
  return { side: "long", note: "MACD hist turned positive, +DI leading (" + s.plusDI.toFixed(0) + " vs " + s.minusDI.toFixed(0) + ")" };
}
if (crossedDown && s.minusDI > s.plusDI) {
  return { side: "short", note: "MACD hist turned negative, -DI leading (" + s.minusDI.toFixed(0) + " vs " + s.plusDI.toFixed(0) + ")" };
}
return null;
```

## Backtest history

- Research pipeline backtest (3mo, 1h): 35 trades, 22.9% win rate, profit factor n/a, total P/L $20.52, Sharpe n/a.

## Live status

Rejected after review - not live. From research run #5.
