---
type: strategy
key: research-18
status: proposed
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, sma, adx, macd, gold]
---

# Trend-Pullback v3 (same-bar + MACD filter only)

refinement pass on Trend-Pullback Continuation (run #5) — diagnosed real per-trade data: losers were fast whipsaw stop-outs (1-9h, full -1R), winners ran 8-59h after confirming with TP1. Testing 3 versions to see if filtering whipsaws helps or just shrinks the sample too far.

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.sma20 == null || s.sma50 == null || s.adx == null || s.macdHist == null || p.sma20 == null || p.price == null || s.price == null) return null;
if (s.adx < 20) return null;
var uptrend = s.sma20 > s.sma50;
var downtrend = s.sma20 < s.sma50;
if (uptrend && p.price <= p.sma20 && s.price > s.sma20 && s.macdHist > 0) {
  return { side: "long", note: "pullback reclaim + MACD agree, ADX " + s.adx.toFixed(0) };
}
if (downtrend && p.price >= p.sma20 && s.price < s.sma20 && s.macdHist < 0) {
  return { side: "short", note: "pullback rejection + MACD agree, ADX " + s.adx.toFixed(0) };
}
return null;
```

## Backtest history

- Research pipeline backtest (3mo, 1h): 3 trades, 33.3% win rate, profit factor n/a, total P/L $6.47, Sharpe n/a.

## Live status

Proposed candidate, not yet reviewed. From research run #6.
