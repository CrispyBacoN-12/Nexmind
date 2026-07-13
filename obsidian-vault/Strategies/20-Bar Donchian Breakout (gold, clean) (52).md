---
type: strategy
key: research-52
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, adx, donchian, gold]
---

# 20-Bar Donchian Breakout (gold, clean)

20-bar Donchian channel breakout for gold (GC=F): long when close breaks above the highest high of the prior 20 bars, short when it breaks below the lowest low, gated by ADX >= 22 for basic trend-strength confirmation. Donchian breakout has only ever been tested on BTC-USD before, with two contradictory/over-filtered drafts that never got a fair read on the pattern itself - this is a minimal, clean version to test on gold.

## Logic

```js
var i = bars.length - 1;
var lookback = 20;
if (i < lookback + 1) return null;
var s = snaps[i];
if (s.adx == null) return null;
if (s.adx < 22) return null;

var hi = -Infinity, lo = Infinity;
for (var k = i - lookback; k < i; k++) {
  if (bars[k].h > hi) hi = bars[k].h;
  if (bars[k].l < lo) lo = bars[k].l;
}
var c = bars[i].c;
var pc = bars[i - 1].c;

if (pc <= hi && c > hi) {
  return { side: "long", note: "20-bar Donchian breakout long, ADX " + Math.round(s.adx) };
}
if (pc >= lo && c < lo) {
  return { side: "short", note: "20-bar Donchian breakout short, ADX " + Math.round(s.adx) };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 277 trades, 57.8% win rate, profit factor 0.99, total P/L $-4.76, Sharpe -0.11.

## Live status

Rejected after review - not live. From research run #25.
