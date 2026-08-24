---
type: strategy
key: research-213
status: rejected
symbol: "AAPL"
timeframe: "1d"
tags: [strategy, research, sma, rsi, adx, di, macd]
---

# MACD histogram cross confirmed by ADX/DI trend

Mean-reversion entry signal for US equities swing trading, tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, win rate >50% with profit stable across both halves of the sample (not just a good average).

## Logic

```js
const n = bars.length;
if (n < 5) return null;
const i = n - 1;
const cur = snaps[i];
const prev = snaps[i - 1];
const prev2 = snaps[i - 2];
if (!cur || !prev || !prev2) return null;
if (cur.sma20 == null || cur.sma50 == null || cur.macdHist == null || prev.macdHist == null || cur.adx == null || prev2.adx == null || cur.plusDI == null || cur.minusDI == null || cur.rsi == null || cur.price == null) return null;

const trendUp = cur.sma20 > cur.sma50 && cur.price > cur.sma20;
const trendDown = cur.sma20 < cur.sma50 && cur.price < cur.sma20;
const macdCrossUp = prev.macdHist <= 0 && cur.macdHist > 0;
const macdCrossDown = prev.macdHist >= 0 && cur.macdHist < 0;
const strongTrend = cur.adx > 20 && cur.adx >= prev2.adx;
const diSpreadLong = (cur.plusDI - cur.minusDI) > 3;
const diSpreadShort = (cur.minusDI - cur.plusDI) > 3;

if (trendUp && macdCrossUp && strongTrend && diSpreadLong && cur.rsi < 70 && cur.rsi > 40) {
  return { side: "long", note: "MACD hist crossed up, ADX>20 rising over 2 bars, DI spread>3, price>sma20>sma50, RSI 40-70" };
}
if (trendDown && macdCrossDown && strongTrend && diSpreadShort && cur.rsi > 30 && cur.rsi < 60) {
  return { side: "short", note: "MACD hist crossed down, ADX>20 rising over 2 bars, DI spread>3, price<sma20<sma50, RSI 30-60" };
}
return null;
```

## Backtest history

- Research pipeline backtest (2y, 1d): 4 trades, 75.0% win rate, profit factor 4.69, total P/L $2.05, Sharpe 12.98.

## Live status

Rejected after review - not live. From research run #110.
