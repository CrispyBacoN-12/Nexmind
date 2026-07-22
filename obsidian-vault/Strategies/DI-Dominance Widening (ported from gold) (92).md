---
type: strategy
key: research-92
status: rejected
symbol: "SI=F"
timeframe: "1h"
tags: [strategy, research, sma, adx, di, macd]
---

# DI-Dominance Widening (ported from gold)

DI-Dominance Widening entry signal for SI=F (silver futures): fires whenever the +DI/-DI gap is widening while ADX >= 20, no fresh crossover required. This is the same logic as the live gold strategy (research-30 on GC=F, blind-tested 59.2% win rate, +$4,419/yr annualized) - the strongest validated concept in this project. Silver has had only one prior strategy tried (a Bollinger%B+Stochastic mean-reversion fade). Port the DI-Dominance concept unchanged to test whether the trend-following edge transfers to silver, which correlates with but trades differently than gold (higher volatility, more industrial-demand driven). Tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade.

## Logic

```js
var n = snaps.length;
var cur = snaps[n - 1];
var prev = snaps[n - 2];
var prev2 = snaps[n - 3];
if (!cur || !prev || !prev2) return null;
if (cur.adx == null || cur.plusDI == null || cur.minusDI == null) return null;
if (prev.plusDI == null || prev.minusDI == null || prev.adx == null) return null;
if (prev2.adx == null) return null;
if (cur.macdHist == null) return null;
if (cur.adx < 27) return null;
if (cur.adx <= prev.adx || prev.adx <= prev2.adx) return null;
var curGap = cur.plusDI - cur.minusDI;
var prevGap = prev.plusDI - prev.minusDI;
var curAbs = Math.abs(curGap);
var prevAbs = Math.abs(prevGap);
var GAP_THRESH = 10;
if (curAbs < GAP_THRESH) return null;
if (prevAbs >= GAP_THRESH) return null;
if (curAbs - prevAbs < 2.5) return null;
if (curGap > 0) {
  if (cur.macdHist <= 0) return null;
  if (cur.sma50 != null && cur.price < cur.sma50) return null;
  return { side: "long", note: "DI gap fresh-cross widening bullish, ADX=" + cur.adx.toFixed(1) + " rising 2-bar, gap=" + curGap.toFixed(1) };
}
if (curGap < 0) {
  if (cur.macdHist >= 0) return null;
  if (cur.sma50 != null && cur.price > cur.sma50) return null;
  return { side: "short", note: "DI gap fresh-cross widening bearish, ADX=" + cur.adx.toFixed(1) + " rising 2-bar, gap=" + curGap.toFixed(1) };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 2 trades, 50.0% win rate, profit factor 4.15, total P/L $0.09, Sharpe 9.71.

## Live status

Rejected after review - not live. From research run #61.
