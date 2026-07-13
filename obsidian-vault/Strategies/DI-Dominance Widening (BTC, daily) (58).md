---
type: strategy
key: research-58
status: rejected
symbol: "BTC-USD"
timeframe: "1d"
tags: [strategy, research, adx, di]
---

# DI-Dominance Widening (BTC, daily)

DI-Dominance Widening for BTC-USD on daily bars: fires whenever the +DI/-DI gap is widening while ADX >= 20, no fresh crossover required. Identical logic to the live gold strategy (research-30). Every BTC-USD strategy tried so far used 15m or 1h bars - this is the first test of the pattern on a swing timeframe for crypto, which (unlike equities) has no session-gap reason to avoid daily bars.

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

- Research pipeline backtest (5y, 1d): 232 trades, 54.7% win rate, profit factor 0.93, total P/L $-2403.67, Sharpe -0.50.

## Live status

Rejected after review - not live. From research run #31.
