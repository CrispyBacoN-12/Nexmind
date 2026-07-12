---
type: strategy
key: research-34
status: proposed
symbol: "BTC-USD"
timeframe: "1h"
tags: [strategy, research, sma, rsi, adx]
---

# SMA20 Deviation Mean-Reversion

test metrics display verification

## Logic

```js
const i = bars.length - 1;
if (i < 2) return null;
const s = snaps[i];
const sp = snaps[i - 1];
if (!s.rsi || !s.sma20 || !s.price || !sp.rsi || !s.adx) return null;

// Allow mild trends — strict ADX<25 rarely coexists with RSI extremes
if (s.adx > 30) return null;

const dev = (s.price - s.sma20) / s.sma20;

// Long: moderately oversold with RSI just turning up, price extended below SMA20
if (dev < -0.015 && s.rsi < 35 && s.rsi > sp.rsi) {
  return { side: "long", note: `RSI<35 upturn, ${(dev*100).toFixed(1)}% below SMA20, ADX<30` };
}
// Short: moderately overbought with RSI just turning down, price extended above SMA20
if (dev > 0.015 && s.rsi > 65 && s.rsi < sp.rsi) {
  return { side: "short", note: `RSI>65 downturn, ${(dev*100).toFixed(1)}% above SMA20, ADX<30` };
}
return null;
```

## Backtest history

- Research pipeline backtest (3mo, 1h): 13 trades, 53.8% win rate, profit factor 0.95, total P/L $-20.19, Sharpe -0.35.

## Live status

Proposed candidate, not yet reviewed. From research run #16.
