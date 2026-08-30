---
type: strategy
key: research-217
status: rejected
symbol: "SP500-PANEL"
timeframe: "1d"
tags: [strategy, research, rsi]
---

# RSI Extreme Reversion

Momentum/breakout entry signal for US equities swing trading, risk 1% per trade, exit geometry swept separately, edge that holds across the whole cross-section (many names contributing, not one) and across both halves of the sample.

## Logic

```js
const n = bars.length;
if (n < 2) return null;
const s = snaps[n-1];
const sPrev = snaps[n-2];
if (!s || !sPrev || s.rsi == null || sPrev.rsi == null) return null;
const crossUp = sPrev.rsi < 30 && s.rsi >= 30;
const crossDown = sPrev.rsi > 70 && s.rsi <= 70;
if (crossUp) {
  return { side: "long", note: "RSI recrossed above 30 from oversold" };
}
if (crossDown) {
  return { side: "short", note: "RSI recrossed below 70 from overbought" };
}
return null;
```

## Backtest history

- Research pipeline backtest (fit:2016-2018, 1d): 8401 trades, 48.7% win rate, profit factor 0.70, total P/L $-508.68, Sharpe -1.06.

## Live status

Rejected after review - not live. From research run #112.
