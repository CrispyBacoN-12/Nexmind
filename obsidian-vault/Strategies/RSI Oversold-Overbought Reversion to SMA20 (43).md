---
type: strategy
key: research-43
status: rejected
symbol: "BTC-USD"
timeframe: "15m"
tags: [strategy, research, sma, rsi, adx, atr]
---

# RSI Oversold/Overbought Reversion to SMA20

Entry signal for BTC-USD day-trading on 15-minute bars. Trade ONLY between 08:00 and 16:00 Thailand time (UTC+7). bars[i].t is a Unix timestamp in seconds (UTC) - compute the local hour as (new Date(bars[i].t*1000).getUTCHours() + 7) % 24 and return null when that hour is outside [8, 16). No overnight holds: any position still open gets force-closed externally at 16:00, so focus purely on a high-quality intraday entry signal, not exit logic. The backtester applies a tight single-target ladder (SL=1.5xATR, TP=1.2xATR) automatically - design entries that work with a target roughly the same size as the stop (quick intraday moves), not a distant multi-hour swing target. Win rate >50% with profit stable across the sample, not just a good average.

## Logic

```js
const n = bars.length;
if (n < 3) return null;
const bar = bars[n-1];
const prevBar = bars[n-2];
const snap = snaps[n-1];
const prevSnap = snaps[n-2];
if (!snap.rsi || !snap.sma20 || !snap.atr || !snap.adx || !prevSnap.rsi) return null;
const hour = (new Date(bar.t * 1000).getUTCHours() + 7) % 24;
if (hour < 8 || hour >= 17) return null;
if (snap.adx > 28) return null;
const dist = snap.price - snap.sma20;
const atr = snap.atr;
if (snap.rsi < 35 && prevSnap.rsi < 42 && dist < -1.0 * atr && bar.c > bar.o) {
  return { side: "long", note: "Oversold reversion: RSI=" + snap.rsi.toFixed(1) + " dist=" + (dist/atr).toFixed(2) + "xATR ADX=" + snap.adx.toFixed(1) };
}
if (snap.rsi > 65 && prevSnap.rsi > 58 && dist > 1.0 * atr && bar.c < bar.o) {
  return { side: "short", note: "Overbought reversion: RSI=" + snap.rsi.toFixed(1) + " dist=" + (dist/atr).toFixed(2) + "xATR ADX=" + snap.adx.toFixed(1) };
}
return null;
```

## Backtest history

- Research pipeline backtest (1mo, 15m): 8 trades, 50.0% win rate, profit factor 0.42, total P/L $-95.18, Sharpe -6.40.

## Live status

Rejected after review - not live. From research run #19.
