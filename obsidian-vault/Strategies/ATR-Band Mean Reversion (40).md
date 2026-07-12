---
type: strategy
key: research-40
status: proposed
symbol: "GC=F"
timeframe: "15m"
tags: [strategy, research, sma, rsi, adx, atr, gold]
---

# ATR-Band Mean Reversion

Entry signal for gold futures (GC=F) day-trading on 15-minute bars. Trade ONLY between 08:00 and 16:00 Thailand time (UTC+7). bars[i].t is a Unix timestamp in seconds (UTC) - compute the local hour as (new Date(bars[i].t*1000).getUTCHours() + 7) % 24 and return null when that hour is outside [8, 16). No overnight holds: any position still open gets force-closed externally at 16:00, so focus purely on a high-quality intraday entry signal, not exit logic. The backtester applies a tight single-target ladder (SL=1.5xATR, TP=1.2xATR) automatically - design entries that work with a target roughly the same size as the stop (quick intraday moves), not a distant multi-hour swing target. Win rate >50% with profit stable across the sample, not just a good average.

## Logic

```js
const n = bars.length;
const bar = bars[n-1];
const snap = snaps[n-1];
const prev = snaps[n-2];

const localHour = (new Date(bar.t*1000).getUTCHours()+7)%24;
if (localHour < 8 || localHour >= 17) return null;

if (!snap || !prev || snap.sma20 == null || snap.rsi == null || snap.atr == null || snap.adx == null || prev.rsi == null) return null;

// Relaxed ranging filter — ADX <= 25 captures more sideways phases
if (snap.adx > 25) return null;

const dev = (bar.c - snap.sma20) / snap.atr;

// 1.5x ATR extreme + loosened RSI thresholds + single-bar RSI turn confirmation
if (dev <= -1.5 && snap.rsi < 36 && snap.rsi > prev.rsi) {
  return { side: 'long', note: 'Dev=' + dev.toFixed(2) + 'xATR below SMA20, RSI=' + snap.rsi.toFixed(1) + ' turning up' };
}
if (dev >= 1.5 && snap.rsi > 64 && snap.rsi < prev.rsi) {
  return { side: 'short', note: 'Dev=' + dev.toFixed(2) + 'xATR above SMA20, RSI=' + snap.rsi.toFixed(1) + ' turning down' };
}
return null;
```

## Backtest history

- Research pipeline backtest (1mo, 15m): 2 trades, 50.0% win rate, profit factor 0.32, total P/L $-1.49, Sharpe -8.25.

## Live status

Proposed candidate, not yet reviewed. From research run #18.
