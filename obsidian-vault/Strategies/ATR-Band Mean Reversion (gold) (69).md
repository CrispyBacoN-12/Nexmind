---
type: strategy
key: research-69
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, sma, adx, atr, gold]
---

# ATR-Band Mean Reversion (gold)

ATR-band mean reversion for gold (GC=F, 1h) - a different range-trading mechanism than RSI Extreme Fade (which failed blind test). Measures price distance from SMA20 in ATR units (Bollinger-Band-like, since there's no stddev field), fading back toward the mean once price re-enters the band after extending beyond 2x ATR. Gated by ADX<25 for non-trending conditions.

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i];
var c = bars[i], p = bars[i - 1];
if (s.sma20 == null || s.atr == null || s.adx == null) return null;
if (s.adx > 25) return null;
var upper = s.sma20 + 2 * s.atr;
var lower = s.sma20 - 2 * s.atr;
if (p.c > upper && c.c <= upper) return { side: "short", note: "faded back inside upper ATR band toward SMA20" };
if (p.c < lower && c.c >= lower) return { side: "long", note: "faded back inside lower ATR band toward SMA20" };
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 48 trades, 64.6% win rate, profit factor 1.40, total P/L $19.86, Sharpe 2.36.

## Live status

Rejected after review - not live. From research run #42.
