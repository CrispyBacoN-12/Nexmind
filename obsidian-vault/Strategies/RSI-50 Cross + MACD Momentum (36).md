---
type: strategy
key: research-36
status: rejected
symbol: "BTC-USD"
timeframe: "1h"
tags: [strategy, research, sma, rsi, adx, di, macd, atr]
---

# RSI-50 Cross + MACD Momentum

test cost/slippage modeling display verification

## Logic

```js
const i = bars.length - 1;
const s = snaps[i];
const sp = snaps[i - 1];
const sp2 = snaps[i - 2];
if (!s || !sp || !sp2 || s.rsi == null || sp.rsi == null || sp2.rsi == null ||
    s.macdHist == null || sp.macdHist == null || sp2.macdHist == null ||
    s.adx == null || s.sma20 == null || s.sma50 == null ||
    s.plusDI == null || s.minusDI == null || s.atr == null) return null;

const rsiCrossUp = sp.rsi < 50 && s.rsi >= 50;
const rsiCrossDown = sp.rsi > 50 && s.rsi <= 50;

// RSI must move convincingly on the cross bar — filters barely-grazing crosses that reverse
const rsiMomentumLong = s.rsi - sp.rsi >= 2;
const rsiMomentumShort = sp.rsi - s.rsi >= 2;

const strongTrend = s.adx > 25;

// Require 2 consecutive bars of MACD acceleration — eliminates one-bar momentum flickers
const macdAccelLong = s.macdHist > 0 && s.macdHist > sp.macdHist && sp.macdHist > sp2.macdHist;
const macdAccelShort = s.macdHist < 0 && s.macdHist < sp.macdHist && sp.macdHist < sp2.macdHist;

// Price above both SMAs: dual trend confirmation, not just the slow one
const priceAboveBothSmas = bars[i].c > s.sma50 && bars[i].c > s.sma20;
const priceBelowBothSmas = bars[i].c < s.sma50 && bars[i].c < s.sma20;

// DI must clearly dominate, not just edge out — reduces entries in noisy crossover zones
const diLong = s.plusDI > s.minusDI + 3;
const diShort = s.minusDI > s.plusDI + 3;

// Require meaningful ATR relative to price — dead markets can't cover transaction costs
const atrPct = s.atr / bars[i].c;
const sufficientVolatility = atrPct > 0.005;

if (rsiCrossUp && rsiMomentumLong && macdAccelLong && strongTrend && priceAboveBothSmas && diLong && sufficientVolatility) {
  return { side: 'long', note: 'RSI cross 50 up (' + Math.round(s.rsi) + '), MACD 2-bar accel, ADX ' + Math.round(s.adx) + ', +DI edge ' + Math.round(s.plusDI - s.minusDI) };
}
if (rsiCrossDown && rsiMomentumShort && macdAccelShort && strongTrend && priceBelowBothSmas && diShort && sufficientVolatility) {
  return { side: 'short', note: 'RSI cross 50 down (' + Math.round(s.rsi) + '), MACD 2-bar accel, ADX ' + Math.round(s.adx) + ', -DI edge ' + Math.round(s.minusDI - s.plusDI) };
}
return null;
```

## Backtest history

- Research pipeline backtest (3mo, 1h): 5 trades, 80.0% win rate, profit factor 1.88, total P/L $70.88, Sharpe 4.72.

## Live status

Rejected after review - not live. From research run #17.
