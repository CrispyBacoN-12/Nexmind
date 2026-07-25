---
type: strategy
key: research-9
status: rejected
symbol: "BTC-USD"
timeframe: "15m"
tags: [strategy, research, sma, rsi, adx, di, atr]
---

# Compressed-Range Volatility Breakout (20-Bar Coil)

a mean-reversion strategy that only trades during low-ADX chop

## Logic

```js
const i = bars.length - 1;
if (i < 50) return null;
const snap = snaps[i];
if (!snap.atr || !snap.sma20 || !snap.sma50 || !snap.adx || !snap.rsi || !snap.plusDI || !snap.minusDI) return null;

// ADX gate: only trade breakouts in trending markets — kills most false breaks in chop
if (snap.adx < 20) return null;

const LOOKBACK = 10;
let hi = -Infinity, lo = Infinity;
let avgVol = 0;
for (let j = i - LOOKBACK; j < i; j++) {
  if (bars[j].h > hi) hi = bars[j].h;
  if (bars[j].l < lo) lo = bars[j].l;
  avgVol += bars[j].v;
}
avgVol /= LOOKBACK;
const rangeWidth = hi - lo;

// Tighter coil threshold: 2.0x ATR (was 2.5x)
if (rangeWidth > 2.0 * snap.atr) return null;

const bar = bars[i];
const buf = 0.001 * bar.c;

// Volume must confirm the breakout bar
const volOk = bar.v > avgVol;

// Long: break above, uptrend (plusDI leads), RSI bullish, volume present
if (bar.c > hi + buf && bar.c > snap.sma50 && snap.plusDI > snap.minusDI && snap.rsi > 50 && volOk) {
  return { side: "long", note: "Coil break long r/atr=" + (rangeWidth / snap.atr).toFixed(2) + " adx=" + snap.adx.toFixed(1) + " rsi=" + snap.rsi.toFixed(0) };
}

// Short: break below, downtrend (minusDI leads), RSI bearish, volume present
if (bar.c < lo - buf && bar.c < snap.sma50 && snap.minusDI > snap.plusDI && snap.rsi < 50 && volOk) {
  return { side: "short", note: "Coil break short r/atr=" + (rangeWidth / snap.atr).toFixed(2) + " adx=" + snap.adx.toFixed(1) + " rsi=" + snap.rsi.toFixed(0) };
}

return null;
```

## Backtest history

- Research pipeline backtest (5d, 15m): 1 trades, 100.0% win rate, profit factor n/a, total P/L $56.33, Sharpe n/a.

## Live status

Rejected after review - not live. From research run #3.
