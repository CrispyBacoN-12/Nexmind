---
type: strategy
key: research-7
status: approved
symbol: "BTC-USD"
timeframe: "15m"
tags: [strategy, research, sma, rsi, adx, di, macd]
---

# RSI-50 Momentum with MACD & ADX Trend Filter

a mean-reversion strategy that only trades during low-ADX chop

## Logic

```js
const i = bars.length - 1;
if (i < 10) return null;
const snap = snaps[i];
const prev = snaps[i - 1];
if (!snap.rsi || !prev.rsi || !snap.macdHist || !snap.adx || !snap.sma20 || !snap.sma50) return null;

// Relaxed trend requirement
if (snap.adx < 20) return null;

const price = snap.price;

// Look back up to 8 bars for a meaningful RSI extreme (not just 2 bars)
let recentLow = false;
let recentHigh = false;
for (let k = 1; k <= 8; k++) {
  const s = snaps[i - k];
  if (!s || !s.rsi) break;
  if (s.rsi < 45) recentLow = true;
  if (s.rsi > 55) recentHigh = true;
}

// MACD directional only — drop acceleration requirement that filtered too aggressively
const macdBullish = snap.macdHist > 0;
const macdBearish = snap.macdHist < 0;

if (prev.rsi < 50 && snap.rsi >= 50 && macdBullish && snap.plusDI > snap.minusDI) {
  // Use SMA20 instead of SMA50 — more responsive, fewer rejections on trending stocks
  if (price > snap.sma20 && recentLow) {
    return { side: "long", note: "RSI x50↑ from <45 within 8 bars, MACD+, price>SMA20, ADX " + snap.adx.toFixed(1) };
  }
}
if (prev.rsi > 50 && snap.rsi <= 50 && macdBearish && snap.minusDI > snap.plusDI) {
  if (price < snap.sma20 && recentHigh) {
    return { side: "short", note: "RSI x50↓ from >55 within 8 bars, MACD-, price<SMA20, ADX " + snap.adx.toFixed(1) };
  }
}
return null;
```

## Backtest history

- Research pipeline backtest (5d, 15m): 6 trades, 16.7% win rate, profit factor n/a, total P/L $24.17, Sharpe n/a.

## Live status

Approved - available as `research-7` if assigned to a portfolio's strategy key. From research run #3.
