---
type: strategy
key: research-27
status: approved
symbol: "BTC-USD"
timeframe: "1h"
tags: [strategy, research, sma, rsi, adx]
---

# RSI-50 Momentum Cross

Entry signal for BTC-USD swing trading, tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, win rate >50% with profit stable across both halves of a 1-year sample (not just a good average).

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.rsi == null || p.rsi == null || s.sma50 == null || s.price == null) return null;
if (s.adx < 20) return null;
if (p.rsi <= 50 && s.rsi > 50 && s.price > s.sma50) return { side: "long", note: "RSI cross above 50, uptrend" };
if (p.rsi >= 50 && s.rsi < 50 && s.price < s.sma50) return { side: "short", note: "RSI cross below 50, downtrend" };
return null;
```

## Backtest history

- Research pipeline backtest (3mo, 1h): 63 trades, 58.7% win rate, profit factor n/a, total P/L $118.33, Sharpe n/a.

## Live status

Approved - available as `research-27` if assigned to a portfolio's strategy key. From research run #10.
