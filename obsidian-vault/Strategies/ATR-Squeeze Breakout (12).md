---
type: strategy
key: research-12
status: proposed
symbol: "BTC-USD"
timeframe: "1h"
tags: [strategy, research, atr]
---

# ATR-Squeeze Breakout

regime-aware entries: mean-reversion in ADX chop, trend continuation on DI cross, breakout after a volatility squeeze

## Logic

```js
var i = bars.length - 1;
if (i < 15) return null;
var s = snaps[i];
if (s.atr == null) return null;
var sum = 0, n = 0;
for (var k = i - 10; k < i; k++) {
  if (snaps[k] && snaps[k].atr != null) { sum += snaps[k].atr; n++; }
}
if (n < 5) return null;
var avgAtr = sum / n;
if (s.atr >= avgAtr * 0.7) return null;
var move = bars[i].c - bars[i - 1].c;
if (move > s.atr * 0.5) return { side: "long", note: "squeeze breakout up, ATR " + s.atr.toFixed(2) };
if (move < -s.atr * 0.5) return { side: "short", note: "squeeze breakout down, ATR " + s.atr.toFixed(2) };
return null;
```

## Backtest history

- Research pipeline backtest (3mo, 1h): 0 trades, 0.0% win rate, profit factor n/a, total P/L $0.00, Sharpe n/a.

## Live status

Proposed candidate, not yet reviewed. From research run #4.
