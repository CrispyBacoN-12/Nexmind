---
type: strategy
key: research-21
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, rsi, adx, gold]
---

# RSI-Cross-Back Range Fade

iterative search for >50% win rate + consistent profit on gold (GC=F 1h). Swept 8 entry concepts (mean-reversion, RSI reversal, tight-band fade, DI-dominance continuation, ADX-ignition breakout, strong-trend-rider) across both a 3-month and 1-year window to check for consistency, not just single-window curve-fit. Best 3 by cross-window consistency below.

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.rsi == null || p.rsi == null) return null;
if (s.adx > 20) return null;
if (p.rsi < 30 && s.rsi >= 30) return { side: "long", note: "RSI crossed back above 30" };
if (p.rsi > 70 && s.rsi <= 70) return { side: "short", note: "RSI crossed back below 70" };
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 11 trades, 27.3% win rate, profit factor n/a, total P/L $19.85, Sharpe n/a.

## Live status

Rejected after review - not live. From research run #7.
