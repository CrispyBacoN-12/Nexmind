---
type: strategy
key: research-101
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, adx, di, atr, gold]
---

# BB Squeeze Breakout (volatility contraction release)

Bollinger Band volatility-squeeze breakout on GOLD (GC=F) 1h bars: this mechanism has never been tried in this project (only DI-dominance, pullback, liquidity-sweep, engulfing/candlestick, and Donchian breakout mechanisms have been tested here). Use bbWidth (Bollinger Band width) from the snapshot: detect a squeeze when current bbWidth is at or near its lowest value over the trailing ~40 bars (volatility contraction), then enter on the breakout bar where price closes outside the Bollinger Band (use bbPercentB > 1 for long, bbPercentB < 0 for short) with ADX either low-but-rising or already trending, confirming the squeeze is releasing. Tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade. Target win rate >50%, adequate trade count (extended data range if needed) since squeezes are relatively rare events.

## Logic

```js
var n = bars.length;
if (n < 65) return null;
var i = n - 1;

function smaAt(end) {
  var sum = 0;
  for (var k = end - 19; k <= end; k++) sum += bars[k].c;
  return sum / 20;
}
function stdAt(end, mean) {
  var sumSq = 0;
  for (var k = end - 19; k <= end; k++) {
    var d = bars[k].c - mean;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / 20);
}
function bbAt(end) {
  var mean = smaAt(end);
  var sd = stdAt(end, mean);
  var upper = mean + 2 * sd;
  var lower = mean - 2 * sd;
  return { width: (upper - lower) / mean, upper: upper, lower: lower, mean: mean };
}

var cur = bbAt(i);
var prev = bbAt(i - 1);

var minWidth = cur.width;
for (var j = i - 39; j < i; j++) {
  var w = bbAt(j).width;
  if (w < minWidth) minWidth = w;
}

var isSqueeze = cur.width <= minWidth * 1.08;
if (!isSqueeze) return null;

var price = bars[i].c;
var percentB = (price - cur.lower) / (cur.upper - cur.lower);
var prevPercentB = (bars[i - 1].c - prev.lower) / (prev.upper - prev.lower);

var s = snaps[i];
var sPrev2 = snaps[i - 2];
if (!s || s.adx === null || s.atr === null || s.plusDI === null || s.minusDI === null) return null;

var adxRising = sPrev2 && sPrev2.adx !== null && s.adx > sPrev2.adx;
var adxOk = s.adx > 18 && adxRising;
if (!adxOk) return null;

var barRange = bars[i].h - bars[i].l;
var strongBar = s.atr > 0 && barRange > s.atr * 1.0;
if (!strongBar) return null;

var freshLongBreak = prevPercentB <= 1 && percentB > 1.01;
var freshShortBreak = prevPercentB >= 0 && percentB < -0.01;

if (freshLongBreak && s.plusDI > s.minusDI) {
  return { side: "long", note: "BB squeeze breakout long: bbWidth " + cur.width.toFixed(4) + " near 40-bar low (within 8%), fresh break above upper band (percentB " + percentB.toFixed(2) + " vs prev " + prevPercentB.toFixed(2) + "), ADX " + s.adx.toFixed(1) + " rising, +DI>-DI, strong bar range " + barRange.toFixed(4) + " vs ATR " + s.atr.toFixed(4) };
}
if (freshShortBreak && s.minusDI > s.plusDI) {
  return { side: "short", note: "BB squeeze breakout short: bbWidth " + cur.width.toFixed(4) + " near 40-bar low (within 8%), fresh break below lower band (percentB " + percentB.toFixed(2) + " vs prev " + prevPercentB.toFixed(2) + "), ADX " + s.adx.toFixed(1) + " rising, -DI>+DI, strong bar range " + barRange.toFixed(4) + " vs ATR " + s.atr.toFixed(4) };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 2 trades, 50.0% win rate, profit factor 6.94, total P/L $5.80, Sharpe 11.88.

## Live status

Rejected after review - not live. From research run #64.
