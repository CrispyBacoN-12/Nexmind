---
type: strategy
key: research-96
status: rejected
symbol: "MSFT"
timeframe: "1d"
tags: [strategy, research, sma, rsi, adx, atr]
---

# ADX-Filtered Mean-Reversion Fade (sma20 stretch + RSI extreme)

52-week-high breakout momentum entry signal for MSFT (large-cap, never tested in this project) on DAILY bars: a classic momentum-breakout mechanism never tried in this project - price closing at or near its highest close of the trailing ~252 daily bars, confirmed by volume at least 1.5x the trailing 50-day average volume. Compute the rolling high and average volume yourself from the raw bars array (there is no pre-built 52-week-high field in the snapshot data). Tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, win rate >50% with profit stable across both halves of a 5-year sample. Every equity strategy tried so far in this project used 1h/DI-dominance or a pullback concept - this is a fresh breakout mechanism on a fresh symbol and a lower-noise timeframe.

## Logic

```js
var n = bars.length;
if (n < 55) return null;
var i = n - 1;
var cur = bars[i];
var snap = snaps[i];
var prevSnap = snaps[i - 1];
if (!snap || snap.sma20 == null || snap.rsi == null || snap.adx == null || snap.atr == null) return null;
if (!prevSnap || prevSnap.rsi == null) return null;
if (snap.sma20 === 0 || snap.atr <= 0) return null;

var distAtr = (cur.c - snap.sma20) / snap.atr;
var rangingMarket = snap.adx < 25;

if (rangingMarket && distAtr > 1.3 && snap.rsi > 65 && snap.rsi < prevSnap.rsi) {
  return {
    side: "short",
    note: "Mean-reversion fade: price " + distAtr.toFixed(2) + "xATR above sma20, RSI " + snap.rsi.toFixed(1) + " overbought and rolling over (prev " + prevSnap.rsi.toFixed(1) + "), ADX " + snap.adx.toFixed(1) + " (ranging). SL 1.5xATR/TP 1.2xATR."
  };
}
if (rangingMarket && distAtr < -1.3 && snap.rsi < 35 && snap.rsi > prevSnap.rsi) {
  return {
    side: "long",
    note: "Mean-reversion fade: price " + Math.abs(distAtr).toFixed(2) + "xATR below sma20, RSI " + snap.rsi.toFixed(1) + " oversold and turning up (prev " + prevSnap.rsi.toFixed(1) + "), ADX " + snap.adx.toFixed(1) + " (ranging). SL 1.5xATR/TP 1.2xATR."
  };
}
return null;
```

## Backtest history

- Research pipeline backtest (5y, 1d): 11 trades, 36.4% win rate, profit factor 0.40, total P/L $-5.48, Sharpe -7.10.

## Live status

Rejected after review - not live. From research run #62.
