---
type: strategy
key: research-11
status: proposed
symbol: "BTC-USD"
timeframe: "1h"
tags: [strategy, research, adx, di]
---

# DI-Cross Trend Continuation

regime-aware entries: mean-reversion in ADX chop, trend continuation on DI cross, breakout after a volatility squeeze

## Logic

```js
var i = bars.length - 1;
if (i < 2) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.adx == null) return null;
if (s.adx < 22) return null;
var crossedUp = p.plusDI <= p.minusDI && s.plusDI > s.minusDI;
var crossedDown = p.minusDI <= p.plusDI && s.minusDI > s.plusDI;
if (crossedUp) return { side: "long", note: "DI+ cross, ADX " + s.adx.toFixed(0) };
if (crossedDown) return { side: "short", note: "DI- cross, ADX " + s.adx.toFixed(0) };
return null;
```

## Backtest history

- Research pipeline backtest (3mo, 1h): 48 trades, 31.3% win rate, profit factor n/a, total P/L $635.64, Sharpe n/a.

## Live status

Proposed candidate, not yet reviewed. From research run #4.
