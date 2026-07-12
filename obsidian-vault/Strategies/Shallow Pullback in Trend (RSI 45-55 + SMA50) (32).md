---
type: strategy
key: research-32
status: approved
symbol: "BTC-USD"
timeframe: "1h"
tags: [strategy, research, sma, rsi]
---

# Shallow Pullback in Trend (RSI 45/55 + SMA50)

Replacement for research-27 on Bitcoin Desk #9 - shallow pullback in trend using RSI 45/55 + SMA50 filter

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.rsi == null || p.rsi == null || s.sma50 == null || s.price == null) return null;
if (p.rsi <= 45 && s.rsi > 45 && s.price > s.sma50) return { side: "long" };
if (p.rsi >= 55 && s.rsi < 55 && s.price < s.sma50) return { side: "short" };
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 166 trades, 62.0% win rate, profit factor n/a, total P/L $1305.30, Sharpe n/a.

## Live status

Approved - available as `research-32` if assigned to a portfolio's strategy key. From research run #15.
