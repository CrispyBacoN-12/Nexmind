---
type: strategy
key: research-80
status: rejected
symbol: "GC=F"
timeframe: "1d"
tags: [strategy, research, adx, bollinger, gold]
---

# Bollinger %B + Stoch %K/%D Crossover Fade (gold 1d)

Bollinger %B + Stochastic %K/%D crossover fade (research-76 logic, failed blind test on GC=F 1h) ported to GC=F 1d, ADX<25 gate. Every range mechanism this session has been tested on 1h/15m bars - daily bars have far less noise, which may change whether this double-confirmation fade holds up.

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

- Research pipeline backtest (5y, 1d): 13 trades, 38.5% win rate, profit factor 0.42, total P/L $-27.26, Sharpe -4.91.

## Live status

Rejected after review - not live. From research run #54.
