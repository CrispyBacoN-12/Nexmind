---
type: strategy
key: research-2
status: proposed
symbol: "BTC-USD"
timeframe: "1h"
tags: [strategy, research, sma, rsi, adx, macd, atr]
---

# Low-ADX Mean-Reversion / ATR-Band Fade

a mean-reversion strategy that only trades during low-ADX chop

## Logic

```js
const i = bars.length - 1;
const snap = snaps[i];
const prevSnap = snaps[i - 1];
if (!snap || !prevSnap) return null;
if (snap.adx === null || snap.rsi === null || snap.atr === null || snap.sma20 === null || snap.macdHist === null || prevSnap.macdHist === null) return null;

// Raised ADX ceiling — 18 was too tight, most ranging periods still show ADX 18-25
if (snap.adx > 25) return null;

const bar = bars[i];
const price = snap.price;
const sma = snap.sma20;
const atr = snap.atr;
const deviation = price - sma;
const threshold = atr * 1.5; // Reduced from 2.0 — 2-ATR extremes almost never occur in low-ADX regimes

// Long: moderately oversold + at least one reversal signal
if (deviation < -threshold && snap.rsi < 35) {
  const macdTurning = snap.macdHist > prevSnap.macdHist;
  const bullishCandle = bar.c > bar.o;
  if (macdTurning || bullishCandle) {
    return { side: "long", note: "MR long: dev=" + deviation.toFixed(0) + " RSI=" + snap.rsi.toFixed(1) + " ADX=" + snap.adx.toFixed(1) };
  }
}

// Short: moderately overbought + at least one reversal signal
if (deviation > threshold && snap.rsi > 65) {
  const macdTurning = snap.macdHist < prevSnap.macdHist;
  const bearishCandle = bar.c < bar.o;
  if (macdTurning || bearishCandle) {
    return { side: "short", note: "MR short: dev=" + deviation.toFixed(0) + " RSI=" + snap.rsi.toFixed(1) + " ADX=" + snap.adx.toFixed(1) };
  }
}

return null;
```

## Backtest history

- Research pipeline backtest (3mo, 1h): 3 trades, 0.0% win rate, profit factor n/a, total P/L $-84.51, Sharpe n/a.

## Live status

Proposed candidate, not yet reviewed. From research run #1.
