---
type: strategy
key: research-68
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, rsi, adx, gold]
---

# RSI Extreme Fade (low-ADX range, ADX<25, 2y sample)

Fourth version of RSI Extreme Fade (gold), same logic as v3 (research-67, ADX<25, PF 1.47 on 28 trades in 1y) - unchanged, just widened the data window to 2y to check whether the edge survives with a larger sample, the same check that revealed v1's edge was noise.

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

- Research pipeline backtest (2y, 1h): 57 trades, 57.9% win rate, profit factor 1.29, total P/L $15.46, Sharpe 1.76.

## Live status

Rejected after review - not live. From research run #41.
