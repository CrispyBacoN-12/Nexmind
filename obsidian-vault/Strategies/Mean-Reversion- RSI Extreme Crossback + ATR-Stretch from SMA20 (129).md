---
type: strategy
key: research-129
status: rejected
symbol: "CL=F"
timeframe: "1h"
tags: [strategy, research, sma, rsi, adx, macd, atr]
---

# Mean-Reversion: RSI Extreme Crossback + ATR-Stretch from SMA20

Fresh +DI/-DI crossover trend-continuation entry signal for crude oil (CL=F, 1h/1y): a mechanism never tested in this project - DI-Dominance Widening was tried on gold/silver but required an already-established widening gap with no fresh crossover requirement; this tests the classic fresh +DI/-DI crossover with ADX rising confirmation instead. Also a fresh symbol (energy commodity, only gold/silver metals tested so far in commodities). Tight single-target ladder (SL=1.5x ATR, TP=1.2x ATR), risk 1% per trade, target win rate >50%, adequate trade count across both halves of the sample.

## Logic

```js
const n = bars.length;
if (n < 3) return null;
const i = n - 1;
const prev = snaps[i - 1];
const prev2 = snaps[i - 2];
const cur = snaps[i];
if (!prev || !prev2 || !cur) return null;
if (cur.rsi == null || prev.rsi == null || prev2.rsi == null || cur.sma20 == null || cur.atr == null || cur.atr === 0) return null;
if (cur.adx == null || cur.macdHist == null || prev.macdHist == null) return null;

const price = bars[i].c;
const open = bars[i].o;
const stretch = (price - cur.sma20) / cur.atr;

const oversoldLevel = 22;
const overboughtLevel = 78;
const stretchThreshold = 2.0;
const maxStretch = 3.5;
const adxCeiling = 30;
const minMacdDelta = cur.atr * 0.02;

const absStretch = Math.abs(stretch);
const rangeOk = absStretch >= stretchThreshold && absStretch <= maxStretch;
const trendOk = cur.adx < adxCeiling;

if (!rangeOk || !trendOk) return null;

if (prev.rsi <= oversoldLevel && cur.rsi > oversoldLevel && stretch <= -stretchThreshold) {
  const macdDelta = cur.macdHist - prev.macdHist;
  const momentumTurning = macdDelta > minMacdDelta;
  const bullishClose = price > open;
  const wasStillOversold = prev2.rsi <= oversoldLevel + 3;
  if (momentumTurning && bullishClose && wasStillOversold) {
    return { side: "long", note: "RSI crossback above " + oversoldLevel + " (" + cur.rsi.toFixed(1) + "), price " + absStretch.toFixed(2) + "x ATR below SMA20, ADX " + cur.adx.toFixed(1) + ", MACD hist turning up (+" + macdDelta.toFixed(4) + "), bullish close confirmation" };
  }
}

if (prev.rsi >= overboughtLevel && cur.rsi < overboughtLevel && stretch >= stretchThreshold) {
  const macdDelta = prev.macdHist - cur.macdHist;
  const momentumTurning = macdDelta > minMacdDelta;
  const bearishClose = price < open;
  const wasStillOverbought = prev2.rsi >= overboughtLevel - 3;
  if (momentumTurning && bearishClose && wasStillOverbought) {
    return { side: "short", note: "RSI crossback below " + overboughtLevel + " (" + cur.rsi.toFixed(1) + "), price " + stretch.toFixed(2) + "x ATR above SMA20, ADX " + cur.adx.toFixed(1) + ", MACD hist turning down (-" + macdDelta.toFixed(4) + "), bearish close confirmation" };
  }
}

return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 2 trades, 50.0% win rate, profit factor 1.23, total P/L $0.01, Sharpe 1.65.

## Live status

Rejected after review - not live. From research run #74.
