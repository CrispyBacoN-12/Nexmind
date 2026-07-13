---
type: strategy
key: research-82
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, adx, bollinger, gold]
---

# Bollinger Band Reclaim Fade (gold)

Bollinger Band reclaim fade for gold (GC=F, 1h), ADX<25 gate, no Stochastic filter. Every BB+Stoch attempt this session (research-75/76) fired on a momentum confirmation while price was still outside the band. This fires on the classic reclaim: price closes back inside the band after being outside it last bar - the same entry timing as the RSI Extreme Fade (research-67/68), just using Bollinger %B instead of RSI as the extremity measure.

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.bbPercentB == null || p.bbPercentB == null) return null;
if (s.adx > 25) return null;
if (p.bbPercentB > 1 && s.bbPercentB <= 1) return { side: "short", note: "reclaimed inside upper band from " + p.bbPercentB.toFixed(2) + ", ADX " + s.adx.toFixed(1) };
if (p.bbPercentB < 0 && s.bbPercentB >= 0) return { side: "long", note: "reclaimed inside lower band from " + p.bbPercentB.toFixed(2) + ", ADX " + s.adx.toFixed(1) };
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 132 trades, 56.1% win rate, profit factor 1.03, total P/L $5.76, Sharpe 0.24.

## Live status

Rejected after review - not live. From research run #56.
