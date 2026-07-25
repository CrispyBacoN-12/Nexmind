---
type: strategy
key: research-94
status: rejected
symbol: "SI=F"
timeframe: "1h"
tags: [strategy, research, adx, di, macd, atr, donchian]
---

# 20-Bar Donchian Breakout (ADX-filtered)

DI-Dominance Widening entry signal for SI=F (silver futures): fires whenever the +DI/-DI gap is widening while ADX >= 20, no fresh crossover required. This is the same logic as the live gold strategy (research-30 on GC=F, blind-tested 59.2% win rate, +$4,419/yr annualized) - the strongest validated concept in this project. Silver has had only one prior strategy tried (a Bollinger%B+Stochastic mean-reversion fade). Port the DI-Dominance concept unchanged to test whether the trend-following edge transfers to silver, which correlates with but trades differently than gold (higher volatility, more industrial-demand driven). Tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade.

## Logic

```js
var n = bars.length;
if (n < 22) return null;
var lookback = 20;
var curBar = bars[n - 1];
var cur = snaps[n - 1];
var prevBar = bars[n - 2];
var prev = snaps[n - 2];
if (!cur || cur.adx == null || cur.atr == null || cur.plusDI == null || cur.minusDI == null || cur.macdHist == null) return null;
if (!prev || prev.adx == null || prev.plusDI == null || prev.minusDI == null || prev.macdHist == null) return null;
if (cur.adx < 28 || cur.adx < prev.adx) return null;
var highestHigh = -Infinity;
var lowestLow = Infinity;
for (var i = n - 1 - lookback; i < n - 1; i++) {
  if (bars[i].h > highestHigh) highestHigh = bars[i].h;
  if (bars[i].l < lowestLow) lowestLow = bars[i].l;
}
var margin = 0.5 * cur.atr;
var diGap = cur.plusDI - cur.minusDI;
var prevDiGap = prev.plusDI - prev.minusDI;
var longLevel = highestHigh + margin;
var shortLevel = lowestLow - margin;
var longBreakout = curBar.c > longLevel;
var prevLongBreakout = prevBar.c > longLevel;
var shortBreakdown = curBar.c < shortLevel;
var prevShortBreakdown = prevBar.c < shortLevel;
if (longBreakout && !prevLongBreakout && diGap > 0 && diGap > prevDiGap && cur.macdHist > 0 && cur.macdHist > prev.macdHist) {
  return { side: "long", note: "Fresh 20-bar Donchian breakout, close=" + curBar.c.toFixed(2) + " > priorHigh=" + highestHigh.toFixed(2) + "+margin(0.5xATR=" + margin.toFixed(2) + "), ADX=" + cur.adx.toFixed(1) + " rising, +DI-DI gap widening, MACDhist rising>0" };
}
if (shortBreakdown && !prevShortBreakdown && diGap < 0 && diGap < prevDiGap && cur.macdHist < 0 && cur.macdHist < prev.macdHist) {
  return { side: "short", note: "Fresh 20-bar Donchian breakdown, close=" + curBar.c.toFixed(2) + " < priorLow=" + lowestLow.toFixed(2) + "-margin(0.5xATR=" + margin.toFixed(2) + "), ADX=" + cur.adx.toFixed(1) + " rising, -DI+DI gap widening, MACDhist falling<0" };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 82 trades, 52.4% win rate, profit factor 0.81, total P/L $-0.95, Sharpe -1.60.

## Live status

Rejected after review - not live. From research run #61.
