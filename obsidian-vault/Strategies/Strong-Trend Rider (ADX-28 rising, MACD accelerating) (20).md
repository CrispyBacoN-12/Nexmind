---
type: strategy
key: research-20
status: proposed
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, sma, adx, di, macd, gold]
---

# Strong-Trend Rider (ADX>28 rising, MACD accelerating)

iterative search for >50% win rate + consistent profit on gold (GC=F 1h). Swept 8 entry concepts (mean-reversion, RSI reversal, tight-band fade, DI-dominance continuation, ADX-ignition breakout, strong-trend-rider) across both a 3-month and 1-year window to check for consistency, not just single-window curve-fit. Best 3 by cross-window consistency below.

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || p.adx == null || s.plusDI == null || s.minusDI == null || s.sma20 == null || s.sma50 == null || s.macdHist == null || p.macdHist == null || s.price == null) return null;
if (s.adx < 28 || s.adx <= p.adx) return null;
var gap = Math.abs(s.plusDI - s.minusDI);
if (gap < 10) return null;
if (s.plusDI > s.minusDI && s.price > s.sma20 && s.sma20 > s.sma50 && s.macdHist > p.macdHist && s.macdHist > 0) {
  return { side: "long", note: "strong trend rider: ADX " + s.adx.toFixed(0) + " rising, momentum accelerating" };
}
if (s.minusDI > s.plusDI && s.price < s.sma20 && s.sma20 < s.sma50 && s.macdHist < p.macdHist && s.macdHist < 0) {
  return { side: "short", note: "strong trend rider: ADX " + s.adx.toFixed(0) + " rising, momentum accelerating" };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 117 trades, 25.6% win rate, profit factor n/a, total P/L $26.25, Sharpe n/a.

## Live status

Proposed candidate, not yet reviewed. From research run #7.
