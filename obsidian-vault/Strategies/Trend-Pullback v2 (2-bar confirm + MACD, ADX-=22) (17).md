---
type: strategy
key: research-17
status: proposed
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, sma, adx, macd, gold]
---

# Trend-Pullback v2 (2-bar confirm + MACD, ADX>=22)

refinement pass on Trend-Pullback Continuation (run #5) — diagnosed real per-trade data: losers were fast whipsaw stop-outs (1-9h, full -1R), winners ran 8-59h after confirming with TP1. Testing 3 versions to see if filtering whipsaws helps or just shrinks the sample too far.

## Logic

```js
var i = bars.length - 1;
if (i < 2) return null;
var s = snaps[i], p = snaps[i - 1], pp = snaps[i - 2];
if (s.sma20 == null || s.sma50 == null || s.adx == null || s.macdHist == null || p.sma20 == null || p.price == null || s.price == null || pp.price == null || pp.sma20 == null) return null;
if (s.adx < 22) return null;
var uptrend = s.sma20 > s.sma50;
var downtrend = s.sma20 < s.sma50;
if (uptrend && pp.price <= pp.sma20 && p.price > p.sma20 && s.price > p.price && s.macdHist > 0) {
  return { side: "long", note: "confirmed pullback reclaim (2-bar), ADX " + s.adx.toFixed(0) + ", MACD hist " + s.macdHist.toFixed(2) };
}
if (downtrend && pp.price >= pp.sma20 && p.price < p.sma20 && s.price < p.price && s.macdHist < 0) {
  return { side: "short", note: "confirmed pullback rejection (2-bar), ADX " + s.adx.toFixed(0) + ", MACD hist " + s.macdHist.toFixed(2) };
}
return null;
```

## Backtest history

- Research pipeline backtest (3mo, 1h): 7 trades, 28.6% win rate, profit factor n/a, total P/L $5.79, Sharpe n/a.

## Live status

Proposed candidate, not yet reviewed. From research run #6.
