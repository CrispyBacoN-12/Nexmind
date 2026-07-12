---
type: strategy
key: research-1
status: proposed
symbol: "BTC-USD"
timeframe: "1h"
tags: [strategy, research, rsi, adx, di, macd]
---

# RSI Momentum / ADX Trend Rider

a mean-reversion strategy that only trades during low-ADX chop

## Logic

```js
const i = bars.length - 1;
const snap = snaps[i];
if (i < 3) return null;
if (!snap || snap.adx === null || snap.rsi === null ||
    snap.plusDI === null || snap.minusDI === null || snap.macdHist === null) return null;

const prev1 = snaps[i - 1];
const prev2 = snaps[i - 2];
if (!prev1 || prev1.rsi === null) return null;

// Relaxed ADX floor — 30 was too strict, 22 still means real trend
if (snap.adx < 22) return null;

// Removed ADX-rising gate — it compounded with other filters to kill all trades

// Reduced DI spread from 6 → 4; still filters noise but fires more often
const diSpread = snap.plusDI - snap.minusDI;
if (Math.abs(diSpread) < 4) return null;

// Extend RSI cross window to 2 bars: fire on the cross bar or the bar after
const rsiCrossedUp =
  (prev1.rsi < 50 && snap.rsi >= 50) ||
  (prev2 && prev2.rsi !== null && prev2.rsi < 50 && prev1.rsi >= 50 && snap.rsi >= 50);

const rsiCrossedDown =
  (prev1.rsi > 50 && snap.rsi <= 50) ||
  (prev2 && prev2.rsi !== null && prev2.rsi > 50 && prev1.rsi <= 50 && snap.rsi <= 50);

if (rsiCrossedUp && diSpread > 0 && snap.macdHist > 0) {
  if (snap.rsi > 65) return null;
  return { side: "long", note: "RSI x50↑ ADX=" + snap.adx.toFixed(1) + " DI+" + diSpread.toFixed(1) + " MACD+" };
}

if (rsiCrossedDown && diSpread < 0 && snap.macdHist < 0) {
  if (snap.rsi < 35) return null;
  return { side: "short", note: "RSI x50↓ ADX=" + snap.adx.toFixed(1) + " DI-" + Math.abs(diSpread).toFixed(1) + " MACD-" };
}

return null;
```

## Backtest history

- Research pipeline backtest (3mo, 1h): 30 trades, 20.0% win rate, profit factor n/a, total P/L $23.88, Sharpe n/a.

## Live status

Proposed candidate, not yet reviewed. From research run #1.
