---
type: strategy
key: research-44
status: proposed
symbol: "BTC-USD"
timeframe: "15m"
tags: [strategy, research, sma, rsi, adx, di, atr]
---

# 8-Bar Compression Breakout with Volume Expansion

Entry signal for BTC-USD day-trading on 15-minute bars. Trade ONLY between 08:00 and 16:00 Thailand time (UTC+7). bars[i].t is a Unix timestamp in seconds (UTC) - compute the local hour as (new Date(bars[i].t*1000).getUTCHours() + 7) % 24 and return null when that hour is outside [8, 16). No overnight holds: any position still open gets force-closed externally at 16:00, so focus purely on a high-quality intraday entry signal, not exit logic. The backtester applies a tight single-target ladder (SL=1.5xATR, TP=1.2xATR) automatically - design entries that work with a target roughly the same size as the stop (quick intraday moves), not a distant multi-hour swing target. Win rate >50% with profit stable across the sample, not just a good average.

## Logic

```js
const n = bars.length;
if (n < 50) return null;
const bar = bars[n-1];
const snap = snaps[n-1];
const hour = (new Date(bar.t * 1000).getUTCHours() + 7) % 24;
if (hour < 8 || hour >= 16) return null;
if (!snap.atr || !snap.sma20 || !snap.rsi || !snap.adx || !snap.plusDI || !snap.minusDI) return null;

const lb = 8;
let hi = -Infinity, lo = Infinity, avgVol = 0;
for (let i = n-1-lb; i < n-1; i++) {
  if (bars[i].h > hi) hi = bars[i].h;
  if (bars[i].l < lo) lo = bars[i].l;
  avgVol += bars[i].v;
}
avgVol /= lb;

const range = hi - lo;
// Tighter compression — 1.2x ATR instead of 1.5x removes low-conviction setups
if (range > snap.atr * 1.2) return null;

const buf = snap.atr * 0.15;
// Anti-chase: reject if close already ran >0.5 ATR past the range edge (entered too late)
const maxExtension = snap.atr * 0.5;

// Long: above SMA20, DI aligned, ADX trending, RSI in momentum band (not overbought), strong vol, not over-extended
if (
  bar.c > hi + buf &&
  bar.c < hi + buf + maxExtension &&
  bar.v > avgVol * 2.0 &&
  bar.c > snap.sma20 &&
  snap.rsi > 52 && snap.rsi < 70 &&
  snap.adx > 20 &&
  snap.plusDI > snap.minusDI
) {
  return { side: "long", note: "Compression breakout above " + hi.toFixed(0) + ", range=" + (range/snap.atr).toFixed(2) + "xATR, vol=" + (bar.v/avgVol).toFixed(1) + "x, rsi=" + snap.rsi.toFixed(0) + ", adx=" + snap.adx.toFixed(0) };
}
// Short: below SMA20, DI aligned, ADX trending, RSI in momentum band (not oversold), strong vol, not over-extended
if (
  bar.c < lo - buf &&
  bar.c > lo - buf - maxExtension &&
  bar.v > avgVol * 2.0 &&
  bar.c < snap.sma20 &&
  snap.rsi < 48 && snap.rsi > 30 &&
  snap.adx > 20 &&
  snap.minusDI > snap.plusDI
) {
  return { side: "short", note: "Compression breakdown below " + lo.toFixed(0) + ", range=" + (range/snap.atr).toFixed(2) + "xATR, vol=" + (bar.v/avgVol).toFixed(1) + "x, rsi=" + snap.rsi.toFixed(0) + ", adx=" + snap.adx.toFixed(0) };
}
return null;
```

## Backtest history

- Research pipeline backtest (1mo, 15m): 0 trades, 0.0% win rate, profit factor n/a, total P/L $0.00, Sharpe n/a.

## Live status

Proposed candidate, not yet reviewed. From research run #19.
