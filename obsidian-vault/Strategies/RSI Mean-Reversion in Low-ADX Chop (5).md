---
type: strategy
key: research-5
status: rejected
symbol: "BTC-USD"
timeframe: "1h"
tags: [strategy, research, rsi, adx, macd]
---

# RSI Mean-Reversion in Low-ADX Chop

a mean-reversion strategy that only trades during low-ADX chop

## Logic

```js
const i = bars.length - 1;
if (i < 2) return null;
const s = snaps[i], p = snaps[i - 1], pp = snaps[i - 2];
if (!s || !p || !pp) return null;
if (s.rsi === null || p.rsi === null || pp.rsi === null) return null;
if (s.adx === null || s.macdHist === null || p.macdHist === null) return null;
// Relaxed ranging filter — was 20, now 28
if (s.adx > 28) return null;
// Relaxed RSI extremes (was 32/30 → 35/32 long, 68/70 → 65/68 short)
// Reduced bounce threshold from 2pt to 1.5pt to allow more signals
const longEntry = pp.rsi <= 35 && p.rsi <= 32 && s.rsi > p.rsi + 1.5;
const shortEntry = pp.rsi >= 65 && p.rsi >= 68 && s.rsi < p.rsi - 1.5;
// MACD histogram must confirm momentum turning in trade direction
const macdLong = s.macdHist > p.macdHist;
const macdShort = s.macdHist < p.macdHist;
// Bar-close confirmation unchanged
const bar = bars[i];
const bullBar = bar.c > bar.o;
const bearBar = bar.c < bar.o;
if (longEntry && bullBar && macdLong)
  return { side: "long", note: "RSI bounce+" + (s.rsi - p.rsi).toFixed(1) + "pt ADX=" + s.adx.toFixed(1) + " RSI=" + s.rsi.toFixed(1) };
if (shortEntry && bearBar && macdShort)
  return { side: "short", note: "RSI fade-" + (p.rsi - s.rsi).toFixed(1) + "pt ADX=" + s.adx.toFixed(1) + " RSI=" + s.rsi.toFixed(1) };
return null;
```

## Backtest history

- Research pipeline backtest (3mo, 1h): 11 trades, 18.2% win rate, profit factor n/a, total P/L $-218.65, Sharpe n/a.

## Live status

Rejected after review - not live. From research run #2.
