---
type: strategy
key: research-104
status: rejected
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, sma, rsi, adx, di, gold]
---

# VWAP Deviation Mean-Reversion (RSI-confirmed)

VWAP deviation mean-reversion on GOLD (GC=F) 1h bars - a mechanism never tried in this project (only DI-dominance, pullback, liquidity-sweep, engulfing/candlestick, Donchian breakout, and Bollinger squeeze have been tested here). Use vwapDevPct from the snapshot directly: when price deviates more than a threshold (e.g. 0.5-0.8%) below VWAP, go long expecting reversion to VWAP; when more than that threshold above VWAP, go short. IMPORTANT: keep the entry logic to just 1-2 conditions (the VWAP deviation threshold, optionally one RSI extreme confirmation) - do NOT stack four or five simultaneous filters, since every strategy tried so far this session with heavy filter-stacking produced fewer than 15 trades and was statistically untrustworthy. The goal this round is a higher-frequency, simpler signal with an adequate sample size. Tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, target win rate >50%.

## Logic

```js
const i = bars.length - 1;
const snap = snaps[i];
const prev = snaps[i - 1];
if (!snap || !prev) return null;
if (snap.sma20 == null || snap.rsi == null || snap.price == null || prev.rsi == null) return null;

const dev = ((snap.price - snap.sma20) / snap.sma20) * 100;
const THRESH = 1.0;

// Stricter trend filter: bail on anything but a genuinely flat/choppy tape
if (snap.adx != null && snap.adx > 22) return null;

// Require RSI to already be turning back from the extreme (exhaustion),
// not just crossing the threshold, to avoid catching a falling/rising knife
const rsiTurningUp = snap.rsi > prev.rsi;
const rsiTurningDown = snap.rsi < prev.rsi;

// Avoid fading into a still-strongly-directional DI spread even when ADX is low
const diOk = snap.plusDI == null || snap.minusDI == null || Math.abs(snap.plusDI - snap.minusDI) < 12;

if (dev <= -THRESH && snap.rsi < 30 && rsiTurningUp && diOk) {
  return { side: "long", note: "Mean-reversion long: " + dev.toFixed(2) + "% below SMA20, RSI " + snap.rsi.toFixed(1) + " turning up" };
}
if (dev >= THRESH && snap.rsi > 70 && rsiTurningDown && diOk) {
  return { side: "short", note: "Mean-reversion short: " + dev.toFixed(2) + "% above SMA20, RSI " + snap.rsi.toFixed(1) + " turning down" };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 2 trades, 0.0% win rate, profit factor 0.00, total P/L $-6.83, Sharpe -115.66.

## Live status

Rejected after review - not live. From research run #65.
