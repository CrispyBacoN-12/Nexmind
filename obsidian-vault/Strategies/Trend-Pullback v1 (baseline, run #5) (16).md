---
type: strategy
key: research-16
status: proposed
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, sma, adx, gold]
---

# Trend-Pullback v1 (baseline, run #5)

refinement pass on Trend-Pullback Continuation (run #5) — diagnosed real per-trade data: losers were fast whipsaw stop-outs (1-9h, full -1R), winners ran 8-59h after confirming with TP1. Testing 3 versions to see if filtering whipsaws helps or just shrinks the sample too far.

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

Proposed candidate, not yet reviewed. From research run #6.
