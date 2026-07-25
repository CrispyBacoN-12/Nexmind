---
type: strategy
key: research-19
status: approved
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, adx, di, gold]
---

# DI-Dominance Continuation (widening gap)

iterative search for >50% win rate + consistent profit on gold (GC=F 1h). Swept 8 entry concepts (mean-reversion, RSI reversal, tight-band fade, DI-dominance continuation, ADX-ignition breakout, strong-trend-rider) across both a 3-month and 1-year window to check for consistency, not just single-window curve-fit. Best 3 by cross-window consistency below.

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.adx == null) return null;
if (s.adx < 25) return null;
var gap = Math.abs(s.plusDI - s.minusDI);
var pGap = Math.abs(p.plusDI - p.minusDI);
if (s.plusDI > s.minusDI && gap > pGap) return { side: "long", note: "DI gap widening, +DI dominant" };
if (s.minusDI > s.plusDI && gap > pGap) return { side: "short", note: "DI gap widening, -DI dominant" };
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 234 trades, 27.4% win rate, profit factor n/a, total P/L $14.17, Sharpe n/a.

## Live status

Approved - available as `research-19` if assigned to a portfolio's strategy key. From research run #7.
