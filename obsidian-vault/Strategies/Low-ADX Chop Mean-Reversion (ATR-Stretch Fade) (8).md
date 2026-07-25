---
type: strategy
key: research-8
status: rejected
symbol: "BTC-USD"
timeframe: "15m"
tags: [strategy, research, sma, rsi, adx, atr]
---

# Low-ADX Chop Mean-Reversion (ATR-Stretch Fade)

a mean-reversion strategy that only trades during low-ADX chop

## Logic

```js
const i = bars.length - 1;
if (i < 2) return null;
const snap = snaps[i];
const prev = snaps[i - 1];
if (!snap.rsi || !prev.rsi || !snap.adx || !snap.sma20 || !snap.atr) return null;

// Tighter chop filter
if (snap.adx >= 23) return null;

const bar = bars[i];
const price = bar.c;
const dev = (price - snap.sma20) / snap.atr;
const barRange = bar.h - bar.l;

// Require a meaningful-sized bar (filter dojis)
if (barRange < 0.0001 * price) return null;

// Long: RSI persistently oversold (both bars), now turning, with bullish reversal bar
// Close must be in upper 55% of range — confirms buyers stepped in
const bullRevBar = bar.c > bar.o && (bar.c - bar.l) / barRange > 0.55;
if (
  snap.rsi < 37 && prev.rsi < 40 &&
  snap.rsi > prev.rsi &&
  dev < -1.3 &&
  bullRevBar
) {
  return { side: "long", note: "Chop fade L: ADX " + snap.adx.toFixed(1) + ", RSI " + snap.rsi.toFixed(1) + ", dev " + dev.toFixed(2) + " ATR" };
}

// Short: RSI persistently overbought (both bars), now turning, with bearish reversal bar
// Close must be in lower 55% of range — confirms sellers dominated
const bearRevBar = bar.c < bar.o && (bar.h - bar.c) / barRange > 0.55;
if (
  snap.rsi > 63 && prev.rsi > 60 &&
  snap.rsi < prev.rsi &&
  dev > 1.3 &&
  bearRevBar
) {
  return { side: "short", note: "Chop fade S: ADX " + snap.adx.toFixed(1) + ", RSI " + snap.rsi.toFixed(1) + ", dev " + dev.toFixed(2) + " ATR" };
}

return null;
```

## Backtest history

- Research pipeline backtest (5d, 15m): 1 trades, 0.0% win rate, profit factor n/a, total P/L $-22.72, Sharpe n/a.

## Live status

Rejected after review - not live. From research run #3.
