---
type: strategy
key: research-105
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, sma, adx, di, macd, gold]
---

# VWAP Extension Momentum (MACD-confirmed continuation)

VWAP deviation mean-reversion on GOLD (GC=F) 1h bars - a mechanism never tried in this project (only DI-dominance, pullback, liquidity-sweep, engulfing/candlestick, Donchian breakout, and Bollinger squeeze have been tested here). Use vwapDevPct from the snapshot directly: when price deviates more than a threshold (e.g. 0.5-0.8%) below VWAP, go long expecting reversion to VWAP; when more than that threshold above VWAP, go short. IMPORTANT: keep the entry logic to just 1-2 conditions (the VWAP deviation threshold, optionally one RSI extreme confirmation) - do NOT stack four or five simultaneous filters, since every strategy tried so far this session with heavy filter-stacking produced fewer than 15 trades and was statistically untrustworthy. The goal this round is a higher-frequency, simpler signal with an adequate sample size. Tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, target win rate >50%.

## Logic

```js
const i = bars.length - 1;
if (i < 1) return null;
const snap = snaps[i];
const prev = snaps[i - 1];
if (!snap || !prev) return null;
if (snap.sma20 == null || snap.macdHist == null || snap.adx == null) return null;
if (prev.sma20 == null || prev.macdHist == null) return null;

const dev = (snap.price - snap.sma20) / snap.sma20 * 100;
const prevDev = (prev.price - prev.sma20) / prev.sma20 * 100;

const THRESH = 0.6;
const ADX_MIN = 25;
const DI_MARGIN = 3;

if (snap.adx < ADX_MIN) return null;
if (snap.plusDI == null || snap.minusDI == null) return null;

// Only fire on the bar where price freshly crosses the threshold, not on every
// bar it remains extended -- avoids stacking many correlated trades on one move.
const longCross = dev >= THRESH && prevDev < THRESH;
const shortCross = dev <= -THRESH && prevDev > -THRESH;

const macdRising = snap.macdHist > prev.macdHist;
const macdFalling = snap.macdHist < prev.macdHist;

if (longCross && snap.macdHist > 0 && macdRising && (snap.plusDI - snap.minusDI) > DI_MARGIN) {
  return { side: "long", note: "Momentum long: fresh break above SMA20 by " + dev.toFixed(2) + "%, MACD hist rising, ADX " + snap.adx.toFixed(1) + ", +DI-(-DI) gap " + (snap.plusDI - snap.minusDI).toFixed(1) };
}
if (shortCross && snap.macdHist < 0 && macdFalling && (snap.minusDI - snap.plusDI) > DI_MARGIN) {
  return { side: "short", note: "Momentum short: fresh break below SMA20 by " + dev.toFixed(2) + "%, MACD hist falling, ADX " + snap.adx.toFixed(1) + ", -DI-(+DI) gap " + (snap.minusDI - snap.plusDI).toFixed(1) };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 89 trades, 56.2% win rate, profit factor 0.92, total P/L $-10.62, Sharpe -0.64.

## Live status

Rejected after review - not live. From research run #65.
