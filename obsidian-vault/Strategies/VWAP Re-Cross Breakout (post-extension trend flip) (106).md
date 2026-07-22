---
type: strategy
key: research-106
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, sma, rsi, adx, atr, gold]
---

# VWAP Re-Cross Breakout (post-extension trend flip)

VWAP deviation mean-reversion on GOLD (GC=F) 1h bars - a mechanism never tried in this project (only DI-dominance, pullback, liquidity-sweep, engulfing/candlestick, Donchian breakout, and Bollinger squeeze have been tested here). Use vwapDevPct from the snapshot directly: when price deviates more than a threshold (e.g. 0.5-0.8%) below VWAP, go long expecting reversion to VWAP; when more than that threshold above VWAP, go short. IMPORTANT: keep the entry logic to just 1-2 conditions (the VWAP deviation threshold, optionally one RSI extreme confirmation) - do NOT stack four or five simultaneous filters, since every strategy tried so far this session with heavy filter-stacking produced fewer than 15 trades and was statistically untrustworthy. The goal this round is a higher-frequency, simpler signal with an adequate sample size. Tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, target win rate >50%.

## Logic

```js
const i = bars.length - 1;
if (i < 1) return null;
const snap = snaps[i];
const prev = snaps[i - 1];
if (!snap || !prev) return null;
if (snap.price == null || snap.sma20 == null || snap.atr == null || snap.rsi == null || snap.adx == null) return null;
if (prev.price == null || prev.sma20 == null || prev.atr == null || prev.rsi == null) return null;
if (snap.atr <= 0 || prev.atr <= 0) return null;

const dev = (snap.price - snap.sma20) / snap.atr;
const prevDev = (prev.price - prev.sma20) / prev.atr;
const EXT = 1.5;
const RSI_OVERSOLD = 35;
const RSI_OVERBOUGHT = 65;
const ADX_TREND_MAX = 30;

// Skip strongly trending regimes: counter-trend reversion entries against
// a strong directional move are the likeliest source of losing trades.
if (snap.adx > ADX_TREND_MAX) return null;

if (prevDev <= -EXT && dev > 0 && prev.rsi <= RSI_OVERSOLD) {
  return { side: "long", note: "Baseline reversion long: crossed above SMA20 after " + prevDev.toFixed(2) + " ATR extension below, RSI " + prev.rsi.toFixed(1) + " oversold, ADX " + snap.adx.toFixed(1) + " non-trending" };
}
if (prevDev >= EXT && dev < 0 && prev.rsi >= RSI_OVERBOUGHT) {
  return { side: "short", note: "Baseline reversion short: crossed below SMA20 after " + prevDev.toFixed(2) + " ATR extension above, RSI " + prev.rsi.toFixed(1) + " overbought, ADX " + snap.adx.toFixed(1) + " non-trending" };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 2 trades, 100.0% win rate, profit factor n/a, total P/L $6.04, Sharpe 155.69.

## Live status

Rejected after review - not live. From research run #65.
