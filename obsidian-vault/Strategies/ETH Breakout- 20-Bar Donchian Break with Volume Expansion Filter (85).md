---
type: strategy
key: research-85
status: rejected
symbol: "ETH-USD"
timeframe: "1h"
tags: [strategy, research, sma, adx, macd, donchian]
---

# ETH Breakout: 20-Bar Donchian Break with Volume Expansion Filter

Entry signal for ETH-USD (Ethereum) swing trading, tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, win rate >50% with profit stable across both halves of a 1-year sample. Ethereum has never been tested in this project - only BTC-USD has (crypto strategies so far ported gold/BTC concepts unchanged). Design a fresh entry idea using OHLCV/indicators only, not a straight port of an existing gold or BTC strategy.

## Logic

```js
var n = bars.length;
var lookback = 20;
if (n < 2 * lookback + 2) return null;
var i = n - 1;
var s = snaps[i];
var sPrev = snaps[i - 1];
if (!s || s.adx == null || !sPrev || sPrev.adx == null) return null;
if (s.sma20 == null || s.sma50 == null || s.macdHist == null) return null;
var bar = bars[i];
var prevBar = bars[i - 1];

var hh = -Infinity, ll = Infinity, volSum = 0;
for (var k = i - lookback; k < i; k++) {
  var b = bars[k];
  if (b.h > hh) hh = b.h;
  if (b.l < ll) ll = b.l;
  volSum += b.v;
}
var avgVol = volSum / lookback;

var hhPrev = -Infinity, llPrev = Infinity;
for (var j = i - 1 - lookback; j < i - 1; j++) {
  var pb = bars[j];
  if (pb.h > hhPrev) hhPrev = pb.h;
  if (pb.l < llPrev) llPrev = pb.l;
}

var volExpansion = avgVol > 0 && bar.v > avgVol * 1.8;
var adxRising = (s.adx - sPrev.adx) >= 0.3;
var strongAdx = s.adx > 22;
var range = bar.h - bar.l;
var closeStrengthLong = range > 0 ? (bar.c - bar.l) / range : 0;
var closeStrengthShort = range > 0 ? (bar.h - bar.c) / range : 0;

var breakoutMarginLong = hh > 0 && bar.c > hh * 1.0015;
var breakoutMarginShort = ll > 0 && bar.c < ll * 0.9985;

var freshLongBreakout = breakoutMarginLong && prevBar.c <= hhPrev;
var freshShortBreakout = breakoutMarginShort && prevBar.c >= llPrev;

var trendUp = s.sma20 > s.sma50;
var trendDown = s.sma20 < s.sma50;
var momentumUp = s.macdHist > 0;
var momentumDown = s.macdHist < 0;

if (freshLongBreakout && volExpansion && strongAdx && adxRising && closeStrengthLong >= 0.65 && trendUp && momentumUp) {
  return { side: "long", note: "Fresh close breaks above the prior 20-bar high by a meaningful margin on a strong volume surge, with ADX above 22 and clearly rising, a strong upper-range close, medium-term uptrend (sma20>sma50) and positive MACD momentum all confirming conviction" };
}
if (freshShortBreakout && volExpansion && strongAdx && adxRising && closeStrengthShort >= 0.65 && trendDown && momentumDown) {
  return { side: "short", note: "Fresh close breaks below the prior 20-bar low by a meaningful margin on a strong volume surge, with ADX above 22 and clearly rising, a strong lower-range close, medium-term downtrend (sma20<sma50) and negative MACD momentum all confirming conviction" };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 81 trades, 56.8% win rate, profit factor 1.02, total P/L $3.19, Sharpe 0.17.

## Live status

Rejected after review - not live. From research run #58.
