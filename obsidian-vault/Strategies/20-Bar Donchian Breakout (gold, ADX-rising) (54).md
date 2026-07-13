---
type: strategy
key: research-54
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, adx, donchian, gold]
---

# 20-Bar Donchian Breakout (gold, ADX-rising)

Tuning pass on research-52 (20-Bar Donchian Breakout, gold): baseline was break-even (PF 0.99, -$4.76 over 277 trades). Same logic, one change: require ADX rising vs. the prior bar (not just a static >=22 floor) so breakouts only fire while trend strength is actively building, filtering breakouts that occur as a trend is already flattening out.

## Logic

```js
var i = bars.length - 1;
var lookback = 20;
if (i < lookback + 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || p.adx == null) return null;
if (s.adx < 22) return null;
if (s.adx <= p.adx) return null;

var hi = -Infinity, lo = Infinity;
for (var k = i - lookback; k < i; k++) {
  if (bars[k].h > hi) hi = bars[k].h;
  if (bars[k].l < lo) lo = bars[k].l;
}
var c = bars[i].c;
var pc = bars[i - 1].c;

if (pc <= hi && c > hi) {
  return { side: "long", note: "20-bar Donchian breakout long, ADX rising to " + Math.round(s.adx) };
}
if (pc >= lo && c < lo) {
  return { side: "short", note: "20-bar Donchian breakout short, ADX rising to " + Math.round(s.adx) };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 238 trades, 57.6% win rate, profit factor 0.95, total P/L $-19.70, Sharpe -0.49.

## Live status

Rejected after review - not live. From research run #27.
