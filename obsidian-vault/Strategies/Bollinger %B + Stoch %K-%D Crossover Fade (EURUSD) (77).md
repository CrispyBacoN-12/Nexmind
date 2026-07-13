---
type: strategy
key: research-77
status: rejected
symbol: "EURUSD=X"
timeframe: "1h"
tags: [strategy, research, adx, bollinger]
---

# Bollinger %B + Stoch %K/%D Crossover Fade (EURUSD)

Bollinger %B + Stochastic %K/%D crossover fade (research-76 logic, failed blind test on GC=F 1h) ported unchanged to EURUSD=X, ADX<25 gate. Forex majors spend more time range-bound/consolidating than gold - testing whether the same double-confirmation mechanism finds a real edge in a more naturally range-prone market.

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.bbPercentB == null || p.bbPercentB == null) return null;
if (s.stochK == null || s.stochD == null || p.stochK == null || p.stochD == null) return null;
if (s.adx > 25) return null;
var crossDown = p.stochK >= p.stochD && s.stochK < s.stochD && p.stochK > 80;
var crossUp = p.stochK <= p.stochD && s.stochK > s.stochD && p.stochK < 20;
if (p.bbPercentB > 1 && crossDown) return { side: "short", note: "band breach + stoch %K/%D bear cross from " + p.stochK.toFixed(1) + ", ADX " + s.adx.toFixed(1) };
if (p.bbPercentB < 0 && crossUp) return { side: "long", note: "band breach + stoch %K/%D bull cross from " + p.stochK.toFixed(1) + ", ADX " + s.adx.toFixed(1) };
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 84 trades, 47.6% win rate, profit factor 0.59, total P/L $-0.00, Sharpe -4.20.

## Live status

Rejected after review - not live. From research run #51.
