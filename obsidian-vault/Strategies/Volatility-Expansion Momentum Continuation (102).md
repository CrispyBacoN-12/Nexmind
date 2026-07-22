---
type: strategy
key: research-102
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, adx, di, macd, gold]
---

# Volatility-Expansion Momentum Continuation

Bollinger Band volatility-squeeze breakout on GOLD (GC=F) 1h bars: this mechanism has never been tried in this project (only DI-dominance, pullback, liquidity-sweep, engulfing/candlestick, and Donchian breakout mechanisms have been tested here). Use bbWidth (Bollinger Band width) from the snapshot: detect a squeeze when current bbWidth is at or near its lowest value over the trailing ~40 bars (volatility contraction), then enter on the breakout bar where price closes outside the Bollinger Band (use bbPercentB > 1 for long, bbPercentB < 0 for short) with ADX either low-but-rising or already trending, confirming the squeeze is releasing. Tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade. Target win rate >50%, adequate trade count (extended data range if needed) since squeezes are relatively rare events.

## Logic

```js
var n = bars.length;
if (n < 45) return null;
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
function bbWidthAt(end) {
  var mean = smaAt(end);
  var sd = stdAt(end, mean);
  return (4 * sd) / mean;
}

var w0 = bbWidthAt(i);
var w1 = bbWidthAt(i - 1);
var w2 = bbWidthAt(i - 2);
var expanding = w0 > w1 && w1 > w2;
if (!expanding) return null;

var s = snaps[i];
var sPrev = snaps[i - 1];
if (!s || !sPrev) return null;
if (s.macdHist === null || s.adx === null || s.plusDI === null || s.minusDI === null) return null;
if (sPrev.macdHist === null || sPrev.adx === null) return null;

var adxRising = s.adx > sPrev.adx;
var macdRising = s.macdHist > sPrev.macdHist;
var macdFalling = s.macdHist < sPrev.macdHist;

if (s.macdHist > 0 && macdRising && s.plusDI > s.minusDI && adxRising && s.adx > 15) {
  return { side: "long", note: "Momentum continuation long: bbWidth expanding " + w2.toFixed(4) + "->" + w1.toFixed(4) + "->" + w0.toFixed(4) + ", MACD hist rising (" + s.macdHist.toFixed(3) + "), +DI>-DI, ADX rising to " + s.adx.toFixed(1) };
}
if (s.macdHist < 0 && macdFalling && s.minusDI > s.plusDI && adxRising && s.adx > 15) {
  return { side: "short", note: "Momentum continuation short: bbWidth expanding " + w2.toFixed(4) + "->" + w1.toFixed(4) + "->" + w0.toFixed(4) + ", MACD hist falling (" + s.macdHist.toFixed(3) + "), -DI>+DI, ADX rising to " + s.adx.toFixed(1) };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 386 trades, 57.0% win rate, profit factor 1.00, total P/L $-2.81, Sharpe -0.04.

## Live status

Rejected after review - not live. From research run #64.
