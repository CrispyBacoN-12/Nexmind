---
type: strategy
key: research-70
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, macd, gold]
---

# MACD Histogram Exhaustion Fade (gold)

MACD histogram exhaustion fade for gold (GC=F, 1h) - a different range-trading mechanism than RSI Extreme Fade or ATR-Band Mean Reversion. Detects the histogram peaking (still positive) or troughing (still negative) and starting to contract toward zero - momentum exhaustion within a mini-trend, before any zero-cross - and fades the move, betting on reversion rather than continuation.

## Logic

```js
var i = bars.length - 1;
if (i < 2) return null;
var s = snaps[i], p = snaps[i - 1], pp = snaps[i - 2];
if (s.macdHist == null || p.macdHist == null || pp.macdHist == null) return null;
if (pp.macdHist < p.macdHist && p.macdHist > s.macdHist && s.macdHist > 0) {
  return { side: "short", note: "MACD hist peaked positive and contracting - momentum exhaustion" };
}
if (pp.macdHist > p.macdHist && p.macdHist < s.macdHist && s.macdHist < 0) {
  return { side: "long", note: "MACD hist troughed negative and contracting - momentum exhaustion" };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 567 trades, 54.7% win rate, profit factor 0.93, total P/L $-60.87, Sharpe -0.79.

## Live status

Rejected after review - not live. From research run #43.
