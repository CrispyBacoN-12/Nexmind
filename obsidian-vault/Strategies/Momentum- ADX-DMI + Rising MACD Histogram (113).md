---
type: strategy
key: research-113
status: rejected
symbol: "BTC-USD"
timeframe: "1h"
tags: [strategy, research, sma, rsi, adx, di, macd, atr]
---

# Momentum: ADX/DMI + Rising MACD Histogram

Momentum/breakout entry signal for BTC-USD swing trading, tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, win rate >50% with profit stable across both halves of the sample (not just a good average).

## Logic

```js
var n = bars.length;
if (n < 6) return null;
var s = snaps[n-1];
var s1 = snaps[n-2];
var s2 = snaps[n-3];
if (!s || !s1 || !s2) return null;
if (s.adx == null || s.plusDI == null || s.minusDI == null || s.macdHist == null || s.sma20 == null || s.sma50 == null || s.rsi == null || s.atr == null) return null;
if (s1.macdHist == null || s2.macdHist == null || s1.adx == null) return null;
var price = bars[n-1].c;
if (price <= 0) return null;
var macdRising = s.macdHist > s1.macdHist && s1.macdHist > s2.macdHist;
var macdFalling = s.macdHist < s1.macdHist && s1.macdHist < s2.macdHist;
var freshCrossUp = (s1.macdHist <= 0 && s.macdHist > 0) || (s2.macdHist <= 0 && s1.macdHist > 0);
var freshCrossDown = (s1.macdHist >= 0 && s.macdHist < 0) || (s2.macdHist >= 0 && s1.macdHist < 0);
var adxRising = s.adx > s1.adx;
var diSpreadLong = s.plusDI - s.minusDI;
var diSpreadShort = s.minusDI - s.plusDI;
var volOk = (s.atr / price) > 0.0018;
var extendedLong = price > s.sma20 * 1.03;
var extendedShort = price < s.sma20 * 0.97;
if (s.adx > 23 && s.adx < 45 && adxRising && diSpreadLong > 3 && s.macdHist > 0 && macdRising && freshCrossUp && !extendedLong && price > s.sma20 && s.sma20 > s.sma50 && s.rsi > 53 && s.rsi < 66 && volOk) {
  return { side: "long", note: "momentum: ADX " + s.adx.toFixed(1) + " rising, DI spread " + diSpreadLong.toFixed(1) + ", fresh MACD hist cross rising, price>sma20>sma50, RSI " + s.rsi.toFixed(1) };
}
if (s.adx > 23 && s.adx < 45 && adxRising && diSpreadShort > 3 && s.macdHist < 0 && macdFalling && freshCrossDown && !extendedShort && price < s.sma20 && s.sma20 < s.sma50 && s.rsi < 47 && s.rsi > 34 && volOk) {
  return { side: "short", note: "momentum: ADX " + s.adx.toFixed(1) + " rising, DI spread " + diSpreadShort.toFixed(1) + ", fresh MACD hist cross falling, price<sma20<sma50, RSI " + s.rsi.toFixed(1) };
}
return null;
```

## Backtest history

- Research pipeline backtest (3mo, 1h): 15 trades, 66.7% win rate, profit factor 1.87, total P/L $269.30, Sharpe 5.87.

## Live status

Rejected after review - not live. From research run #69.
