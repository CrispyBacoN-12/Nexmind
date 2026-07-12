---
type: strategy
key: research-29
status: approved
symbol: "AAPL"
timeframe: "1wk"
tags: [strategy, research, sma, rsi, adx]
---

# RSI-50 Momentum Cross (weekly)

Entry signal for US equities (sp500 universe) swing trading on WEEKLY bars, tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, win rate >50% with profit stable across both halves of a sample (not just a good average). Daily-bar signals were tested extensively and failed to hold up broadly - weekly bars reduce noise and were found to carry more reliable edge.

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.rsi == null || p.rsi == null || s.sma50 == null || s.price == null) return null;
if (s.adx < 20) return null;
if (p.rsi <= 50 && s.rsi > 50 && s.price > s.sma50) return { side: "long", note: "weekly RSI cross above 50, uptrend" };
if (p.rsi >= 50 && s.rsi < 50 && s.price < s.sma50) return { side: "short", note: "weekly RSI cross below 50, downtrend" };
return null;
```

## Backtest history

- Research pipeline backtest (5y, 1wk): 8 trades, 87.5% win rate, profit factor n/a, total P/L $6.89, Sharpe n/a.

## Live status

Approved - available as `research-29` if assigned to a portfolio's strategy key. From research run #12.
