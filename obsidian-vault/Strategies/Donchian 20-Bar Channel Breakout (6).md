---
type: strategy
key: research-6
status: proposed
symbol: "BTC-USD"
timeframe: "1h"
tags: [strategy, research, sma, rsi, adx, di, macd, atr, donchian]
---

# Donchian 20-Bar Channel Breakout

a mean-reversion strategy that only trades during low-ADX chop

## Logic

```js
const i = bars.length - 1;
const s = snaps[i];
if (!s || s.atr === null || s.adx === null || s.sma50 === null || s.sma20 === null || i < 50) return null;

// Require a genuine trend; also cap to avoid exhausted moves
if (s.adx < 25) return null;
if (s.adx > 55) return null;

// Donchian channel from the 20 bars before current
let hi = -Infinity, lo = Infinity, avgVol = 0;
for (let k = i - 20; k < i; k++) {
  if (bars[k].h > hi) hi = bars[k].h;
  if (bars[k].l < lo) lo = bars[k].l;
  avgVol += bars[k].v;
}
avgVol /= 20;

// Wider range requirement to skip low-volatility consolidations
if ((hi - lo) < s.atr * 2.5) return null;

const bar = bars[i];
const barRange = bar.h - bar.l;

// Stronger volume confirmation
if (bar.v < avgVol * 1.5) return null;

// Long: break above Donchian high with full trend alignment
if (bar.c > hi) {
  if (bar.c < s.sma20) return null;                                              // price above sma20
  if (bar.c < s.sma50) return null;                                              // price above sma50
  if (s.sma20 < s.sma50) return null;                                            // sma20 above sma50 (uptrend)
  if (s.rsi !== null && s.rsi < 55) return null;                                 // tighter RSI momentum
  if (s.macdHist !== null && s.macdHist < 0) return null;
  if (s.plusDI !== null && s.minusDI !== null && s.plusDI <= s.minusDI) return null;
  if (barRange > 0 && (bar.c - bar.l) / barRange < 0.6) return null;            // close in upper 40% of bar
  return { side: "long", note: "Donchian break long hi=" + hi.toFixed(0) + " ADX=" + s.adx.toFixed(0) + " RSI=" + (s.rsi !== null ? s.rsi.toFixed(0) : "n/a") };
}

// Short: break below Donchian low with full trend alignment
if (bar.c < lo) {
  if (bar.c > s.sma20) return null;                                              // price below sma20
  if (bar.c > s.sma50) return null;                                              // price below sma50
  if (s.sma20 > s.sma50) return null;                                            // sma20 below sma50 (downtrend)
  if (s.rsi !== null && s.rsi > 45) return null;                                 // tighter RSI momentum
  if (s.macdHist !== null && s.macdHist > 0) return null;
  if (s.plusDI !== null && s.minusDI !== null && s.minusDI <= s.plusDI) return null;
  if (barRange > 0 && (bar.h - bar.c) / barRange < 0.6) return null;            // close in lower 40% of bar
  return { side: "short", note: "Donchian break short lo=" + lo.toFixed(0) + " ADX=" + s.adx.toFixed(0) + " RSI=" + (s.rsi !== null ? s.rsi.toFixed(0) : "n/a") };
}

return null;
```

## Backtest history

- Research pipeline backtest (3mo, 1h): 25 trades, 12.0% win rate, profit factor n/a, total P/L $-517.28, Sharpe n/a.

## Live status

Proposed candidate, not yet reviewed. From research run #2.
