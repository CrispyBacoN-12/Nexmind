---
type: strategy
key: research-3
status: rejected
symbol: "BTC-USD"
timeframe: "1h"
tags: [strategy, research, sma, rsi, adx, di, macd]
---

# SMA Golden/Death Cross Breakout

a mean-reversion strategy that only trades during low-ADX chop

## Logic

```js
const i = bars.length - 1;
const snap = snaps[i];
const prevSnap = snaps[i - 1];
if (!snap || !prevSnap) return null;
if (snap.sma20 === null || snap.sma50 === null || snap.macdHist === null ||
    snap.rsi === null || snap.adx === null || snap.plusDI === null || snap.minusDI === null) return null;
if (prevSnap.sma20 === null || prevSnap.sma50 === null || prevSnap.macdHist === null) return null;

const goldenCross = prevSnap.sma20 <= prevSnap.sma50 && snap.sma20 > snap.sma50;
const deathCross  = prevSnap.sma20 >= prevSnap.sma50 && snap.sma20 < snap.sma50;

// Only enter in trending markets — ADX below 22 is mostly chop where crosses whipsaw
if (snap.adx <= 22) return null;

// Require MACD histogram to be accelerating in the signal direction
const macdGrowing = snap.macdHist > prevSnap.macdHist;
const macdFalling = snap.macdHist < prevSnap.macdHist;

// Long: golden cross + DI+ leading + MACD still building + RSI in momentum zone (not overbought)
if (goldenCross && snap.macdHist > 0 && macdGrowing &&
    snap.plusDI > snap.minusDI &&
    snap.rsi > 50 && snap.rsi < 75) {
  return { side: "long", note: "Golden cross | ADX=" + snap.adx.toFixed(1) + " DI+=" + snap.plusDI.toFixed(1) + " RSI=" + snap.rsi.toFixed(1) + " MACD=" + snap.macdHist.toFixed(3) };
}

// Short: death cross + DI- leading + MACD still weakening + RSI in momentum zone (not oversold)
if (deathCross && snap.macdHist < 0 && macdFalling &&
    snap.minusDI > snap.plusDI &&
    snap.rsi < 50 && snap.rsi > 25) {
  return { side: "short", note: "Death cross | ADX=" + snap.adx.toFixed(1) + " DI-=" + snap.minusDI.toFixed(1) + " RSI=" + snap.rsi.toFixed(1) + " MACD=" + snap.macdHist.toFixed(3) };
}

return null;
```

## Backtest history

- Research pipeline backtest (3mo, 1h): 4 trades, 25.0% win rate, profit factor n/a, total P/L $-111.28, Sharpe n/a.

## Live status

Rejected after review - not live. From research run #1.
