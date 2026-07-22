---
type: strategy
key: research-86
status: rejected
symbol: "NVDA"
timeframe: "1h"
tags: [strategy, research, sma, rsi, adx]
---

# VWAP Deviation Momentum (volume-confirmed continuation)

Entry signal for NVDA (high-volume, high-volatility large-cap tech stock - never tested in this project; the only equity tried so far is AAPL, using a DI-Dominance trend-strength concept) swing trading on 1h bars, tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, win rate >50% with profit stable across both halves of a 1-year sample. Use a volume or VWAP-deviation based confirmation mechanism (vwapDevPct is available in the snapshot data) rather than a DI/ADX trend-strength port - a genuinely different signal family than what's been tried on equities so far.

## Logic

```js
var n = bars.length;
if (n < 60) return null;
var i = n - 1;
var bar = bars[i];
var snap = snaps[i];
if (!snap || snap.sma20 == null || snap.sma50 == null || snap.rsi == null || snap.adx == null) return null;

var volSum = 0, volCount = 0;
for (var k = i - 20; k < i; k++) {
  if (k >= 0) { volSum += bars[k].v; volCount++; }
}
if (volCount < 15) return null;
var avgVol = volSum / volCount;
if (avgVol <= 0) return null;
var volRatio = bar.v / avgVol;

var lookback = 5;
var prevSnap = snaps[i - lookback];
var prevBar = bars[i - lookback];
if (!prevSnap || prevSnap.sma20 == null || !prevBar) return null;

var devNow = (bar.c - snap.sma20) / snap.sma20 * 100;
var devPrev = (prevBar.c - prevSnap.sma20) / prevSnap.sma20 * 100;

var bullishCandle = bar.c > bar.o;
var bearishCandle = bar.c < bar.o;

var longSignal = devNow > 0.5 && devNow > devPrev + 0.15 && volRatio > 1.5 && snap.rsi > 55 && snap.rsi < 70 && snap.adx > 22 && bar.c > snap.sma50 && bullishCandle;
var shortSignal = devNow < -0.5 && devNow < devPrev - 0.15 && volRatio > 1.5 && snap.rsi < 45 && snap.rsi > 30 && snap.adx > 22 && bar.c < snap.sma50 && bearishCandle;

if (longSignal) {
  return { side: "long", note: "SMA20 dev momentum long: dev=" + devNow.toFixed(2) + "% (was " + devPrev.toFixed(2) + "%), vol " + volRatio.toFixed(2) + "x avg, adx " + snap.adx.toFixed(1) + ", above sma50" };
}
if (shortSignal) {
  return { side: "short", note: "SMA20 dev momentum short: dev=" + devNow.toFixed(2) + "% (was " + devPrev.toFixed(2) + "%), vol " + volRatio.toFixed(2) + "x avg, adx " + snap.adx.toFixed(1) + ", below sma50" };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 2 trades, 50.0% win rate, profit factor 0.56, total P/L $-0.13, Sharpe -4.52.

## Live status

Rejected after review - not live. From research run #59.
