---
type: strategy
key: research-57
status: rejected
symbol: "BTC-USD"
timeframe: "1h"
tags: [strategy, research, sma, atr, engulfing]
---

# Engulfing + SMA50 trend filter (BTC, 1.5x ATR)

Second tuning pass on Engulfing + SMA50 (BTC). v1 (raw shape): PF 0.90, -$1571.57/446 trades. v2 (body>=1x ATR): PF 0.98, -$103.07/163 trades - closing in on break-even. Same change pushed further: body >= 1.5x ATR, testing whether the improving trend continues or trade count collapses first.

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var c = bars[i], p = bars[i - 1];
var s = snaps[i];
if (s.sma50 == null || s.atr == null) return null;

var body = Math.abs(c.c - c.o);
if (body < s.atr * 1.5) return null;

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

- Research pipeline backtest (1y, 1h): 70 trades, 47.1% win rate, profit factor 0.77, total P/L $-589.60, Sharpe -2.02.

## Live status

Rejected after review - not live. From research run #30.
