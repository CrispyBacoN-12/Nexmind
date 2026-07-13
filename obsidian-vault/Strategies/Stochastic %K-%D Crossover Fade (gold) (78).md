---
type: strategy
key: research-78
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, adx, gold]
---

# Stochastic %K/%D Crossover Fade (gold)

Stochastic %K/%D crossover fade for gold (GC=F, 1h), ADX<25 gate, no Bollinger requirement. RSI Extreme Fade (research-67/68) failed blind test using RSI reclaim-from-30/70. Stochastic is a faster/more sensitive oscillator - testing whether a %K/%D crossover in extreme zones (>80/<20) works as a standalone range-fade signal where RSI didn't.

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.stochK == null || s.stochD == null || p.stochK == null || p.stochD == null) return null;
if (s.adx > 25) return null;
var crossDown = p.stochK >= p.stochD && s.stochK < s.stochD && p.stochK > 80;
var crossUp = p.stochK <= p.stochD && s.stochK > s.stochD && p.stochK < 20;
if (crossDown) return { side: "short", note: "stoch %K/%D bear cross from " + p.stochK.toFixed(1) + ", ADX " + s.adx.toFixed(1) };
if (crossUp) return { side: "long", note: "stoch %K/%D bull cross from " + p.stochK.toFixed(1) + ", ADX " + s.adx.toFixed(1) };
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 178 trades, 53.4% win rate, profit factor 0.86, total P/L $-34.47, Sharpe -1.22.

## Live status

Rejected after review - not live. From research run #52.
