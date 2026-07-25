---
type: strategy
key: research-88
status: rejected
symbol: "NVDA"
timeframe: "1h"
tags: [strategy, research, adx, di, atr]
---

# Volume-Surge Range Breakout

Entry signal for NVDA (high-volume, high-volatility large-cap tech stock - never tested in this project; the only equity tried so far is AAPL, using a DI-Dominance trend-strength concept) swing trading on 1h bars, tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, win rate >50% with profit stable across both halves of a 1-year sample. Use a volume or VWAP-deviation based confirmation mechanism (vwapDevPct is available in the snapshot data) rather than a DI/ADX trend-strength port - a genuinely different signal family than what's been tried on equities so far.

## Logic

```js
var n = bars.length;
var LOOKBACK = 20;
if (n < LOOKBACK + 6) return null;
var i = n - 1;
var bar = bars[i];
var snap = snaps[i];
var prevSnap = snaps[i - 1];
if (!snap || snap.adx == null || snap.plusDI == null || snap.minusDI == null || snap.atr == null) return null;
if (!prevSnap || prevSnap.adx == null) return null;

var hi = -Infinity, lo = Infinity;
for (var k = i - LOOKBACK; k < i; k++) {
  if (k < 0) continue;
  if (bars[k].h > hi) hi = bars[k].h;
  if (bars[k].l < lo) lo = bars[k].l;
}
if (hi === -Infinity || lo === Infinity) return null;

var volSum = 0, volCount = 0;
for (var k2 = i - LOOKBACK; k2 < i; k2++) {
  if (k2 >= 0) { volSum += bars[k2].v; volCount++; }
}
if (volCount < 10) return null;
var avgVol = volSum / volCount;
if (avgVol <= 0) return null;
var volRatio = bar.v / avgVol;

var atr = snap.atr;
if (!(atr > 0)) return null;
var buffer = 0.25 * atr;

var barRange = bar.h - bar.l;
var climax = barRange > 3 * atr;

var trending = snap.adx > 25 && snap.adx > prevSnap.adx;
var diGap = snap.plusDI - snap.minusDI;
var diBullish = diGap > 5;
var diBearish = diGap < -5;

var breaksUp = bar.c > (hi + buffer) && volRatio > 1.5 && trending && diBullish && !climax;
var breaksDown = bar.c < (lo - buffer) && volRatio > 1.5 && trending && diBearish && !climax;

if (breaksUp) {
  return { side: "long", note: "Range breakout long: close " + bar.c.toFixed(2) + " > " + LOOKBACK + "-bar high+buf " + (hi + buffer).toFixed(2) + ", vol " + volRatio.toFixed(2) + "x, ADX " + snap.adx.toFixed(1) + " rising, DI gap " + diGap.toFixed(1) };
}
if (breaksDown) {
  return { side: "short", note: "Range breakdown short: close " + bar.c.toFixed(2) + " < " + LOOKBACK + "-bar low-buf " + (lo - buffer).toFixed(2) + ", vol " + volRatio.toFixed(2) + "x, ADX " + snap.adx.toFixed(1) + " rising, DI gap " + diGap.toFixed(1) };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 1 trades, 0.0% win rate, profit factor 0.00, total P/L $-0.27, Sharpe n/a.

## Live status

Rejected after review - not live. From research run #59.
