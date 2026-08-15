---
type: strategy
key: research-130
status: rejected
symbol: "CL=F"
timeframe: "1h"
tags: [strategy, research, sma, adx, di, atr]
---

# Breakout: 20-Bar Range Break with Volume + ADX Confirmation

Fresh +DI/-DI crossover trend-continuation entry signal for crude oil (CL=F, 1h/1y): a mechanism never tested in this project - DI-Dominance Widening was tried on gold/silver but required an already-established widening gap with no fresh crossover requirement; this tests the classic fresh +DI/-DI crossover with ADX rising confirmation instead. Also a fresh symbol (energy commodity, only gold/silver metals tested so far in commodities). Tight single-target ladder (SL=1.5x ATR, TP=1.2x ATR), risk 1% per trade, target win rate >50%, adequate trade count across both halves of the sample.

## Logic

```js
const n = bars.length;
const lookback = 20;
if (n < lookback + 4) return null;
const i = n - 1;
const cur = snaps[i];
const prev = snaps[i - 1];
if (!cur || !prev) return null;
if (cur.adx == null || cur.atr == null || cur.plusDI == null || cur.minusDI == null || cur.sma20 == null || cur.sma50 == null || prev.adx == null) return null;

let highestHigh = -Infinity;
let lowestLow = Infinity;
let volSum = 0;
for (let k = i - lookback; k < i; k++) {
  const b = bars[k];
  if (b.h > highestHigh) highestHigh = b.h;
  if (b.l < lowestLow) lowestLow = b.l;
  volSum += b.v;
}
const avgVol = volSum / lookback;
const curBar = bars[i];
const prevBar = bars[i - 1];
if (curBar.v == null || avgVol === 0) return null;

const barRange = curBar.h - curBar.l;
if (barRange <= 0) return null;

const volConfirmed = curBar.v > avgVol * 1.5;
const adxMin = 27;
const adxRising = cur.adx > prev.adx;
const buffer = cur.atr * 0.25;
const maxExtension = cur.atr * 2.5;
const closePos = (curBar.c - curBar.l) / barRange;
const diSpreadLong = cur.plusDI - cur.minusDI;
const diSpreadShort = cur.minusDI - cur.plusDI;

// only take the bar that FIRST clears the range - avoids chasing an already-extended move
const freshLong = prevBar.c <= highestHigh;
const freshShort = prevBar.c >= lowestLow;

const longSetup = curBar.c > highestHigh + buffer
  && curBar.c <= highestHigh + maxExtension
  && volConfirmed
  && cur.adx >= adxMin
  && adxRising
  && diSpreadLong > 5
  && curBar.c > cur.sma20
  && cur.sma20 > cur.sma50
  && closePos >= 0.65
  && freshLong;

const shortSetup = curBar.c < lowestLow - buffer
  && curBar.c >= lowestLow - maxExtension
  && volConfirmed
  && cur.adx >= adxMin
  && adxRising
  && diSpreadShort > 5
  && curBar.c < cur.sma20
  && cur.sma20 < cur.sma50
  && closePos <= 0.35
  && freshShort;

if (longSetup) {
  return { side: "long", note: "Fresh breakout above " + lookback + "-bar high (" + highestHigh.toFixed(2) + "), buffered+capped extension, vol " + (curBar.v / avgVol).toFixed(2) + "x avg, ADX " + cur.adx.toFixed(1) + " rising, DI spread " + diSpreadLong.toFixed(1) + ", SMA20>SMA50, strong close" };
}

if (shortSetup) {
  return { side: "short", note: "Fresh breakdown below " + lookback + "-bar low (" + lowestLow.toFixed(2) + "), buffered+capped extension, vol " + (curBar.v / avgVol).toFixed(2) + "x avg, ADX " + cur.adx.toFixed(1) + " rising, DI spread " + diSpreadShort.toFixed(1) + ", SMA20<SMA50, weak close" };
}

return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 63 trades, 52.4% win rate, profit factor 0.89, total P/L $-0.35, Sharpe -1.10.

## Live status

Rejected after review - not live. From research run #74.
