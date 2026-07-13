---
type: strategy
key: research-79
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, adx, gold]
---

# VWAP Deviation Fade (gold)

Session-anchored VWAP deviation fade for gold (GC=F, 1h), ADX<25 gate. New mechanism using vwapDevPct (deviation from the daily-anchored VWAP), just added to the snapshot pipeline. Genuinely different dimension from every prior range-fade attempt - VWAP deviation is a volume-weighted fair-value reference rather than a price-only oscillator/band. Price stretching more than 0.5% from VWAP in a non-trending regime is faded back toward it.

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || s.vwapDevPct == null || p.vwapDevPct == null) return null;
if (s.adx > 25) return null;
var THRESH = 0.005;
if (p.vwapDevPct > THRESH && s.vwapDevPct <= p.vwapDevPct) return { side: "short", note: "faded back toward VWAP from +" + (p.vwapDevPct * 100).toFixed(2) + "%, ADX " + s.adx.toFixed(1) };
if (p.vwapDevPct < -THRESH && s.vwapDevPct >= p.vwapDevPct) return { side: "long", note: "faded back toward VWAP from " + (p.vwapDevPct * 100).toFixed(2) + "%, ADX " + s.adx.toFixed(1) };
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 152 trades, 51.3% win rate, profit factor 0.81, total P/L $-52.24, Sharpe -1.93.

## Live status

Rejected after review - not live. From research run #53.
