---
type: strategy
key: research-49
status: approved
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, sma, macd, zero-cross, gold]
---

# MACD Histogram Zero-Cross + SMA50

MACD histogram zero-cross entry for gold (GC=F): enter long when the MACD histogram crosses from negative to positive while price is above SMA50, short on the mirror crossing below SMA50 - trades momentum shifts confirmed by trend direction. Tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade. Blind-tested on GC=F 1h bars older than the most recent 365 days (held out from any tuning) across tp1Mult 1.5/2.0/2.5 under the corrected MT5 Raw/ECN cost model: profitable at every tp1Mult tested, best at tp1Mult=2.5 (161 trades, 45.3% win rate, pf 1.42, +$2,825/yr annualized) - the strongest candidate found this research cycle.

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.macdHist == null || p.macdHist == null || s.sma50 == null) return null;
var c = bars[i].c;
if (p.macdHist <= 0 && s.macdHist > 0 && c > s.sma50) return { side: "long", note: "MACD hist crossed up through zero, above SMA50" };
if (p.macdHist >= 0 && s.macdHist < 0 && c < s.sma50) return { side: "short", note: "MACD hist crossed down through zero, below SMA50" };
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 193 trades, 60.6% win rate, profit factor 1.23, total P/L $52.99, Sharpe 1.74.

## Live status

Approved - available as `research-49` if assigned to a portfolio's strategy key. From research run #22.
