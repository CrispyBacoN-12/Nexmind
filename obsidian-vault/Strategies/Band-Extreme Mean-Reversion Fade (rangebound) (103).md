---
type: strategy
key: research-103
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, rsi, adx, di, gold]
---

# Band-Extreme Mean-Reversion Fade (rangebound)

Bollinger Band volatility-squeeze breakout on GOLD (GC=F) 1h bars: this mechanism has never been tried in this project (only DI-dominance, pullback, liquidity-sweep, engulfing/candlestick, and Donchian breakout mechanisms have been tested here). Use bbWidth (Bollinger Band width) from the snapshot: detect a squeeze when current bbWidth is at or near its lowest value over the trailing ~40 bars (volatility contraction), then enter on the breakout bar where price closes outside the Bollinger Band (use bbPercentB > 1 for long, bbPercentB < 0 for short) with ADX either low-but-rising or already trending, confirming the squeeze is releasing. Tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade. Target win rate >50%, adequate trade count (extended data range if needed) since squeezes are relatively rare events.

## Logic

```js
var n = bars.length;
if (n < 27) return null;
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

var mean = smaAt(i);
var sd = stdAt(i, mean);
var upper = mean + 2 * sd;
var lower = mean - 2 * sd;

var meanPrev = smaAt(i - 1);
var sdPrev = stdAt(i - 1, meanPrev);
var upperPrev = meanPrev + 2 * sdPrev;
var lowerPrev = meanPrev - 2 * sdPrev;

var meanPrev2 = smaAt(i - 2);
var sdPrev2 = stdAt(i - 2, meanPrev2);
var upperPrev2 = meanPrev2 + 2 * sdPrev2;
var lowerPrev2 = meanPrev2 - 2 * sdPrev2;

var price = bars[i].c;
var open = bars[i].o;
var pricePrev = bars[i - 1].c;
var pricePrev2 = bars[i - 2].c;

var s = snaps[i];
var sPrev = snaps[i - 1];
if (!s || !sPrev || s.adx === null || s.rsi === null || sPrev.rsi === null) return null;
if (s.plusDI === null || s.minusDI === null) return null;

// Tighter rangebound gate: ADX must not be building (avoids fading a market that's about to trend)
var rangebound = s.adx < 18 && Math.abs(s.plusDI - s.minusDI) < 10 && s.adx <= sPrev.adx + 0.5;
if (!rangebound) return null;

var bandWidthPct = (upper - lower) / mean;
if (bandWidthPct < 0.012) return null;

var reentryBuffer = 0.15 * sd;

// Require the break above/below to be FRESH (bar i-2 was still inside) so we're fading the
// first poke outside the band, not entering mid-way through an established band walk/trend.
var freshBreakAbove = pricePrev2 <= upperPrev2 && pricePrev > upperPrev;
var brokeAboveThenBack = freshBreakAbove && price <= upper - reentryBuffer;
var rsiTurningDown = s.rsi < sPrev.rsi;
var bearishCandle = price < open;
if (brokeAboveThenBack && sPrev.rsi > 70 && rsiTurningDown && bearishCandle) {
  return { side: "short", note: "Mean-reversion fade short: fresh poke above upper BB last bar (RSI " + sPrev.rsi.toFixed(1) + "), current bar closed back inside with buffer (" + price.toFixed(2) + " vs upper " + upper.toFixed(2) + "), bearish close, RSI turning down to " + s.rsi.toFixed(1) + ", ADX " + s.adx.toFixed(1) + " flat/falling confirms range, targeting reversion to SMA20" };
}

var freshBreakBelow = pricePrev2 >= lowerPrev2 && pricePrev < lowerPrev;
var brokeBelowThenBack = freshBreakBelow && price >= lower + reentryBuffer;
var rsiTurningUp = s.rsi > sPrev.rsi;
var bullishCandle = price > open;
if (brokeBelowThenBack && sPrev.rsi < 30 && rsiTurningUp && bullishCandle) {
  return { side: "long", note: "Mean-reversion fade long: fresh poke below lower BB last bar (RSI " + sPrev.rsi.toFixed(1) + "), current bar closed back inside with buffer (" + price.toFixed(2) + " vs lower " + lower.toFixed(2) + "), bullish close, RSI turning up to " + s.rsi.toFixed(1) + ", ADX " + s.adx.toFixed(1) + " flat/falling confirms range, targeting reversion to SMA20" };
}

return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 2 trades, 50.0% win rate, profit factor 0.35, total P/L $-2.55, Sharpe -7.57.

## Live status

Rejected after review - not live. From research run #64.
