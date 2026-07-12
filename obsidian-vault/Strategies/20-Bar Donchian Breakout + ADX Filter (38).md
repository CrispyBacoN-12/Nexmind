---
type: strategy
key: research-38
status: proposed
symbol: "BTC-USD"
timeframe: "1h"
tags: [strategy, research, rsi, adx, di, macd, atr, donchian]
---

# 20-Bar Donchian Breakout + ADX Filter

test cost/slippage modeling display verification

## Logic

```js
const i = bars.length - 1;
const s = snaps[i];
if (!s || s.adx == null || s.atr == null || s.plusDI == null || s.minusDI == null || s.rsi == null || s.macdHist == null) return null;
const lookback = 20;
if (i < lookback + 3) return null;
let highestHigh = -Infinity;
let lowestLow = Infinity;
for (let j = i - lookback; j < i; j++) {
  if (bars[j].h > highestHigh) highestHigh = bars[j].h;
  if (bars[j].l < lowestLow) lowestLow = bars[j].l;
}
const close = bars[i].c;
const prevClose = bars[i - 1].c;
const avgVol3 = (bars[i - 1].v + bars[i - 2].v + bars[i - 3].v) / 3;
const volSurge = avgVol3 > 0 && bars[i].v > avgVol3 * 1.5;
const adxStrong = s.adx > 28;
if (prevClose <= highestHigh && close > highestHigh && adxStrong && volSurge && s.plusDI > s.minusDI && s.rsi > 50 && s.macdHist > 0) {
  return { side: 'long', note: '20-bar high breakout, ADX ' + Math.round(s.adx) + ', +DI ' + Math.round(s.plusDI) + ', RSI ' + Math.round(s.rsi) };
}
if (prevClose >= lowestLow && close < lowestLow && adxStrong && volSurge && s.minusDI > s.plusDI && s.rsi < 50 && s.macdHist < 0) {
  return { side: 'short', note: '20-bar low breakdown, ADX ' + Math.round(s.adx) + ', -DI ' + Math.round(s.minusDI) + ', RSI ' + Math.round(s.rsi) };
}
return null;
```

## Backtest history

- Research pipeline backtest (3mo, 1h): 35 trades, 51.4% win rate, profit factor 0.53, total P/L $-598.52, Sharpe -7.98.

## Live status

Proposed candidate, not yet reviewed. From research run #17.
