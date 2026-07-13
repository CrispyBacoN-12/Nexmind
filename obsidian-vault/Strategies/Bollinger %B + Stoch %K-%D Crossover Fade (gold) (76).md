---
type: strategy
key: research-76
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, adx, bollinger, gold]
---

# Bollinger %B + Stoch %K/%D Crossover Fade (gold)

Bollinger %B + Stochastic %K/%D crossover fade for gold (GC=F, 1h), ADX<25 gate. Refines research-75 (rejected, breakeven PF 0.997) which used a noisy single-bar stochK downtick as its exhaustion confirmation. This version requires an actual %K/%D crossover (K crossing below D from above 80, or above D from below 20) at a Bollinger band breach - the standard, less noisy Stochastic signal.

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

- Research pipeline backtest (1y, 1h): 61 trades, 57.4% win rate, profit factor 1.06, total P/L $4.75, Sharpe 0.43.

## Live status

Rejected after review - not live. From research run #50.
