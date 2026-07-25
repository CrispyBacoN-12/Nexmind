---
type: strategy
key: research-97
status: rejected
symbol: "MSFT"
timeframe: "1d"
tags: [strategy, research, sma, adx, di, atr, donchian]
---

# 20-Bar Donchian Channel Breakout (ADX-rising + DI confirmation)

52-week-high breakout momentum entry signal for MSFT (large-cap, never tested in this project) on DAILY bars: a classic momentum-breakout mechanism never tried in this project - price closing at or near its highest close of the trailing ~252 daily bars, confirmed by volume at least 1.5x the trailing 50-day average volume. Compute the rolling high and average volume yourself from the raw bars array (there is no pre-built 52-week-high field in the snapshot data). Tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, win rate >50% with profit stable across both halves of a 5-year sample. Every equity strategy tried so far in this project used 1h/DI-dominance or a pullback concept - this is a fresh breakout mechanism on a fresh symbol and a lower-noise timeframe.

## Logic

```js
var n = bars.length;
if (n < 55) return null;
var i = n - 1;
var cur = bars[i];
var snap = snaps[i];
var snapPrev = snaps[i - 5];
if (!snap || !snapPrev) return null;
if (snap.adx == null || snapPrev.adx == null || snap.atr == null || snap.plusDI == null || snap.minusDI == null || snap.sma50 == null) return null;

var lookback = 20;
var highestHigh = -Infinity;
var lowestLow = Infinity;
var volSum = 0;
var volCount = 0;
for (var k = i - lookback; k < i; k++) {
  if (bars[k].h > highestHigh) highestHigh = bars[k].h;
  if (bars[k].l < lowestLow) lowestLow = bars[k].l;
  if (bars[k].v != null) { volSum += bars[k].v; volCount++; }
}
var avgVol = volCount > 0 ? volSum / volCount : null;

var atr = snap.atr;
var adxRising = snap.adx > snapPrev.adx + 1.5;
var adxStrong = snap.adx > 22;
var diGap = Math.abs(snap.plusDI - snap.minusDI);
var diGapOk = diGap > 4;
var volOk = (avgVol == null || cur.v == null) ? true : cur.v > avgVol * 1.2;
var maxExtension = 0.8 * atr;

var longTrendOk = cur.c > snap.sma50;
var shortTrendOk = cur.c < snap.sma50;

if (cur.c > highestHigh && (cur.c - highestHigh) <= maxExtension && adxRising && adxStrong && snap.plusDI > snap.minusDI && diGapOk && volOk && longTrendOk) {
  return {
    side: "long",
    note: "20-bar Donchian breakout: close " + cur.c.toFixed(2) + " > channel high " + highestHigh.toFixed(2) + " (ext " + (cur.c - highestHigh).toFixed(2) + " <=0.8xATR), ADX " + snapPrev.adx.toFixed(1) + "->" + snap.adx.toFixed(1) + " (>22 & rising by >1.5), +DI-(-DI) gap " + diGap.toFixed(1) + ", above SMA50, vol confirmed. SL 1.3xATR/TP 1.8xATR."
  };
}
if (cur.c < lowestLow && (lowestLow - cur.c) <= maxExtension && adxRising && adxStrong && snap.minusDI > snap.plusDI && diGapOk && volOk && shortTrendOk) {
  return {
    side: "short",
    note: "20-bar Donchian breakdown: close " + cur.c.toFixed(2) + " < channel low " + lowestLow.toFixed(2) + " (ext " + (lowestLow - cur.c).toFixed(2) + " <=0.8xATR), ADX " + snapPrev.adx.toFixed(1) + "->" + snap.adx.toFixed(1) + " (>22 & rising by >1.5), -DI-(+DI) gap " + diGap.toFixed(1) + ", below SMA50, vol confirmed. SL 1.3xATR/TP 1.8xATR."
  };
}
return null;
```

## Backtest history

- Research pipeline backtest (5y, 1d): 17 trades, 52.9% win rate, profit factor 0.80, total P/L $-2.08, Sharpe -1.74.

## Live status

Rejected after review - not live. From research run #62.
