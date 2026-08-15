---
type: strategy
key: research-132
status: rejected
symbol: "NG=F"
timeframe: "1h"
tags: [strategy, research, sma, rsi, adx, macd, atr]
---

# Mean-Reversion: RSI Crossback + ATR-Stretch from SMA20

DI-Dominance Widening entry signal (fires whenever the +DI/-DI gap is widening while ADX >= 20, no fresh crossover required - the same logic behind the live gold strategy research-30: 695 trades, 57.3% win rate, approved) for NG=F (natural gas futures) 1h/1y. This is a genuinely fresh symbol test: natural gas has never been tried in this project, and DI-Dominance Widening is the single strongest validated concept here, already ported to SI=F (rejected, both attempts had thin trade counts or negative expectancy) and CL=F (crossover variant, rejected, trades too thin). Natural gas is a classically trend-prone commodity like gold, so this checks whether the mechanism generalizes to a third commodity. Tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, target win rate >50%, adequate trade count (widen range if signal is rare).

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], sp = snaps[i - 1];
if (!s || !sp) return null;
if (s.rsi == null || sp.rsi == null || s.sma20 == null || s.sma50 == null || s.atr == null || s.price == null || s.adx == null) return null;
if (s.atr <= 0) return null;
var stretch = (s.price - s.sma20) / s.atr;
var regimeOk = s.adx < 30 && s.adx > 12;
if (stretch <= -1.5 && stretch > -4 && sp.rsi < 30 && s.rsi >= 30 && regimeOk) {
  var trendOkLong = s.sma20 >= s.sma50;
  var momOkLong = s.macdHist != null && sp.macdHist != null ? s.macdHist > sp.macdHist : true;
  if (trendOkLong && momOkLong) {
    return { side: "long", note: "RSI crossback up from oversold, stretch " + stretch.toFixed(2) + "xATR below SMA20, ADX " + s.adx.toFixed(1) + ", pullback in uptrend" };
  }
}
if (stretch >= 1.5 && stretch < 4 && sp.rsi > 70 && s.rsi <= 70 && regimeOk) {
  var trendOkShort = s.sma20 <= s.sma50;
  var momOkShort = s.macdHist != null && sp.macdHist != null ? s.macdHist < sp.macdHist : true;
  if (trendOkShort && momOkShort) {
    return { side: "short", note: "RSI crossback down from overbought, stretch " + stretch.toFixed(2) + "xATR above SMA20, ADX " + s.adx.toFixed(1) + ", rally in downtrend" };
  }
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 2 trades, 50.0% win rate, profit factor 1.16, total P/L $0.00, Sharpe 1.16.

## Live status

Rejected after review - not live. From research run #75.
