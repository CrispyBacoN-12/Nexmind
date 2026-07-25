---
type: strategy
key: research-10
status: rejected
symbol: "BTC-USD"
timeframe: "1h"
tags: [strategy, research, sma, rsi, adx]
---

# ADX-Chop Mean-Reversion

regime-aware entries: mean-reversion in ADX chop, trend continuation on DI cross, breakout after a volatility squeeze

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i];
if (s.rsi == null || s.adx == null || s.sma20 == null) return null;
if (s.adx > 20) return null;
var c = bars[i].c;
if (s.rsi < 32 && c < s.sma20) return { side: "long", note: "chop fade: RSI " + s.rsi.toFixed(0) + " ADX " + s.adx.toFixed(0) };
if (s.rsi > 68 && c > s.sma20) return { side: "short", note: "chop fade: RSI " + s.rsi.toFixed(0) + " ADX " + s.adx.toFixed(0) };
return null;
```

## Backtest history

- Research pipeline backtest (3mo, 1h): 9 trades, 33.3% win rate, profit factor n/a, total P/L $-39.03, Sharpe n/a.

## Live status

Rejected after review - not live. From research run #4.
