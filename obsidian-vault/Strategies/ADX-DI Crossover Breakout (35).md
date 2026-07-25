---
type: strategy
key: research-35
status: rejected
symbol: "BTC-USD"
timeframe: "1h"
tags: [strategy, research, adx, di]
---

# ADX/DI Crossover Breakout

test metrics display verification

## Logic

```js
const i = bars.length - 1;
if (i < 1) return null;
const s = snaps[i];
const sp = snaps[i - 1];
if (!s.adx || !s.plusDI || !s.minusDI || !sp.plusDI || !sp.minusDI) return null;
const adxStrong = s.adx > 25;
const bullCross = sp.plusDI <= sp.minusDI && s.plusDI > s.minusDI;
const bearCross = sp.minusDI <= sp.plusDI && s.minusDI > s.plusDI;
if (adxStrong && bullCross) {
  return { side: "long", note: "+DI crossed above -DI with ADX>25 trend confirmation" };
}
if (adxStrong && bearCross) {
  return { side: "short", note: "-DI crossed above +DI with ADX>25 trend confirmation" };
}
return null;
```

## Backtest history

- Research pipeline backtest (3mo, 1h): 34 trades, 58.8% win rate, profit factor 1.17, total P/L $139.75, Sharpe 1.32.

## Live status

Rejected after review - not live. From research run #16.
