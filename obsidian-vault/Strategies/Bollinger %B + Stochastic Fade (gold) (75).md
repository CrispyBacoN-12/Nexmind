---
type: strategy
key: research-75
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, adx, bollinger, gold]
---

# Bollinger %B + Stochastic Fade (gold)

Bollinger %B + Stochastic exhaustion fade for gold (GC=F, 1h), ADX<25 gate. Every prior range-fade mechanism this session (RSI extreme, ATR-band distance, MACD histogram exhaustion, volume climax) failed in-sample or blind test. This uses two indicators added specifically for this experiment: Bollinger %B (price position vs the 20/2 bands) to detect a band breach, confirmed by Stochastic %K turning back from an extreme (>80 rolling down / <20 rolling up) before entering - a stricter double-confirmation than any single-indicator fade tried so far.

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.bbPercentB == null || p.bbPercentB == null) return null;
if (s.stochK == null || p.stochK == null) return null;
if (s.adx > 25) return null;
var stochTurnDown = p.stochK > 80 && s.stochK < p.stochK;
var stochTurnUp = p.stochK < 20 && s.stochK > p.stochK;
if (p.bbPercentB > 1 && stochTurnDown) return { side: "short", note: "band breach + stoch turn down from " + p.stochK.toFixed(1) + ", ADX " + s.adx.toFixed(1) };
if (p.bbPercentB < 0 && stochTurnUp) return { side: "long", note: "band breach + stoch turn up from " + p.stochK.toFixed(1) + ", ADX " + s.adx.toFixed(1) };
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 96 trades, 55.2% win rate, profit factor 1.00, total P/L $-0.32, Sharpe -0.02.

## Live status

Rejected after review - not live. From research run #49.
