---
type: strategy
key: research-45
status: proposed
symbol: "GC=F"
timeframe: "1d"
tags: [strategy, research, rsi, adx, macd, gold]
---

# RSI-50 Momentum Flip (Low-ADX Ranging Regime)

Gold (GC=F) daily-bar entry signal for the live paper desk (Gold Desk), which currently combines Swing Trend Continuation + Trend-pullback + Dip Buy (vote>=2) � all three are trend/pullback-oriented and only fire when ADX>25ish or an uptrend pullback. Propose a genuinely different entry idea that can catch setups during choppy/ranging regimes (low ADX, sideways daily gold) where the current combo stays flat, WITHOUT falling into the known dead end: a naive ATR-Band Mean Reversion / VAL-VAH range fade already backtested as a structural loser on GC=F daily bars (profit factor 0.67-0.94 at every tp1Mult tried). Find something with real edge � win rate >50% and consistent profit � using OHLCV/indicators only, on daily gold candles.

## Logic

```js
var n = bars.length - 1;
if (n < 6) return null;
var snap = snaps[n];
var prev = snaps[n - 1];
var prev2 = snaps[n - 2];
if (!snap || !prev || !prev2) return null;
if (snap.rsi == null || prev.rsi == null || snap.adx == null || snap.macdHist == null || prev.macdHist == null || prev2.macdHist == null) return null;
if (snap.adx > 18) return null;
var bar = bars[n];
var rng = bar.h - bar.l;
var closePos = rng > 0 ? (bar.c - bar.l) / rng : 0.5;
var rsiWasLow = false;
var rsiWasHigh = false;
for (var i = n - 5; i < n; i++) {
  if (snaps[i] && snaps[i].rsi != null) {
    if (snaps[i].rsi < 42) rsiWasLow = true;
    if (snaps[i].rsi > 58) rsiWasHigh = true;
  }
}
var macdAccelLong = snap.macdHist > prev.macdHist && prev.macdHist > prev2.macdHist && snap.macdHist > 0;
var macdAccelShort = snap.macdHist < prev.macdHist && prev.macdHist < prev2.macdHist && snap.macdHist < 0;
if (prev.rsi < 50 && snap.rsi >= 50 && macdAccelLong && closePos >= 0.63 && rsiWasLow) {
  return { side: "long", note: "RSI flip " + snap.rsi.toFixed(1) + " ADX " + snap.adx.toFixed(1) + " MACD " + snap.macdHist.toFixed(2) };
}
if (prev.rsi > 50 && snap.rsi <= 50 && macdAccelShort && closePos <= 0.37 && rsiWasHigh) {
  return { side: "short", note: "RSI flip " + snap.rsi.toFixed(1) + " ADX " + snap.adx.toFixed(1) + " MACD " + snap.macdHist.toFixed(2) };
}
return null;
```

## Backtest history

- Research pipeline backtest (5y, 1d): 4 trades, 0.0% win rate, profit factor 0.00, total P/L $-20.63, Sharpe -30.33.

## Live status

Proposed candidate, not yet reviewed. From research run #20.
