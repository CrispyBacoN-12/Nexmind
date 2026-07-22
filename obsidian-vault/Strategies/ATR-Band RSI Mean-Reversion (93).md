---
type: strategy
key: research-93
status: rejected
symbol: "SI=F"
timeframe: "1h"
tags: [strategy, research, sma, rsi, adx, di, atr]
---

# ATR-Band RSI Mean-Reversion

DI-Dominance Widening entry signal for SI=F (silver futures): fires whenever the +DI/-DI gap is widening while ADX >= 20, no fresh crossover required. This is the same logic as the live gold strategy (research-30 on GC=F, blind-tested 59.2% win rate, +$4,419/yr annualized) - the strongest validated concept in this project. Silver has had only one prior strategy tried (a Bollinger%B+Stochastic mean-reversion fade). Port the DI-Dominance concept unchanged to test whether the trend-following edge transfers to silver, which correlates with but trades differently than gold (higher volatility, more industrial-demand driven). Tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade.

## Logic

```js
var n = snaps.length;
var cur = snaps[n - 1];
var prev = snaps[n - 2];
if (!cur || !prev) return null;
if (cur.sma20 == null || cur.atr == null || cur.rsi == null || cur.price == null) return null;
if (prev.price == null || prev.rsi == null) return null;
if (cur.adx == null || cur.plusDI == null || cur.minusDI == null) return null;
var bandMult = 2.2;
var upperBand = cur.sma20 + bandMult * cur.atr;
var lowerBand = cur.sma20 - bandMult * cur.atr;
var trendFilterAdx = 25;
var strongDowntrend = cur.adx > trendFilterAdx && cur.minusDI > cur.plusDI;
var strongUptrend = cur.adx > trendFilterAdx && cur.plusDI > cur.minusDI;
var rsiTurningUp = cur.rsi > prev.rsi;
var rsiTurningDown = cur.rsi < prev.rsi;
if (cur.price <= lowerBand && cur.rsi < 22 && prev.price > lowerBand && !strongDowntrend && rsiTurningUp) {
  return { side: "long", note: "Fresh close below -2.2ATR band, RSI=" + cur.rsi.toFixed(1) + " deeply oversold & turning up, no downtrend (ADX=" + cur.adx.toFixed(1) + ")" };
}
if (cur.price >= upperBand && cur.rsi > 78 && prev.price < upperBand && !strongUptrend && rsiTurningDown) {
  return { side: "short", note: "Fresh close above +2.2ATR band, RSI=" + cur.rsi.toFixed(1) + " deeply overbought & turning down, no uptrend (ADX=" + cur.adx.toFixed(1) + ")" };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 0 trades, 0.0% win rate, profit factor n/a, total P/L $0.00, Sharpe n/a.

## Live status

Rejected after review - not live. From research run #61.
