---
type: strategy
key: research-33
status: proposed
symbol: "BTC-USD"
timeframe: "1h"
tags: [strategy, research, sma, rsi, adx, di, macd]
---

# RSI+MACD Trend Momentum

test metrics display verification

## Logic

```js
const i = bars.length - 1;
if (i < 4) return null;
const s = snaps[i];
const sp = snaps[i - 1];
const sp2 = snaps[i - 2];
const sp3 = snaps[i - 3];
if (!s.rsi || !s.macdHist || !sp.rsi || !sp.macdHist || !sp2.macdHist || !sp3.macdHist) return null;
if (!s.adx || !s.sma20 || !s.sma50 || !s.plusDI || !s.minusDI || !sp.adx) return null;

// Stronger trend: ADX raised to 25, must be rising (not just present)
if (s.adx < 25 || s.adx < sp.adx) return null;

// Long: SMA20 > SMA50 for trend alignment, tighter RSI, meaningful DI spread, 3-bar MACD expansion
if (
  s.price > s.sma20 &&
  s.sma20 > s.sma50 &&
  s.rsi > 58 &&
  s.rsi > sp.rsi &&
  s.plusDI > s.minusDI &&
  (s.plusDI - s.minusDI) > 3 &&
  s.macdHist > 0 &&
  s.macdHist > sp.macdHist &&
  sp.macdHist > sp2.macdHist &&
  sp2.macdHist > sp3.macdHist
) {
  return { side: "long", note: "ADX>25 rising, SMA20>SMA50, DI+>DI-+3, RSI>58 rising, MACD hist expanding 3 bars" };
}

// Short: SMA20 < SMA50, tighter RSI, meaningful DI spread, 3-bar MACD expansion
if (
  s.price < s.sma20 &&
  s.sma20 < s.sma50 &&
  s.rsi < 42 &&
  s.rsi < sp.rsi &&
  s.minusDI > s.plusDI &&
  (s.minusDI - s.plusDI) > 3 &&
  s.macdHist < 0 &&
  s.macdHist < sp.macdHist &&
  sp.macdHist < sp2.macdHist &&
  sp2.macdHist < sp3.macdHist
) {
  return { side: "short", note: "ADX>25 rising, SMA20<SMA50, DI->DI++3, RSI<42 falling, MACD hist expanding 3 bars" };
}

return null;
```

## Backtest history

- Research pipeline backtest (3mo, 1h): 66 trades, 53.0% win rate, profit factor 0.91, total P/L $-188.75, Sharpe -1.02.

## Live status

Proposed candidate, not yet reviewed. From research run #16.
