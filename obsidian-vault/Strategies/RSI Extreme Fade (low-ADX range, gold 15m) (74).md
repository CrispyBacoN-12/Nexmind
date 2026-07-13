---
type: strategy
key: research-74
status: rejected
symbol: "GC=F"
timeframe: "15m"
tags: [strategy, research, rsi, adx, gold]
---

# RSI Extreme Fade (low-ADX range, gold 15m)

RSI Extreme Fade (ADX<25 gate, RSI reclaim from <30/>70) - same exact logic that failed blind test on GC=F 1h (research-67/68) - ported to GC=F 15m. Only the timeframe changed, testing whether faster/noisier bars behave differently for range mean-reversion.

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

- Research pipeline backtest (1mo, 15m): 6 trades, 50.0% win rate, profit factor 0.68, total P/L $-1.96, Sharpe -5.68.

## Live status

Rejected after review - not live. From research run #48.
