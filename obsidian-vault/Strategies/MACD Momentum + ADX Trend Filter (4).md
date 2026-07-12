---
type: strategy
key: research-4
status: proposed
symbol: "BTC-USD"
timeframe: "1h"
tags: [strategy, research, sma, rsi, adx, di, macd]
---

# MACD Momentum + ADX Trend Filter

a mean-reversion strategy that only trades during low-ADX chop

## Logic

```js
const i = bars.length - 1;
if (i < 3) return null;
const s = snaps[i], p = snaps[i - 1], pp = snaps[i - 2], ppp = snaps[i - 3];
if (!s || !p || !pp || !ppp) return null;
if (s.macdHist === null || p.macdHist === null || pp.macdHist === null || ppp.macdHist === null) return null;
if (s.adx === null || p.adx === null || s.plusDI === null || s.minusDI === null) return null;
if (s.sma50 === null || s.rsi === null) return null;

// Stronger trend + must be gaining strength on entry bar
if (s.adx < 28 || s.adx < p.adx) return null;

const bar = bars[i];

// Three consecutive wrong-side bars before cross (tighter whipsaw filter)
// Cross bar must be strictly positive/negative (not just >= 0)
// Entry candle must close in the signal direction (body confirmation)
const bullCross = ppp.macdHist < 0 && pp.macdHist < 0 && p.macdHist < 0 && s.macdHist > 0
  && s.plusDI > s.minusDI
  && bar.c > s.sma50
  && s.rsi >= 40 && s.rsi <= 65
  && bar.c > bar.o;

const bearCross = ppp.macdHist > 0 && pp.macdHist > 0 && p.macdHist > 0 && s.macdHist < 0
  && s.minusDI > s.plusDI
  && bar.c < s.sma50
  && s.rsi >= 35 && s.rsi <= 60
  && bar.c < bar.o;

if (bullCross) return { side: "long", note: "MACD bull cross (3-bar), ADX=" + s.adx.toFixed(1) + " RSI=" + s.rsi.toFixed(1) + " >SMA50" };
if (bearCross) return { side: "short", note: "MACD bear cross (3-bar), ADX=" + s.adx.toFixed(1) + " RSI=" + s.rsi.toFixed(1) + " <SMA50" };
return null;
```

## Backtest history

- Research pipeline backtest (3mo, 1h): 1 trades, 0.0% win rate, profit factor n/a, total P/L $-57.03, Sharpe n/a.

## Live status

Proposed candidate, not yet reviewed. From research run #2.
