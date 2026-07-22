---
type: strategy
key: research-84
status: rejected
symbol: "ETH-USD"
timeframe: "1h"
tags: [strategy, research, sma, rsi, adx, atr]
---

# ETH Mean-Reversion: ATR-Normalized SMA20 Stretch + Reversal Bar

Entry signal for ETH-USD (Ethereum) swing trading, tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, win rate >50% with profit stable across both halves of a 1-year sample. Ethereum has never been tested in this project - only BTC-USD has (crypto strategies so far ported gold/BTC concepts unchanged). Design a fresh entry idea using OHLCV/indicators only, not a straight port of an existing gold or BTC strategy.

## Logic

```js
var n = bars.length;
if (n < 8) return null;
var i = n - 1;
var s = snaps[i], sPrev = snaps[i - 1];
var bar = bars[i], prevBar = bars[i - 1];
if (!s || !sPrev) return null;
if (s.sma20 == null || s.atr == null || s.rsi == null || s.atr === 0 || s.adx == null || sPrev.rsi == null) return null;

var dev = (bar.c - s.sma20) / s.atr;
var range = bar.h - bar.l;
if (range === 0) return null;
var closePos = (bar.c - bar.l) / range;
var bodyPct = Math.abs(bar.c - bar.o) / range;

var rangeOk = bodyPct > 0.35;
var nonTrending = s.adx < 20;

var bullishReversal = bar.c > bar.o && bar.c > prevBar.c && closePos > 0.65;
var bearishReversal = bar.c < bar.o && bar.c < prevBar.c && closePos < 0.35;

var rsiRising = s.rsi > sPrev.rsi;
var rsiFalling = s.rsi < sPrev.rsi;

// exhaustion check: current extreme must be the extreme of the last 5 bars (true capitulation, not mid-slide)
var lowestLow = bar.l, highestHigh = bar.h;
for (var k = i - 4; k < i; k++) {
  if (bars[k].l < lowestLow) lowestLow = bars[k].l;
  if (bars[k].h > highestHigh) highestHigh = bars[k].h;
}
var isSwingLow = bar.l <= lowestLow;
var isSwingHigh = bar.h >= highestHigh;

// volume climax vs recent average (if volume data present)
var avgVol = 0, volCount = 0;
for (var j = i - 10; j < i; j++) {
  if (j >= 0 && bars[j].v != null) { avgVol += bars[j].v; volCount++; }
}
var volOk = true;
if (volCount > 0 && bar.v != null) {
  avgVol = avgVol / volCount;
  volOk = avgVol === 0 ? true : bar.v > avgVol * 1.05;
}

if (dev < -2.5 && s.rsi < 25 && rsiRising && bullishReversal && rangeOk && nonTrending && isSwingLow && volOk) {
  return { side: "long", note: "Price stretched more than 2.5 ATR below SMA20 in a non-trending market (ADX<20), RSI deeply oversold but turning up, bar's low is the swing low of the last 5 bars (true capitulation) with a strong bullish reversal candle closing near its high on elevated volume - fading back toward the mean" };
}
if (dev > 2.5 && s.rsi > 75 && rsiFalling && bearishReversal && rangeOk && nonTrending && isSwingHigh && volOk) {
  return { side: "short", note: "Price stretched more than 2.5 ATR above SMA20 in a non-trending market (ADX<20), RSI deeply overbought but turning down, bar's high is the swing high of the last 5 bars (true climax) with a strong bearish reversal candle closing near its low on elevated volume - fading back toward the mean" };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 0 trades, 0.0% win rate, profit factor n/a, total P/L $0.00, Sharpe n/a.

## Live status

Rejected after review - not live. From research run #58.
