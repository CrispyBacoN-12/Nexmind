---
type: strategy
key: research-214
status: rejected
symbol: "AAPL"
timeframe: "1d"
tags: [strategy, research, sma, rsi, adx, atr]
---

# RSI extreme reversion in a ranging regime

Mean-reversion entry signal for US equities swing trading, tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, win rate >50% with profit stable across both halves of the sample (not just a good average).

## Logic

```js
const n = bars.length;
if (n < 4) return null;
const i = n - 1;
const cur = snaps[i];
const prev = snaps[i - 1];
const bar = bars[i];
const prevBar = bars[i - 1];
if (!cur || !prev) return null;
if (cur.rsi == null || prev.rsi == null || cur.sma20 == null || prev.sma20 == null || cur.atr == null || prev.atr == null || cur.adx == null) return null;
if (cur.atr <= 0 || prev.atr <= 0) return null;

const stretch = (bar.c - cur.sma20) / cur.atr;
const prevStretch = (prevBar.c - prev.sma20) / prev.atr;
const rangebound = cur.adx < 25 && cur.adx > 10;
const range = bar.h - bar.l;
if (range <= 0) return null;
const closePos = (bar.c - bar.l) / range;

const priceTurningUp = bar.c > prevBar.c;
const priceTurningDown = bar.c < prevBar.c;
const momentumTurningUp = cur.rsi > prev.rsi;
const momentumTurningDown = cur.rsi < prev.rsi;

if (rangebound && cur.rsi < 35 && stretch < -1.0 && prevStretch < -0.8 && priceTurningUp && momentumTurningUp && closePos > 0.5) {
  return { side: "long", note: "RSI<35 turning up, price >1.0 ATR below sma20 and was already >0.8 ATR below on prior bar (sustained extension not a single spike), ADX 10-25 ranging, bar closed in upper half of its range" };
}
if (rangebound && cur.rsi > 65 && stretch > 1.0 && prevStretch > 0.8 && priceTurningDown && momentumTurningDown && closePos < 0.5) {
  return { side: "short", note: "RSI>65 turning down, price >1.0 ATR above sma20 and was already >0.8 ATR above on prior bar (sustained extension not a single spike), ADX 10-25 ranging, bar closed in lower half of its range" };
}
return null;
```

## Backtest history

- Research pipeline backtest (2y, 1d): 4 trades, 50.0% win rate, profit factor 8.61, total P/L $7.54, Sharpe 7.87.

## Live status

Rejected after review - not live. From research run #110.
