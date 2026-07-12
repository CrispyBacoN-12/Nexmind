---
type: strategy
key: research-50
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, rsi, hammer, shooting-star, gold]
---

# Hammer/Shooting Star + RSI 50-cross

Hammer/Shooting Star candle pattern confirmed by an RSI momentum-regime shift (RSI crossing above/below 50), for gold (GC=F) - same 'pattern confirms a momentum shift' design that worked for the MACD zero-cross candidate, applied to RSI instead. CAVEAT (important, read before approving): on the GC=F 1h blind held-out year (bars older than the most recent 365 days, never used for tuning), this produced only 12 trades total - win rate 75%, profit factor 2.4-3.0 at tight TP1 multiples (1.2-1.5x ATR), but that sample is too small to be statistically trustworthy on its own. A related pattern (Engulfing + RSI 50-cross) FAILED on the same held-out data, and both RSI-extreme-reversal variants (pattern + RSI<30/>70) failed outright across every TP tested - so this is not a broad 'candle+RSI works' finding, it's one narrow, thin-sample result. Recommend live-paper-tracking this before real approval, not approving off this backtest alone.

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var c = bars[i], s = snaps[i], ps = snaps[i - 1];
if (s.rsi == null || ps.rsi == null) return null;

var body = Math.abs(c.c - c.o);
var range = c.h - c.l;
if (range <= 0 || body <= range * 0.01) return null;

var upperWick = c.h - Math.max(c.o, c.c);
var lowerWick = Math.min(c.o, c.c) - c.l;

var isHammer = lowerWick >= body * 2 && upperWick <= body * 0.5 && body <= range * 0.35;
var isShootingStar = upperWick >= body * 2 && lowerWick <= body * 0.5 && body <= range * 0.35;

if (isHammer && ps.rsi <= 50 && s.rsi > 50) return { side: "long", note: "hammer + RSI crossed above 50" };
if (isShootingStar && ps.rsi >= 50 && s.rsi < 50) return { side: "short", note: "shooting star + RSI crossed below 50" };
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 10 trades, 30.0% win rate, profit factor 0.15, total P/L $-32.88, Sharpe -12.89.

## Live status

Rejected after review - not live. From research run #23.
