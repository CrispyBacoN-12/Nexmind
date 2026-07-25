---
type: strategy
key: research-42
status: rejected
symbol: "BTC-USD"
timeframe: "15m"
tags: [strategy, research, sma, rsi, adx, di, macd, atr]
---

# ADX/DI Momentum Cross

Entry signal for BTC-USD day-trading on 15-minute bars. Trade ONLY between 08:00 and 16:00 Thailand time (UTC+7). bars[i].t is a Unix timestamp in seconds (UTC) - compute the local hour as (new Date(bars[i].t*1000).getUTCHours() + 7) % 24 and return null when that hour is outside [8, 16). No overnight holds: any position still open gets force-closed externally at 16:00, so focus purely on a high-quality intraday entry signal, not exit logic. The backtester applies a tight single-target ladder (SL=1.5xATR, TP=1.2xATR) automatically - design entries that work with a target roughly the same size as the stop (quick intraday moves), not a distant multi-hour swing target. Win rate >50% with profit stable across the sample, not just a good average.

## Logic

```js
const n = bars.length;
if (n < 5) return null;
const bar = bars[n-1];
const snap = snaps[n-1];
const prev = snaps[n-2];
const prev2 = snaps[n-3];

// Trading window: avoid open/close noise (UTC+7)
const hour = (new Date(bar.t * 1000).getUTCHours() + 7) % 24;
if (hour < 9 || hour >= 15) return null;

// Require all needed indicators
if (!snap.adx || !snap.plusDI || !snap.minusDI) return null;
if (!prev.adx || !prev.plusDI || !prev.minusDI) return null;
if (!prev2.plusDI || !prev2.minusDI) return null;
if (!snap.rsi || !snap.sma50 || !snap.macdHist || prev.macdHist == null) return null;
if (!snap.atr) return null;

// Strong trend AND strengthening — a fading ADX means the move is exhausting
if (snap.adx < 25) return null;
if (snap.adx < prev.adx) return null;

// Require meaningful DI separation to avoid hair-trigger flips
const diSep = Math.abs(snap.plusDI - snap.minusDI);
if (diSep < 3) return null;

// Long: DI+ crosses above DI-, preceded by at least 2 bars of DI- dominance
if (prev.plusDI <= prev.minusDI && snap.plusDI > snap.minusDI) {
  // Reject if prev2 was already crossed — only enter first clean crossover
  if (prev2.plusDI >= prev2.minusDI) return null;
  // Price must be in uptrend context
  if (bar.c < snap.sma50) return null;
  // RSI confirms momentum — tighter window, no overbought entries
  if (snap.rsi < 50 || snap.rsi > 65) return null;
  // MACD histogram must be positive — no longer allow "rising toward zero"
  if (snap.macdHist <= 0) return null;
  // Anti-chase: don't enter if price has already run more than 1.5 ATR above SMA
  if (bar.c > snap.sma50 + 1.5 * snap.atr) return null;
  return { side: "long", note: "DI+ cross, ADX=" + snap.adx.toFixed(1) + " RSI=" + snap.rsi.toFixed(1) + " sep=" + diSep.toFixed(1) };
}

// Short: DI- crosses above DI+, preceded by at least 2 bars of DI+ dominance
if (prev.minusDI <= prev.plusDI && snap.minusDI > snap.plusDI) {
  // Reject if prev2 was already crossed
  if (prev2.minusDI >= prev2.plusDI) return null;
  // Price must be in downtrend context
  if (bar.c > snap.sma50) return null;
  // RSI confirms momentum — tighter window, no oversold entries
  if (snap.rsi > 50 || snap.rsi < 35) return null;
  // MACD histogram must be negative
  if (snap.macdHist >= 0) return null;
  // Anti-chase: don't enter if price has already dropped more than 1.5 ATR below SMA
  if (bar.c < snap.sma50 - 1.5 * snap.atr) return null;
  return { side: "short", note: "DI- cross, ADX=" + snap.adx.toFixed(1) + " RSI=" + snap.rsi.toFixed(1) + " sep=" + diSep.toFixed(1) };
}

return null;
```

## Backtest history

- Research pipeline backtest (1mo, 15m): 0 trades, 0.0% win rate, profit factor n/a, total P/L $0.00, Sharpe n/a.

## Live status

Rejected after review - not live. From research run #19.
