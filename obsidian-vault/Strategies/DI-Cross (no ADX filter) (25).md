---
type: strategy
key: research-25
status: approved
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, di, gold]
---

# DI-Cross (no ADX filter)

Higher-frequency entry signals for near-daily trading at >60% win rate, tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade.

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null) return null;
if (p.plusDI <= p.minusDI && s.plusDI > s.minusDI) return { side: "long", note: "DI cross up" };
if (p.plusDI >= p.minusDI && s.plusDI < s.minusDI) return { side: "short", note: "DI cross down" };
return null;
```

## Backtest history

- Research pipeline backtest (3mo, 1h): 65 trades, 63.1% win rate, profit factor n/a, total P/L $31.09, Sharpe n/a.

## Live status

Approved - available as `research-25` if assigned to a portfolio's strategy key. From research run #9.
