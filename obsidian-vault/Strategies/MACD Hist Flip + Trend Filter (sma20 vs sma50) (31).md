---
type: strategy
key: research-31
status: approved
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, sma, macd, gold]
---

# MACD Hist Flip + Trend Filter (sma20 vs sma50)

Replacement for DI-Cross (research-25) on Gold Desk #8, which failed a genuine blind out-of-sample test (53.7% win, net negative on a held-out year). MACD histogram flip confirmed by SMA20/SMA50 trend agreement. Validated on GC=F 1h: stable both TUNE halves ($1081/$2523 annualized) and PASSED a true blind holdout test on the prior, never-seen year (59.0% win, +$1001/yr annualized). Only 66% signal-time overlap with research-30 (live on #13) - a genuinely distinct signal, not a duplicate.

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.macdHist == null || p.macdHist == null || s.sma20 == null || s.sma50 == null) return null;
if (p.macdHist <= 0 && s.macdHist > 0 && s.sma20 > s.sma50) return { side: "long", note: "MACD hist flips positive, uptrend" };
if (p.macdHist >= 0 && s.macdHist < 0 && s.sma20 < s.sma50) return { side: "short", note: "MACD hist flips negative, downtrend" };
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 165 trades, 61.2% win rate, profit factor n/a, total P/L $55.52, Sharpe n/a.

## Live status

Approved - available as `research-31` if assigned to a portfolio's strategy key. From research run #14.
