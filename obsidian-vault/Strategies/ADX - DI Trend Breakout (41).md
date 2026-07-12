---
type: strategy
key: research-41
status: proposed
symbol: "GC=F"
timeframe: "15m"
tags: [strategy, research, sma, rsi, adx, di, macd, gold]
---

# ADX / DI Trend Breakout

Entry signal for gold futures (GC=F) day-trading on 15-minute bars. Trade ONLY between 08:00 and 16:00 Thailand time (UTC+7). bars[i].t is a Unix timestamp in seconds (UTC) - compute the local hour as (new Date(bars[i].t*1000).getUTCHours() + 7) % 24 and return null when that hour is outside [8, 16). No overnight holds: any position still open gets force-closed externally at 16:00, so focus purely on a high-quality intraday entry signal, not exit logic. The backtester applies a tight single-target ladder (SL=1.5xATR, TP=1.2xATR) automatically - design entries that work with a target roughly the same size as the stop (quick intraday moves), not a distant multi-hour swing target. Win rate >50% with profit stable across the sample, not just a good average.

## Logic

```js
const n = bars.length; const bar = bars[n-1]; const snap = snaps[n-1]; const prev = snaps[n-2]; if (n < 4 || !snap || !prev) return null; if (snap.plusDI == null || snap.minusDI == null || snap.adx == null || snap.sma20 == null || snap.rsi == null || snap.macdHist == null || prev.plusDI == null || prev.minusDI == null || prev.adx == null) return null; const p3 = snaps[n-3]; if (!p3 || p3.adx == null) return null; if (snap.adx < 22) return null; const adxRising2 = snap.adx > prev.adx && prev.adx > p3.adx; if (!adxRising2) return null; const bullCross = prev.plusDI <= prev.minusDI && snap.plusDI > snap.minusDI; const bearCross = prev.plusDI >= prev.minusDI && snap.plusDI < snap.minusDI; if (bullCross) { if (bar.c <= snap.sma20) return null; if (snap.rsi > 68) return null; if (snap.macdHist == null || snap.macdHist <= 0) return null; return { side: 'long', note: '+DI cross, ADX=' + snap.adx.toFixed(1) + ' rising2, RSI=' + snap.rsi.toFixed(1) + ', price>SMA20' }; } if (bearCross) { if (bar.c >= snap.sma20) return null; if (snap.rsi < 32) return null; if (snap.macdHist == null || snap.macdHist >= 0) return null; return { side: 'short', note: '-DI cross, ADX=' + snap.adx.toFixed(1) + ' rising2, RSI=' + snap.rsi.toFixed(1) + ', price<SMA20' }; } return null;
```

## Backtest history

- Research pipeline backtest (1mo, 15m): 0 trades, 0.0% win rate, profit factor n/a, total P/L $0.00, Sharpe n/a.

## Live status

Proposed candidate, not yet reviewed. From research run #18.
