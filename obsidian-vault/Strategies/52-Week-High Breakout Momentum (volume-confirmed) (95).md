---
type: strategy
key: research-95
status: rejected
symbol: "MSFT"
timeframe: "1d"
tags: [strategy, research, sma, rsi, adx, di, macd, atr]
---

# 52-Week-High Breakout Momentum (volume-confirmed)

52-week-high breakout momentum entry signal for MSFT (large-cap, never tested in this project) on DAILY bars: a classic momentum-breakout mechanism never tried in this project - price closing at or near its highest close of the trailing ~252 daily bars, confirmed by volume at least 1.5x the trailing 50-day average volume. Compute the rolling high and average volume yourself from the raw bars array (there is no pre-built 52-week-high field in the snapshot data). Tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, win rate >50% with profit stable across both halves of a 5-year sample. Every equity strategy tried so far in this project used 1h/DI-dominance or a pullback concept - this is a fresh breakout mechanism on a fresh symbol and a lower-noise timeframe.

## Logic

```js
var n = bars.length;
if (n < 253) return null;
var i = n - 1;
var cur = bars[i];
var snap = snaps[i];
var prevSnap = snaps[i - 1];
if (!snap || snap.atr == null || snap.adx == null || snap.rsi == null || snap.plusDI == null || snap.minusDI == null || snap.macdHist == null || snap.sma20 == null || snap.sma50 == null) return null;
if (!prevSnap || prevSnap.macdHist == null) return null;

var lookback = 252;
var highestClose = -Infinity;
for (var k = i - lookback; k < i; k++) {
  if (bars[k].c > highestClose) highestClose = bars[k].c;
}

var volLookback = 50;
var volSum = 0;
for (var k = i - volLookback; k < i; k++) {
  volSum += bars[k].v;
}
var avgVol50 = volSum / volLookback;

// Decisive new closing high
var newHigh = cur.c > highestClose;
// Volume confirmation, but cap it: extreme spikes (>3.5x) are often climax/exhaustion volume, not healthy accumulation
var volRatio = avgVol50 > 0 ? cur.v / avgVol50 : 0;
var volSurge = volRatio >= 1.4 && volRatio <= 3.5;
// Reject weak/wicky breakout candles
var range = cur.h - cur.l;
var closedStrong = range <= 0 || (cur.c - cur.l) / range >= 0.65;
// Trend/momentum confirmation: stronger ADX floor and a real DI gap, not just plusDI > minusDI by a hair
var diGap = snap.plusDI - snap.minusDI;
var trendOk = snap.adx >= 23 && diGap >= 5;
// Momentum must be accelerating, not just positive
var momentumBuilding = snap.macdHist > 0 && snap.macdHist > prevSnap.macdHist;
// Avoid both overbought blow-offs and half-hearted moves lacking momentum
var rsiOk = snap.rsi >= 55 && snap.rsi < 70;
// Require bullish moving-average stack so we're breaking out with the trend, not against it
var maStackOk = cur.c > snap.sma20 && snap.sma20 > snap.sma50;
// Reject gap-mania breakouts that are already far past the prior high (poor risk/reward, prone to mean reversion)
var extension = (cur.c - highestClose) / highestClose;
var notOverextended = extension <= 0.06;

if (newHigh && volSurge && closedStrong && trendOk && momentumBuilding && rsiOk && maStackOk && notOverextended) {
  return {
    side: "long",
    note: "52w-high breakout: close " + cur.c.toFixed(2) + " > prior 252-bar high " + highestClose.toFixed(2) + " (+" + (extension * 100).toFixed(1) + "%), vol " + volRatio.toFixed(2) + "x 50d avg, ADX " + snap.adx.toFixed(1) + ", DI gap " + diGap.toFixed(1) + ", RSI " + snap.rsi.toFixed(1) + ", MACD hist rising."
  };
}
return null;
```

## Backtest history

- Research pipeline backtest (5y, 1d): 2 trades, 100.0% win rate, profit factor n/a, total P/L $1.70, Sharpe 561.29.

## Live status

Rejected after review - not live. From research run #62.
