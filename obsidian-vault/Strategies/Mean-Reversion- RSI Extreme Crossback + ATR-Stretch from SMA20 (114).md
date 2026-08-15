---
type: strategy
key: research-114
status: rejected
symbol: "BTC-USD"
timeframe: "1h"
tags: [strategy, research, sma, rsi, adx, di, macd, atr]
---

# Mean-Reversion: RSI Extreme Crossback + ATR-Stretch from SMA20

Momentum/breakout entry signal for BTC-USD swing trading, tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, win rate >50% with profit stable across both halves of the sample (not just a good average).

## Logic

```js
var n = bars.length;
if (n < 8) return null;
var s = snaps[n-1];
var sPrev = snaps[n-2];
if (!s || !sPrev) return null;
if (s.rsi == null || sPrev.rsi == null || s.sma20 == null || s.atr == null || s.adx == null || s.plusDI == null || s.minusDI == null || sPrev.plusDI == null || sPrev.minusDI == null || s.macdHist == null || sPrev.macdHist == null) return null;
if (s.atr <= 0) return null;

var bar = bars[n-1];
var prevBar = bars[n-2];
var price = bar.c;
var dist = price - s.sma20;
var distAtr = dist / s.atr;
var distOk = Math.abs(distAtr) >= 1 && Math.abs(distAtr) <= 2.5;

var lookback = 6;
var minRsi = Infinity, maxRsi = -Infinity;
for (var i = n - 2; i > n - 2 - lookback && i >= 0; i--) {
  var snap = snaps[i];
  if (!snap || snap.rsi == null) continue;
  if (snap.rsi < minRsi) minRsi = snap.rsi;
  if (snap.rsi > maxRsi) maxRsi = snap.rsi;
}

var rangeMarket = s.adx < 22;
var bullishConfirm = bar.c > bar.o && bar.c > prevBar.h;
var bearishConfirm = bar.c < bar.o && bar.c < prevBar.l;
var momentumUpTurning = s.macdHist > sPrev.macdHist;
var momentumDownTurning = s.macdHist < sPrev.macdHist;

if (rangeMarket && distOk && distAtr < 0 && sPrev.rsi < 30 && s.rsi >= 30 && minRsi < 25 && bullishConfirm && s.minusDI < sPrev.minusDI && momentumUpTurning) {
  return { side: "long", note: "mean-reversion: RSI dipped to " + minRsi.toFixed(1) + " then crossed up through 30 (" + sPrev.rsi.toFixed(1) + "->" + s.rsi.toFixed(1) + "), price " + Math.abs(distAtr).toFixed(2) + " ATR below sma20, ADX<22, -DI fading, MACD hist rising, confirm bar closed above prior bar's high" };
}
if (rangeMarket && distOk && distAtr > 0 && sPrev.rsi > 70 && s.rsi <= 70 && maxRsi > 75 && bearishConfirm && s.plusDI < sPrev.plusDI && momentumDownTurning) {
  return { side: "short", note: "mean-reversion: RSI spiked to " + maxRsi.toFixed(1) + " then crossed down through 70 (" + sPrev.rsi.toFixed(1) + "->" + s.rsi.toFixed(1) + "), price " + distAtr.toFixed(2) + " ATR above sma20, ADX<22, +DI fading, MACD hist falling, confirm bar closed below prior bar's low" };
}
return null;
```

## Backtest history

- Research pipeline backtest (3mo, 1h): 1 trades, 0.0% win rate, profit factor 0.00, total P/L $-44.94, Sharpe n/a.

## Live status

Rejected after review - not live. From research run #69.
