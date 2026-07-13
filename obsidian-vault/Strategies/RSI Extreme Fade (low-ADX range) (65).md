---
type: strategy
key: research-65
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, rsi, adx, gold]
---

# RSI Extreme Fade (low-ADX range)

Range/mean-reversion fade for gold (GC=F, 1h) - fills a coverage gap in the currently-approved strategy set, all of which require a trend context (ADX floor and/or SMA alignment) to fire. This candidate does the opposite: gated by ADX<20 (explicitly non-trending/ranging conditions), fades RSI reclaiming from an oversold/overbought extreme back toward 50, with no trend-direction filter at all.

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

- Research pipeline backtest (1y, 1h): 11 trades, 72.7% win rate, profit factor 1.77, total P/L $9.51, Sharpe 4.17.

## Live status

Rejected after review - not live. From research run #38.
