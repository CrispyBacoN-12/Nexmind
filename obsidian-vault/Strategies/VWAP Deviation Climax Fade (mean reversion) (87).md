---
type: strategy
key: research-87
status: rejected
symbol: "NVDA"
timeframe: "1h"
tags: [strategy, research, sma, rsi, adx, atr]
---

# VWAP Deviation Climax Fade (mean reversion)

Entry signal for NVDA (high-volume, high-volatility large-cap tech stock - never tested in this project; the only equity tried so far is AAPL, using a DI-Dominance trend-strength concept) swing trading on 1h bars, tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, win rate >50% with profit stable across both halves of a 1-year sample. Use a volume or VWAP-deviation based confirmation mechanism (vwapDevPct is available in the snapshot data) rather than a DI/ADX trend-strength port - a genuinely different signal family than what's been tried on equities so far.

## Logic

```js
var n = bars.length;
if (n < 25) return null;
var i = n - 1;
var bar = bars[i];
var snap = snaps[i];
var prevBar = bars[i - 1];
var prevSnap = snaps[i - 1];
if (!snap || !prevSnap || snap.sma20 == null || prevSnap.sma20 == null || snap.atr == null || snap.rsi == null || prevSnap.rsi == null || snap.adx == null) return null;
if (snap.sma20 === 0 || prevSnap.sma20 === 0 || snap.atr <= 0) return null;

var volSum = 0, volCount = 0;
for (var k = i - 20; k < i; k++) {
  if (k >= 0) { volSum += bars[k].v; volCount++; }
}
if (volCount < 10) return null;
var avgVol = volSum / volCount;
if (avgVol <= 0) return null;
var climaxVol = prevBar.v / avgVol;

var devNow = (snap.price - snap.sma20) / snap.sma20 * 100;
var devPrev = (prevSnap.price - prevSnap.sma20) / prevSnap.sma20 * 100;
var EXT = 1.2;
var VOLCLIMAX = 1.4;

var range = bar.h - bar.l;
if (range <= 0) return null;
var closePos = (bar.c - bar.l) / range;
var bodyMove = Math.abs(bar.c - bar.o);
var meaningfulBody = bodyMove > snap.atr * 0.3;
var notStrongTrend = snap.adx < 35;

var extendedDown = devPrev < -EXT && climaxVol > VOLCLIMAX;
var reversingUp = bar.c > prevBar.c && bar.c > bar.o && devNow > devPrev && closePos > 0.6 && meaningfulBody;
var oversoldConfirm = prevSnap.rsi < 35;
var stillBelowSma = devNow < 0;

var extendedUp = devPrev > EXT && climaxVol > VOLCLIMAX;
var reversingDown = bar.c < prevBar.c && bar.c < bar.o && devNow < devPrev && closePos < 0.4 && meaningfulBody;
var overboughtConfirm = prevSnap.rsi > 65;
var stillAboveSma = devNow > 0;

if (extendedDown && reversingUp && oversoldConfirm && notStrongTrend && stillBelowSma) {
  return { side: "long", note: "SMA20 fade long: prior dev=" + devPrev.toFixed(2) + "% on " + climaxVol.toFixed(2) + "x vol climax, RSI=" + prevSnap.rsi.toFixed(1) + " oversold, ADX=" + snap.adx.toFixed(1) + ", strong reversal close" };
}
if (extendedUp && reversingDown && overboughtConfirm && notStrongTrend && stillAboveSma) {
  return { side: "short", note: "SMA20 fade short: prior dev=" + devPrev.toFixed(2) + "% on " + climaxVol.toFixed(2) + "x vol climax, RSI=" + prevSnap.rsi.toFixed(1) + " overbought, ADX=" + snap.adx.toFixed(1) + ", strong reversal close" };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 4 trades, 75.0% win rate, profit factor 3.22, total P/L $0.46, Sharpe 9.72.

## Live status

Rejected after review - not live. From research run #59.
