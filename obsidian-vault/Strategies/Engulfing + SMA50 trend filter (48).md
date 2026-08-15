---
type: strategy
key: research-48
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, sma, engulfing, gold]
---

# Engulfing + SMA50 trend filter

Candle-pattern entry signal for gold (GC=F): bullish/bearish engulfing pattern, gated by a SMA50 trend filter (only take longs above SMA50, shorts below) so the pattern trades with the prevailing trend instead of against it. Tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade.

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var c = bars[i], p = bars[i - 1];
var s = snaps[i];
if (s.sma50 == null) return null;

var bullish = c.c > c.o;
var bearish = c.c < c.o;
var pBullish = p.c > p.o;
var pBearish = p.c < p.o;

if (bullish && pBearish && c.o <= p.c && c.c >= p.o && c.c > s.sma50) {
  return { side: "long", note: "bullish engulfing above SMA50" };
}
if (bearish && pBullish && c.o >= p.c && c.c <= p.o && c.c < s.sma50) {
  return { side: "short", note: "bearish engulfing below SMA50" };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 329 trades, 56.2% win rate, profit factor 0.83, total P/L $-85.44, Sharpe -1.39.

## Live status

Rejected after review - not live. From research run #21.
