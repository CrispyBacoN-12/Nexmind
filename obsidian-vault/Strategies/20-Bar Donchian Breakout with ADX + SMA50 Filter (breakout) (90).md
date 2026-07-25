---
type: strategy
key: research-90
status: rejected
symbol: "GBPUSD=X"
timeframe: "1h"
tags: [strategy, research, sma, rsi, adx, di, macd, atr, donchian]
---

# 20-Bar Donchian Breakout with ADX + SMA50 Filter (breakout)

Entry signal for GBPUSD=X (forex major, high liquidity, distinct macro drivers from EURUSD) swing trading on 1h bars, tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, win rate >50% with profit stable across both halves of a 1-year sample. Every forex strategy tried in this project so far (Liquidity Sweep, Bollinger%B+Stochastic fade) has been a range/mean-reversion mechanism, all marginal or failed on gold/EURUSD. Design a trend-following or breakout concept instead - e.g. a pullback-in-trend or momentum-continuation entry using SMA/ADX/MACD - a genuinely different signal family for this asset class.

## Logic

```js
const n = bars.length;
const lookback = 20;
const adxTrendLookback = 3;
if (n < lookback + adxTrendLookback + 2) return null;
const i = n - 1;
const s = snaps[i];
if (!s || s.adx == null || s.sma50 == null || s.sma20 == null || s.atr == null || s.plusDI == null || s.minusDI == null || s.macdHist == null || s.rsi == null) return null;

const sPrevAdx = snaps[i - adxTrendLookback];
const sPrevMacd = snaps[i - 1];
if (!sPrevAdx || sPrevAdx.adx == null || !sPrevMacd || sPrevMacd.macdHist == null) return null;

let highestHigh = -Infinity;
let lowestLow = Infinity;
for (let j = i - lookback; j < i; j++) {
  const b = bars[j];
  if (b.h > highestHigh) highestHigh = b.h;
  if (b.l < lowestLow) lowestLow = b.l;
}

const bar = bars[i];
const prevBar = bars[i - 1];
const range = bar.h - bar.l;

const adxOk = s.adx > 25;
const adxRising = s.adx > sPrevAdx.adx;
const margin = 0.4 * s.atr;
const maxExtension = 1.5 * s.atr;
const diSpread = Math.abs(s.plusDI - s.minusDI) > 3;

const longBreakout = bar.c > highestHigh + margin && bar.c < highestHigh + margin + maxExtension && bar.c > prevBar.c;
const longStrongClose = range > 0 && (bar.c - bar.l) / range > 0.6;
const longTrend = s.sma20 > s.sma50 && bar.c > s.sma50;
const longDI = s.plusDI > s.minusDI && diSpread;
const longMomentum = s.macdHist > 0 && s.macdHist > sPrevMacd.macdHist;
const longRsiOk = s.rsi > 50 && s.rsi < 70;

if (adxOk && adxRising && longBreakout && longStrongClose && longTrend && longDI && longMomentum && longRsiOk) {
  return { side: "long", note: "Confirmed break above 20-bar high + ATR margin (capped extension), strong close, rising ADX>25, SMA20>SMA50, DI spread>3, MACD hist rising>0, RSI 50-70" };
}

const shortBreakout = bar.c < lowestLow - margin && bar.c > lowestLow - margin - maxExtension && bar.c < prevBar.c;
const shortStrongClose = range > 0 && (bar.h - bar.c) / range > 0.6;
const shortTrend = s.sma20 < s.sma50 && bar.c < s.sma50;
const shortDI = s.minusDI > s.plusDI && diSpread;
const shortMomentum = s.macdHist < 0 && s.macdHist < sPrevMacd.macdHist;
const shortRsiOk = s.rsi < 50 && s.rsi > 30;

if (adxOk && adxRising && shortBreakout && shortStrongClose && shortTrend && shortDI && shortMomentum && shortRsiOk) {
  return { side: "short", note: "Confirmed break below 20-bar low - ATR margin (capped extension), strong close, rising ADX>25, SMA20<SMA50, DI spread>3, MACD hist falling<0, RSI 30-50" };
}

return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 11 trades, 36.4% win rate, profit factor 0.38, total P/L $-0.00, Sharpe -7.52.

## Live status

Rejected after review - not live. From research run #60.
