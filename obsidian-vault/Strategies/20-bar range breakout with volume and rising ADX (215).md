---
type: strategy
key: research-215
status: rejected
symbol: "AAPL"
timeframe: "1d"
tags: [strategy, research, sma, adx, di, atr]
---

# 20-bar range breakout with volume and rising ADX

Mean-reversion entry signal for US equities swing trading, tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, win rate >50% with profit stable across both halves of the sample (not just a good average).

## Logic

```js
const n = bars.length;
const LOOKBACK = 20;
if (n < LOOKBACK + 3) return null;
const i = n - 1;
const cur = snaps[i];
const prev = snaps[i - 1];
const prev2 = snaps[i - 2];
const bar = bars[i];
if (!cur || !prev || !prev2) return null;
if (cur.adx == null || prev.adx == null || prev2.adx == null || cur.atr == null) return null;
if (cur.plusDI == null || cur.minusDI == null) return null;
if (cur.sma20 == null || cur.sma50 == null) return null;

let hh = -Infinity;
let ll = Infinity;
let volSum = 0;
for (let k = i - LOOKBACK; k < i; k++) {
  const b = bars[k];
  if (b.h > hh) hh = b.h;
  if (b.l < ll) ll = b.l;
  volSum += b.v;
}
const avgVol = volSum / LOOKBACK;
const volConfirm = avgVol > 0 && bar.v > avgVol * 1.4;
const adxRising = cur.adx > prev.adx && prev.adx >= prev2.adx && cur.adx > 23;
const buffer = cur.atr * 0.2;
const trendUp = cur.sma20 > cur.sma50;
const trendDown = cur.sma20 < cur.sma50;

if (bar.c > hh + buffer && volConfirm && adxRising && cur.plusDI > cur.minusDI && trendUp) {
  return { side: "long", note: "Close broke above 20-bar high + 0.2 ATR buffer on volume>1.4x avg, ADX rising 2 bars>23, +DI>-DI, sma20>sma50" };
}
if (bar.c < ll - buffer && volConfirm && adxRising && cur.minusDI > cur.plusDI && trendDown) {
  return { side: "short", note: "Close broke below 20-bar low - 0.2 ATR buffer on volume>1.4x avg, ADX rising 2 bars>23, -DI>+DI, sma20<sma50" };
}
return null;
```

## Backtest history

- Research pipeline backtest (2y, 1d): 5 trades, 60.0% win rate, profit factor 9.17, total P/L $10.87, Sharpe 7.04.

## Live status

Rejected after review - not live. From research run #110.
