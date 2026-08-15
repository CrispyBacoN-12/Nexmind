---
type: strategy
key: research-30
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, adx, di, gold]
---

# DI-Dominance Widening (ADX>20, gap widening)

Complementary entry signal for gold (GC=F) that fires DURING an established trend (not just on a reversal cross), so it keeps trading when the market moves cleanly in one direction. Tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, win rate >50% with profit stable across both halves of a sample.

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.adx == null) return null;
if (s.adx < 20) return null;
var gap = Math.abs(s.plusDI - s.minusDI);
var pGap = Math.abs(p.plusDI - p.minusDI);
if (s.plusDI > s.minusDI && gap > pGap) return { side: "long", note: "DI gap widening, +DI dominant" };
if (s.minusDI > s.plusDI && gap > pGap) return { side: "short", note: "DI gap widening, -DI dominant" };
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 695 trades, 57.3% win rate, profit factor n/a, total P/L $1.73, Sharpe n/a.

## Live status

Rejected after review - not live. From research run #13.
