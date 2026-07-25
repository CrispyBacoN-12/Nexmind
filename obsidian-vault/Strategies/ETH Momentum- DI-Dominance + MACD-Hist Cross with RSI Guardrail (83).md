---
type: strategy
key: research-83
status: rejected
symbol: "ETH-USD"
timeframe: "1h"
tags: [strategy, research, sma, rsi, adx, di, macd, atr]
---

# ETH Momentum: DI-Dominance + MACD-Hist Cross with RSI Guardrail

Entry signal for ETH-USD (Ethereum) swing trading, tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, win rate >50% with profit stable across both halves of a 1-year sample. Ethereum has never been tested in this project - only BTC-USD has (crypto strategies so far ported gold/BTC concepts unchanged). Design a fresh entry idea using OHLCV/indicators only, not a straight port of an existing gold or BTC strategy.

## Logic

```js
var n = bars.length;
if (n < 4) return null;
var i = n - 1;
var s = snaps[i], s1 = snaps[i - 1], s2 = snaps[i - 2];
if (!s || !s1 || !s2) return null;
if (s.adx == null || s.plusDI == null || s.minusDI == null || s.macdHist == null || s.rsi == null || s.sma20 == null || s.sma50 == null || s.atr == null || s1.macdHist == null || s1.adx == null || s1.plusDI == null || s1.minusDI == null || s2.adx == null) return null;
var price = bars[i].c;
var adxRising = s.adx > s1.adx && s1.adx > s2.adx && s.adx > 22;
var diSpread = s.plusDI - s.minusDI;
var diSpreadPrev = s1.plusDI - s1.minusDI;
var diSpreadGrowing = Math.abs(diSpread) > Math.abs(diSpreadPrev);
var macdCrossUp = s1.macdHist <= 0 && s.macdHist > 0;
var macdCrossDown = s1.macdHist >= 0 && s.macdHist < 0;
var macdStrength = Math.abs(s.macdHist - s1.macdHist);
var minMacdStrength = s.atr * 0.05;
var extension = Math.abs(price - s.sma50) / s.atr;
if (adxRising && diSpread > 4 && diSpreadGrowing && macdCrossUp && macdStrength > minMacdStrength && s.rsi > 48 && s.rsi < 65 && price > s.sma50 && s.sma20 > s.sma50 && extension < 3.5) {
  return { side: "long", note: "ADX rising for two consecutive bars above 22 with widening +DI dominance, a strong MACD histogram cross up, RSI confirming without overbought extreme, price above both SMA20 and SMA50 for double trend alignment, and not overextended from SMA50" };
}
if (adxRising && -diSpread > 4 && diSpreadGrowing && macdCrossDown && macdStrength > minMacdStrength && s.rsi < 52 && s.rsi > 35 && price < s.sma50 && s.sma20 < s.sma50 && extension < 3.5) {
  return { side: "short", note: "ADX rising for two consecutive bars above 22 with widening -DI dominance, a strong MACD histogram cross down, RSI confirming without oversold extreme, price below both SMA20 and SMA50 for double trend alignment, and not overextended from SMA50" };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 11 trades, 45.5% win rate, profit factor 0.66, total P/L $-4.98, Sharpe -2.93.

## Live status

Rejected after review - not live. From research run #58.
