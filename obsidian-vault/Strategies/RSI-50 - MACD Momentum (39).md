---
type: strategy
key: research-39
status: rejected
symbol: "GC=F"
timeframe: "15m"
tags: [strategy, research, sma, rsi, adx, di, macd, atr, gold]
---

# RSI-50 / MACD Momentum

Entry signal for gold futures (GC=F) day-trading on 15-minute bars. Trade ONLY between 08:00 and 16:00 Thailand time (UTC+7). bars[i].t is a Unix timestamp in seconds (UTC) - compute the local hour as (new Date(bars[i].t*1000).getUTCHours() + 7) % 24 and return null when that hour is outside [8, 16). No overnight holds: any position still open gets force-closed externally at 16:00, so focus purely on a high-quality intraday entry signal, not exit logic. The backtester applies a tight single-target ladder (SL=1.5xATR, TP=1.2xATR) automatically - design entries that work with a target roughly the same size as the stop (quick intraday moves), not a distant multi-hour swing target. Win rate >50% with profit stable across the sample, not just a good average.

## Logic

```js
const n = bars.length;
const bar = bars[n-1];
const snap = snaps[n-1];
const prev = snaps[n-2];
const prev2 = n >= 3 ? snaps[n-3] : null;

const localHour = (new Date(bar.t*1000).getUTCHours()+7)%24;
if (localHour < 7 || localHour >= 16) return null;

if (!snap || !prev || !prev2) return null;
if (snap.rsi == null || prev.rsi == null || prev2.rsi == null) return null;
if (snap.macdHist == null || prev.macdHist == null) return null;
if (snap.adx == null || snap.plusDI == null || snap.minusDI == null) return null;
if (snap.sma50 == null || snap.atr == null) return null;

if (snap.adx < 20) return null;

// RSI trending in direction over 2 bars, above/below threshold
const rsiMomUp = snap.rsi > 52 && snap.rsi > prev.rsi && prev.rsi > prev2.rsi;
const rsiMomDn = snap.rsi < 48 && snap.rsi < prev.rsi && prev.rsi < prev2.rsi;

// MACD aligned and accelerating (removed ATR minimum — was too restrictive)
const macdUp = snap.macdHist > 0 && snap.macdHist > prev.macdHist;
const macdDn = snap.macdHist < 0 && snap.macdHist < prev.macdHist;

// Relaxed DI gap: 3 instead of 5
const diLong = snap.plusDI > snap.minusDI + 3;
const diShort = snap.minusDI > snap.plusDI + 3;

if (rsiMomUp && macdUp && diLong && bar.c > snap.sma50) {
  return { side: 'long', note: 'RSI mom+ + MACD+ + +DI dom + above SMA50, ADX=' + snap.adx.toFixed(1) };
}
if (rsiMomDn && macdDn && diShort && bar.c < snap.sma50) {
  return { side: 'short', note: 'RSI mom- + MACD- + -DI dom + below SMA50, ADX=' + snap.adx.toFixed(1) };
}
return null;
```

## Backtest history

- Research pipeline backtest (1mo, 15m): 45 trades, 53.3% win rate, profit factor 0.29, total P/L $-36.69, Sharpe -10.99.

## Live status

Rejected after review - not live. From research run #18.
