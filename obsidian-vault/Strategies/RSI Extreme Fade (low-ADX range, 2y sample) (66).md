---
type: strategy
key: research-66
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, rsi, adx, gold]
---

# RSI Extreme Fade (low-ADX range, 2y sample)

Second version of RSI Extreme Fade (gold), same logic as v1 (research-65, PF 1.77 but only 11 trades in 1y). Same ADX<20 gate and RSI reclaim-from-extreme entry, unchanged - only the data window widened to 2y to get a larger sample.

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.rsi == null || p.rsi == null || s.adx == null) return null;
if (s.adx > 20) return null;
if (p.rsi < 30 && s.rsi >= 30) return { side: "long", note: "RSI reclaiming from oversold, ADX " + s.adx.toFixed(1) + " (ranging)" };
if (p.rsi > 70 && s.rsi <= 70) return { side: "short", note: "RSI reclaiming from overbought, ADX " + s.adx.toFixed(1) + " (ranging)" };
return null;
```

## Backtest history

- Research pipeline backtest (2y, 1h): 23 trades, 52.2% win rate, profit factor 1.02, total P/L $0.42, Sharpe 0.11.

## Live status

Rejected after review - not live. From research run #39.
