---
type: strategy
key: research-13
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, sma, adx, gold]
---

# Trend-Pullback Continuation

gold-specific entries: trend-continuation pullbacks (gold often stair-steps in a macro trend with sharp pullbacks), momentum-ignition on MACD/DI alignment, and range-fade mean-reversion for the many choppy non-trend days

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.sma20 == null || s.sma50 == null || s.adx == null || p.sma20 == null || p.price == null || s.price == null) return null;
if (s.adx < 20) return null;
var uptrend = s.sma20 > s.sma50;
var downtrend = s.sma20 < s.sma50;
if (uptrend && p.price <= p.sma20 && s.price > s.sma20) {
  return { side: "long", note: "pullback reclaim in uptrend, ADX " + s.adx.toFixed(0) };
}
if (downtrend && p.price >= p.sma20 && s.price < s.sma20) {
  return { side: "short", note: "pullback rejection in downtrend, ADX " + s.adx.toFixed(0) };
}
return null;
```

## Backtest history

- Research pipeline backtest (3mo, 1h): 24 trades, 20.8% win rate, profit factor n/a, total P/L $-1.22, Sharpe n/a.

## Live status

Rejected after review - not live. From research run #5.
