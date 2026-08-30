---
type: strategy
key: research-216
status: rejected
symbol: "SP500-PANEL"
timeframe: "1d"
tags: [strategy, research, sma, rsi, adx, di, macd, atr]
---

# MACD Momentum Continuation

Momentum/breakout entry signal for US equities swing trading, risk 1% per trade, exit geometry swept separately, edge that holds across the whole cross-section (many names contributing, not one) and across both halves of the sample.

## Logic

```js
const n = bars.length;
if (n < 5) return null;
const s = snaps[n-1];
const s1 = snaps[n-2];
const s2 = snaps[n-3];
const s3 = snaps[n-4];
if (!s || !s1 || !s2 || !s3) return null;
if (s.adx == null || s1.adx == null || s2.adx == null || s.plusDI == null || s.minusDI == null || s.macdHist == null || s1.macdHist == null || s2.macdHist == null || s3.macdHist == null || s.sma20 == null || s1.sma20 == null || s.sma50 == null || s.price == null || s.rsi == null || s.atr == null || s.atr <= 0) return null;

const trendUp = s.sma20 > s.sma50 && s.price > s.sma20 && s.sma20 > s1.sma20;
const trendDown = s.sma20 < s.sma50 && s.price < s.sma20 && s.sma20 < s1.sma20;
const strengthening = s.adx > 25 && s.adx < 55 && s.adx > s1.adx;
const diSpreadUp = s.plusDI - s.minusDI > 5;
const diSpreadDown = s.minusDI - s.plusDI > 5;
const macdCrossUp = s1.macdHist <= 0 && s.macdHist > 0;
const macdCrossDown = s1.macdHist >= 0 && s.macdHist < 0;
const wasBelowStreak = s1.macdHist <= 0 && s2.macdHist <= 0 && s3.macdHist <= 0;
const wasAboveStreak = s1.macdHist >= 0 && s2.macdHist >= 0 && s3.macdHist >= 0;
const macdMagnitudeUp = s.macdHist > 0.1 * s.atr;
const macdMagnitudeDown = -s.macdHist > 0.1 * s.atr;
const notExtendedUp = (s.price - s.sma20) <= 2 * s.atr;
const notExtendedDown = (s.sma20 - s.price) <= 2 * s.atr;

if (strengthening && trendUp && diSpreadUp && macdCrossUp && macdMagnitudeUp && wasBelowStreak && notExtendedUp && s.rsi > 50 && s.rsi < 65) {
  return { side: "long", note: "MACD hist crossed positive with sufficient magnitude after 3-bar streak below zero, ADX 25-55 and rising, sma20 rising with price>sma20>sma50, DI spread>5, RSI 50-65, not extended >2 ATR from sma20" };
}
if (strengthening && trendDown && diSpreadDown && macdCrossDown && macdMagnitudeDown && wasAboveStreak && notExtendedDown && s.rsi < 50 && s.rsi > 35) {
  return { side: "short", note: "MACD hist crossed negative with sufficient magnitude after 3-bar streak above zero, ADX 25-55 and rising, sma20 falling with price<sma20<sma50, DI spread>5, RSI 35-50, not extended >2 ATR from sma20" };
}
return null;
```

## Backtest history

- Research pipeline backtest (fit:2016-2018, 1d): 3 trades, 100.0% win rate, profit factor n/a, total P/L $0.50, Sharpe 36.63.

## Live status

Rejected after review - not live. From research run #112.
