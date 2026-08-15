---
type: strategy
key: research-115
status: rejected
symbol: "BTC-USD"
timeframe: "1h"
tags: [strategy, research, sma, rsi, adx, di, macd, atr]
---

# Breakout: 20-Bar Range Break with Volume + ADX Confirmation

Momentum/breakout entry signal for BTC-USD swing trading, tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, win rate >50% with profit stable across both halves of the sample (not just a good average).

## Logic

```js
var n = bars.length;
var lookback = 20;
if (n < lookback + 7) return null;
var s = snaps[n-1];
if (!s || s.adx == null || s.plusDI == null || s.minusDI == null || s.atr == null || s.macdHist == null || s.sma50 == null || s.sma20 == null || s.rsi == null) return null;
var sPrev = snaps[n-6];
if (!sPrev || sPrev.adx == null) return null;
var cur = bars[n-1];
var hh = -1e18, ll = 1e18, volSum = 0;
for (var i = n - 1 - lookback; i < n - 1; i++) {
  var b = bars[i];
  if (b.h > hh) hh = b.h;
  if (b.l < ll) ll = b.l;
  volSum += b.v;
}
var avgVol = volSum / lookback;
if (avgVol <= 0 || s.atr <= 0) return null;

var margin = s.atr * 0.4;
var volOk = cur.v > avgVol * 1.6;
var adxOk = s.adx > 25 && s.adx > sPrev.adx;
var range = cur.h - cur.l;
var closePos = range > 0 ? (cur.c - cur.l) / range : 0.5;

if (cur.c > hh + margin && volOk && adxOk && s.plusDI > s.minusDI && s.macdHist > 0 && cur.c > s.sma50 && cur.c > s.sma20 && s.rsi > 50 && s.rsi < 72 && closePos > 0.65) {
  return { side: "long", note: "breakout: close " + cur.c.toFixed(2) + " above " + lookback + "-bar high " + hh.toFixed(2) + " +0.4ATR margin, vol " + (cur.v / avgVol).toFixed(2) + "x avg, ADX " + s.adx.toFixed(1) + " rising, +DI>-DI, MACD hist>0, above SMA20/50, RSI " + s.rsi.toFixed(1) + ", strong close" };
}
if (cur.c < ll - margin && volOk && adxOk && s.minusDI > s.plusDI && s.macdHist < 0 && cur.c < s.sma50 && cur.c < s.sma20 && s.rsi < 50 && s.rsi > 28 && closePos < 0.35) {
  return { side: "short", note: "breakout: close " + cur.c.toFixed(2) + " below " + lookback + "-bar low " + ll.toFixed(2) + " -0.4ATR margin, vol " + (cur.v / avgVol).toFixed(2) + "x avg, ADX " + s.adx.toFixed(1) + " rising, -DI>+DI, MACD hist<0, below SMA20/50, RSI " + s.rsi.toFixed(1) + ", weak close" };
}
return null;
```

## Backtest history

- Research pipeline backtest (3mo, 1h): 5 trades, 80.0% win rate, profit factor 2.91, total P/L $113.95, Sharpe 8.74.

## Live status

Rejected after review - not live. From research run #69.
