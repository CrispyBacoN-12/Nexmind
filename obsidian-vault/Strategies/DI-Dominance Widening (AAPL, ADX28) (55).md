---
type: strategy
key: research-55
status: rejected
symbol: "AAPL"
timeframe: "1h"
tags: [strategy, research, adx, di]
---

# DI-Dominance Widening (AAPL, ADX28)

Tuning pass on research-53 (DI-Dominance Widening, AAPL): baseline was break-even (PF 0.96, -$1.04 over 217 trades) using the gold-tuned ADX>=20 floor. Same logic, one change: raise the ADX floor to 28, testing whether AAPL needs a stronger trend-strength bar before the DI-gap-widening signal is reliable.

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.adx == null) return null;
if (s.adx < 28) return null;
var gap = Math.abs(s.plusDI - s.minusDI);
var pGap = Math.abs(p.plusDI - p.minusDI);
if (s.plusDI > s.minusDI && gap > pGap) return { side: "long", note: "DI gap widening, +DI dominant, ADX " + Math.round(s.adx) };
if (s.minusDI > s.plusDI && gap > pGap) return { side: "short", note: "DI gap widening, -DI dominant, ADX " + Math.round(s.adx) };
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 132 trades, 53.0% win rate, profit factor 0.86, total P/L $-2.68, Sharpe -1.23.

## Live status

Rejected after review - not live. From research run #28.
