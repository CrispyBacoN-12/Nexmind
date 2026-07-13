---
type: strategy
key: research-56
status: rejected
symbol: "BTC-USD"
timeframe: "1h"
tags: [strategy, research, sma, atr, engulfing]
---

# Engulfing + SMA50 trend filter (BTC, ATR-filtered)

Tuning pass on research-51 (Engulfing + SMA50 trend filter, BTC): baseline was clearly negative (PF 0.90, -$1571.57 over 446 trades). Same logic, one change: require the engulfing candle's body to be at least 1x ATR, filtering small/noisy engulfing shapes that pass the raw shape test but aren't meaningfully large moves on BTC's noisier 1h bars.

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var c = bars[i], p = bars[i - 1];
var s = snaps[i];
if (s.sma50 == null || s.atr == null) return null;

var body = Math.abs(c.c - c.o);
if (body < s.atr) return null;

var bullish = c.c > c.o;
var bearish = c.c < c.o;
var pBullish = p.c > p.o;
var pBearish = p.c < p.o;

if (bullish && pBearish && c.o <= p.c && c.c >= p.o && c.c > s.sma50) {
  return { side: "long", note: "large bullish engulfing above SMA50" };
}
if (bearish && pBullish && c.o >= p.c && c.c <= p.o && c.c < s.sma50) {
  return { side: "short", note: "large bearish engulfing below SMA50" };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 163 trades, 55.8% win rate, profit factor 0.98, total P/L $-103.07, Sharpe -0.16.

## Live status

Rejected after review - not live. From research run #29.
