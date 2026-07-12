---
type: strategy
key: research-47
status: proposed
symbol: "GC=F"
timeframe: "1d"
tags: [strategy, research, rsi, adx, di, macd, atr, gold]
---

# ATR Squeeze Breakout (Volatility Expansion Entry)

Gold (GC=F) daily-bar entry signal for the live paper desk (Gold Desk), which currently combines Swing Trend Continuation + Trend-pullback + Dip Buy (vote>=2) � all three are trend/pullback-oriented and only fire when ADX>25ish or an uptrend pullback. Propose a genuinely different entry idea that can catch setups during choppy/ranging regimes (low ADX, sideways daily gold) where the current combo stays flat, WITHOUT falling into the known dead end: a naive ATR-Band Mean Reversion / VAL-VAH range fade already backtested as a structural loser on GC=F daily bars (profit factor 0.67-0.94 at every tp1Mult tried). Find something with real edge � win rate >50% and consistent profit � using OHLCV/indicators only, on daily gold candles.

## Logic

```js
var n = bars.length - 1;
var LB = 10;
var AP = 20;
if (n < AP + LB) return null;
var snap = snaps[n];
if (!snap || snap.atr == null || snap.plusDI == null || snap.minusDI == null || snap.adx == null || snap.rsi == null || snap.macdHist == null) return null;
var atrSum = 0;
var cnt = 0;
for (var i = n - AP; i < n; i++) {
  if (snaps[i] && snaps[i].atr != null) { atrSum += snaps[i].atr; cnt++; }
}
if (cnt < 12) return null;
var avgAtr = atrSum / cnt;
if (snap.atr >= avgAtr * 0.85) return null;
var hiN = -Infinity;
var loN = Infinity;
for (var j = n - LB; j < n; j++) {
  if (bars[j].h > hiN) hiN = bars[j].h;
  if (bars[j].l < loN) loN = bars[j].l;
}
var bar = bars[n];
var diDiff = snap.plusDI - snap.minusDI;
if (bar.c > hiN && diDiff > 8 && snap.adx > 20 && snap.rsi > 47 && snap.rsi < 74 && snap.macdHist > 0) {
  return { side: "long", note: "ATR squeeze breakout long: ATR " + snap.atr.toFixed(2) + " vs avg " + avgAtr.toFixed(2) + ", +DI-DI=" + diDiff.toFixed(1) + ", ADX=" + snap.adx.toFixed(1) + ", RSI=" + snap.rsi.toFixed(1) };
}
if (bar.c < loN && diDiff < -8 && snap.adx > 20 && snap.rsi < 53 && snap.rsi > 26 && snap.macdHist < 0) {
  return { side: "short", note: "ATR squeeze breakout short: ATR " + snap.atr.toFixed(2) + " vs avg " + avgAtr.toFixed(2) + ", +DI-DI=" + diDiff.toFixed(1) + ", ADX=" + snap.adx.toFixed(1) + ", RSI=" + snap.rsi.toFixed(1) };
}
return null;
```

## Backtest history

- Research pipeline backtest (5y, 1d): 2 trades, 0.0% win rate, profit factor 0.00, total P/L $-32.77, Sharpe -49.61.

## Live status

Proposed candidate, not yet reviewed. From research run #20.
