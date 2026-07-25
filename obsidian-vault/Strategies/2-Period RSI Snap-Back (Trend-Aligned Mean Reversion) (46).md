---
type: strategy
key: research-46
status: rejected
symbol: "GC=F"
timeframe: "1d"
tags: [strategy, research, sma, adx, atr, gold]
---

# 2-Period RSI Snap-Back (Trend-Aligned Mean Reversion)

Gold (GC=F) daily-bar entry signal for the live paper desk (Gold Desk), which currently combines Swing Trend Continuation + Trend-pullback + Dip Buy (vote>=2) � all three are trend/pullback-oriented and only fire when ADX>25ish or an uptrend pullback. Propose a genuinely different entry idea that can catch setups during choppy/ranging regimes (low ADX, sideways daily gold) where the current combo stays flat, WITHOUT falling into the known dead end: a naive ATR-Band Mean Reversion / VAL-VAH range fade already backtested as a structural loser on GC=F daily bars (profit factor 0.67-0.94 at every tp1Mult tried). Find something with real edge � win rate >50% and consistent profit � using OHLCV/indicators only, on daily gold candles.

## Logic

```js
var n = bars.length - 1;
if (n < 10) return null;
var snap = snaps[n];
if (!snap || snap.adx == null || snap.sma50 == null || snap.atr == null) return null;

// Stricter ranging-market filter
if (snap.adx > 20) return null;

// Require meaningful volatility
if (snap.atr < bars[n].c * 0.003) return null;

// 2-bar RSI
var d1 = bars[n].c - bars[n - 1].c;
var d2 = bars[n - 1].c - bars[n - 2].c;
var avgG = (Math.max(0, d1) + Math.max(0, d2)) / 2;
var avgL = (Math.max(0, -d1) + Math.max(0, -d2)) / 2;
var r2 = avgL === 0 ? (avgG === 0 ? 50 : 100) : 100 - 100 / (1 + avgG / avgL);

var mid = (bars[n].h + bars[n].l) / 2;

// Long: extreme oversold, both recent bars explicitly down, above SMA50, current bar closes above its midpoint
if (r2 < 3 && d1 < 0 && d2 < 0 && bars[n].c > snap.sma50 && bars[n].c > mid) {
  return { side: "long", note: "2-RSI=" + r2.toFixed(1) + " extreme oversold, 2 confirmed down bars, above SMA50, close off low — snap-back long" };
}

// Short: extreme overbought, both recent bars explicitly up, below SMA50, current bar closes below its midpoint
if (r2 > 97 && d1 > 0 && d2 > 0 && bars[n].c < snap.sma50 && bars[n].c < mid) {
  return { side: "short", note: "2-RSI=" + r2.toFixed(1) + " extreme overbought, 2 confirmed up bars, below SMA50, close off high — snap-back short" };
}

return null;
```

## Backtest history

- Research pipeline backtest (5y, 1d): 10 trades, 50.0% win rate, profit factor 1.00, total P/L $-0.00, Sharpe -0.00.

## Live status

Rejected after review - not live. From research run #20.
