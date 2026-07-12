---
type: strategy
key: research-28
status: approved
symbol: "AAPL"
timeframe: "1d"
tags: [strategy, research, sma, adx, di]
---

# ADX-Ignition Breakout

Entry signal for US equities (sp500 universe) swing trading, tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, win rate >50% with profit stable across both halves of a sample (not just a good average).

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || p.adx == null || s.plusDI == null || s.minusDI == null || s.sma50 == null || s.price == null) return null;
if (p.adx >= 25 || s.adx < 25) return null;
if (s.plusDI > s.minusDI && s.price > s.sma50) return { side: "long", note: "fresh ADX ignition, +DI dominant, above sma50" };
if (s.minusDI > s.plusDI && s.price < s.sma50) return { side: "short", note: "fresh ADX ignition, -DI dominant, below sma50" };
return null;
```

## Backtest history

- Research pipeline backtest (2y, 1d): 9 trades, 55.6% win rate, profit factor n/a, total P/L $-0.40, Sharpe n/a.

## Live status

Approved - available as `research-28` if assigned to a portfolio's strategy key. From research run #11.
