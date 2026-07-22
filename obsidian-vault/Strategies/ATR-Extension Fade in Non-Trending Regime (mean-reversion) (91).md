---
type: strategy
key: research-91
status: rejected
symbol: "GBPUSD=X"
timeframe: "1h"
tags: [strategy, research, sma, rsi, adx, atr]
---

# ATR-Extension Fade in Non-Trending Regime (mean-reversion)

Entry signal for GBPUSD=X (forex major, high liquidity, distinct macro drivers from EURUSD) swing trading on 1h bars, tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, win rate >50% with profit stable across both halves of a 1-year sample. Every forex strategy tried in this project so far (Liquidity Sweep, Bollinger%B+Stochastic fade) has been a range/mean-reversion mechanism, all marginal or failed on gold/EURUSD. Design a trend-following or breakout concept instead - e.g. a pullback-in-trend or momentum-continuation entry using SMA/ADX/MACD - a genuinely different signal family for this asset class.

## Logic

```js
const n = bars.length;
if (n < 25) return null;
const i = n - 1;
const s = snaps[i];
const prev = snaps[i - 1];
if (!s || !prev) return null;
if (s.sma20 == null || s.atr == null || s.atr === 0 || s.rsi == null || s.adx == null || prev.rsi == null) return null;
const bar = bars[i];
const dist = (bar.c - s.sma20) / s.atr;
const rangeRegime = s.adx < 22 && s.adx > 8;
if (!rangeRegime) return null;
const rsiTurningDown = s.rsi < prev.rsi;
const rsiTurningUp = s.rsi > prev.rsi;
const bearishCandle = bar.c < bar.o;
const bullishCandle = bar.c > bar.o;
if (dist > 1.8 && s.rsi > 68 && (rsiTurningDown || bearishCandle)) {
  return { side: "short", note: "Price extended >1.8 ATR above SMA20 with RSI>68 rolling over or closing bearish, fading the extension in a non-trending regime" };
}
if (dist < -1.8 && s.rsi < 32 && (rsiTurningUp || bullishCandle)) {
  return { side: "long", note: "Price extended >1.8 ATR below SMA20 with RSI<32 turning up or closing bullish, fading the extension in a non-trending regime" };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 11 trades, 63.6% win rate, profit factor 1.12, total P/L $0.00, Sharpe 0.89.

## Live status

Rejected after review - not live. From research run #60.
