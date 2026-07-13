---
type: strategy
key: research-51
status: rejected
symbol: "BTC-USD"
timeframe: "1h"
tags: [strategy, research, sma, engulfing]
---

# Engulfing + SMA50 trend filter (BTC)

Candle-pattern entry signal for BTC-USD: bullish/bearish engulfing pattern, gated by a SMA50 trend filter (only take longs above SMA50, shorts below). Same logic already validated on gold (research-48, blind-tested 61.0% win rate) - ported here to test whether the edge holds on crypto, which has never had a candle-pattern strategy tried on it.

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

- Research pipeline backtest (1y, 1h): 446 trades, 54.3% win rate, profit factor 0.90, total P/L $-1571.57, Sharpe -0.96.

## Live status

Rejected after review - not live. From research run #24.
