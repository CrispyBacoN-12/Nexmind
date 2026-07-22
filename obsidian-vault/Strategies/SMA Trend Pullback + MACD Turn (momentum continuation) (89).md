---
type: strategy
key: research-89
status: rejected
symbol: "GBPUSD=X"
timeframe: "1h"
tags: [strategy, research, sma, rsi, adx, macd]
---

# SMA Trend Pullback + MACD Turn (momentum continuation)

Entry signal for GBPUSD=X (forex major, high liquidity, distinct macro drivers from EURUSD) swing trading on 1h bars, tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, win rate >50% with profit stable across both halves of a 1-year sample. Every forex strategy tried in this project so far (Liquidity Sweep, Bollinger%B+Stochastic fade) has been a range/mean-reversion mechanism, all marginal or failed on gold/EURUSD. Design a trend-following or breakout concept instead - e.g. a pullback-in-trend or momentum-continuation entry using SMA/ADX/MACD - a genuinely different signal family for this asset class.

## Logic

```js
const n = bars.length;
if (n < 55) return null;
const i = n - 1;
const s = snaps[i];
const p1 = snaps[i - 1];
if (!s || !p1) return null;
if (s.sma20 == null || s.sma50 == null || s.adx == null || s.macdHist == null || s.rsi == null || p1.macdHist == null || p1.adx == null) return null;
const bar = bars[i];

const trendGap = (s.sma20 - s.sma50) / s.sma50;
const trendUp = trendGap > 0.0015;
const trendDown = trendGap < -0.0015;

const adxOk = s.adx > 18 && s.adx >= p1.adx - 1;

const nearSma20Long = bar.l <= s.sma20 * 1.003 && bar.c > s.sma20 && bar.c <= s.sma20 * 1.02;
const nearSma20Short = bar.h >= s.sma20 * 0.997 && bar.c < s.sma20 && bar.c >= s.sma20 * 0.98;

const macdImprovingUp = s.macdHist > p1.macdHist;
const macdImprovingDown = s.macdHist < p1.macdHist;

const rsiOkLong = s.rsi > 35 && s.rsi < 70;
const rsiOkShort = s.rsi > 30 && s.rsi < 65;

if (trendUp && adxOk && nearSma20Long && macdImprovingUp && rsiOkLong) {
  return { side: "long", note: "Pullback to SMA20 in uptrend, ADX>18 not falling, MACD hist improving, RSI mid-range" };
}
if (trendDown && adxOk && nearSma20Short && macdImprovingDown && rsiOkShort) {
  return { side: "short", note: "Pullback to SMA20 in downtrend, ADX>18 not falling, MACD hist deteriorating, RSI mid-range" };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 183 trades, 53.6% win rate, profit factor 0.77, total P/L $-0.00, Sharpe -2.66.

## Live status

Rejected after review - not live. From research run #60.
