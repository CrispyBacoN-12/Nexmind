---
type: strategy
key: research-67
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, rsi, adx, gold]
---

# RSI Extreme Fade (low-ADX range, ADX<25)

Third version of RSI Extreme Fade (gold), branching from v1 (research-65, PF 1.77 but only 11 trades in 1y, ADX<20). Same RSI reclaim-from-extreme entry, loosened the ADX ceiling from <20 to <25 - still restricted to non-trending regimes, but should fire more often.

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.rsi == null || p.rsi == null || s.adx == null) return null;
if (s.adx > 25) return null;
if (p.rsi < 30 && s.rsi >= 30) return { side: "long", note: "RSI reclaiming from oversold, ADX " + s.adx.toFixed(1) + " (ranging)" };
if (p.rsi > 70 && s.rsi <= 70) return { side: "short", note: "RSI reclaiming from overbought, ADX " + s.adx.toFixed(1) + " (ranging)" };
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 28 trades, 67.9% win rate, profit factor 1.47, total P/L $15.18, Sharpe 2.80.

## Live status

Rejected after review - not live. From research run #40.
