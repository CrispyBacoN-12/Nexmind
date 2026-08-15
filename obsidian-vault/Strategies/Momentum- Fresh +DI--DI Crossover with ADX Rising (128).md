---
type: strategy
key: research-128
status: rejected
symbol: "CL=F"
timeframe: "1h"
tags: [strategy, research, sma, adx, di, macd]
---

# Momentum: Fresh +DI/-DI Crossover with ADX Rising

Fresh +DI/-DI crossover trend-continuation entry signal for crude oil (CL=F, 1h/1y): a mechanism never tested in this project - DI-Dominance Widening was tried on gold/silver but required an already-established widening gap with no fresh crossover requirement; this tests the classic fresh +DI/-DI crossover with ADX rising confirmation instead. Also a fresh symbol (energy commodity, only gold/silver metals tested so far in commodities). Tight single-target ladder (SL=1.5x ATR, TP=1.2x ATR), risk 1% per trade, target win rate >50%, adequate trade count across both halves of the sample.

## Logic

```js
const n = bars.length;
if (n < 3) return null;
const i = n - 1;
const prev = snaps[i - 1];
const cur = snaps[i];
if (!prev || !cur) return null;
if (cur.plusDI == null || cur.minusDI == null || prev.plusDI == null || prev.minusDI == null) return null;
if (cur.adx == null || prev.adx == null) return null;
if (cur.sma20 == null || cur.sma50 == null || cur.macdHist == null || prev.macdHist == null) return null;

const adxMin = 18;
const adxRising = cur.adx > prev.adx;
const diSpread = Math.abs(cur.plusDI - cur.minusDI);
const minSpread = 2;

const bullCross = prev.plusDI <= prev.minusDI && cur.plusDI > cur.minusDI;
const bearCross = prev.minusDI <= prev.plusDI && cur.minusDI > cur.plusDI;

const trendUp = cur.sma20 > cur.sma50;
const trendDown = cur.sma20 < cur.sma50;

const macdBullOk = cur.macdHist > 0 || cur.macdHist > prev.macdHist;
const macdBearOk = cur.macdHist < 0 || cur.macdHist < prev.macdHist;

if (bullCross && cur.adx >= adxMin && adxRising && diSpread >= minSpread && trendUp && macdBullOk) {
  return { side: "long", note: "Bullish DI cross, ADX " + cur.adx.toFixed(1) + " rising, trend up, MACD hist " + cur.macdHist.toFixed(3) + " supportive (spread " + diSpread.toFixed(1) + ")" };
}

if (bearCross && cur.adx >= adxMin && adxRising && diSpread >= minSpread && trendDown && macdBearOk) {
  return { side: "short", note: "Bearish DI cross, ADX " + cur.adx.toFixed(1) + " rising, trend down, MACD hist " + cur.macdHist.toFixed(3) + " supportive (spread " + diSpread.toFixed(1) + ")" };
}

return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 7 trades, 57.1% win rate, profit factor 1.21, total P/L $0.05, Sharpe 1.32.

## Live status

Rejected after review - not live. From research run #74.
