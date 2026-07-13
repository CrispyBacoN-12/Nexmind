---
type: strategy
key: research-53
status: rejected
symbol: "AAPL"
timeframe: "1h"
tags: [strategy, research, adx, di]
---

# DI-Dominance Widening (AAPL)

DI-Dominance Widening for AAPL: fires whenever the +DI/-DI gap is widening while ADX >= 20, no fresh crossover required. Identical logic to the live gold strategy (research-30, blind-tested 59.2% win rate, +$4,419/yr annualized) - ported here unchanged to test whether the edge transfers to an equity. AAPL has only 2 strategies total so far, both on tiny daily/weekly samples (8-9 trades); this uses 1h bars for a far larger sample.

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

- Research pipeline backtest (1y, 1h): 217 trades, 55.3% win rate, profit factor 0.96, total P/L $-1.04, Sharpe -0.31.

## Live status

Rejected after review - not live. From research run #26.
