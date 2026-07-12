---
type: strategy
key: research-15
status: proposed
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, sma, rsi, adx, atr, gold]
---

# ATR-Band Range Fade

gold-specific entries: trend-continuation pullbacks (gold often stair-steps in a macro trend with sharp pullbacks), momentum-ignition on MACD/DI alignment, and range-fade mean-reversion for the many choppy non-trend days

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i];
if (s.adx == null || s.rsi == null || s.sma20 == null || s.atr == null || s.price == null) return null;
if (s.adx > 18) return null;
var upperBand = s.sma20 + s.atr * 1.5;
var lowerBand = s.sma20 - s.atr * 1.5;
if (s.price > upperBand && s.rsi > 65) {
  return { side: "short", note: "range fade: stretched " + (s.price - s.sma20).toFixed(1) + " above sma20, RSI " + s.rsi.toFixed(0) + ", ADX " + s.adx.toFixed(0) };
}
if (s.price < lowerBand && s.rsi < 35) {
  return { side: "long", note: "range fade: stretched " + (s.sma20 - s.price).toFixed(1) + " below sma20, RSI " + s.rsi.toFixed(0) + ", ADX " + s.adx.toFixed(0) };
}
return null;
```

## Backtest history

- Research pipeline backtest (3mo, 1h): 10 trades, 40.0% win rate, profit factor n/a, total P/L $13.84, Sharpe n/a.

## Live status

Proposed candidate, not yet reviewed. From research run #5.
