---
type: strategy
key: research-26
status: approved
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, adx, di, gold]
---

# DI-Cross + ADX>15 filter

Higher-frequency entry signals for near-daily trading at >60% win rate, tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade.

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.adx == null) return null;
if (s.adx < 15) return null;
if (p.plusDI <= p.minusDI && s.plusDI > s.minusDI) return { side: "long", note: "DI cross up, ADX>15" };
if (p.plusDI >= p.minusDI && s.plusDI < s.minusDI) return { side: "short", note: "DI cross down, ADX>15" };
return null;
```

## Backtest history

- Research pipeline backtest (3mo, 1h): 47 trades, 63.8% win rate, profit factor n/a, total P/L $24.50, Sharpe n/a.

## Live status

Approved - available as `research-26` if assigned to a portfolio's strategy key. From research run #9.
