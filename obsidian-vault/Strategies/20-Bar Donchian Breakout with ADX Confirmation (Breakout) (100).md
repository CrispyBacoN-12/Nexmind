---
type: strategy
key: research-100
status: rejected
symbol: "GC=F"
timeframe: "1d"
tags: [strategy, research, sma, adx, di, atr, donchian, gold]
---

# 20-Bar Donchian Breakout with ADX Confirmation (Breakout)

Simple long-only trend-following on GOLD (GC=F) DAILY bars using a moving-average trend filter (sma20 vs sma50, only trade in the direction of the cross) combined with an ADX>20 trend-strength gate to avoid chop, entry on a fresh MACD histogram sign flip in the trend direction. Use an ATR-based trailing stop (trail at 2x ATR from the highest close since entry) instead of a fixed single target - this needs a custom exit computed inline since the standard ladder is tight/mean-reversion oriented. Risk 1% per trade. This project has only ever tested gold on 1h bars with short-holding mean-reversion/breakout/liquidity-sweep mechanisms - never a slower daily-bar trend-following approach that lets winners run. Aim for a lower trade count but higher average R per trade, with win rate that can be below 50% as long as expectancy is clearly positive across a full 5-year sample.

## Logic

```js
const n = bars.length - 1;
const lookback = 20;
if (n < lookback) return null;
let highestHigh = -Infinity;
let lowestLow = Infinity;
let volSum = 0;
for (let i = n - lookback; i < n; i++) {
  if (bars[i].h > highestHigh) highestHigh = bars[i].h;
  if (bars[i].l < lowestLow) lowestLow = bars[i].l;
  volSum += bars[i].v;
}
const avgVol = volSum / lookback;
const cur = bars[n];
const prevBar = bars[n - 1];
const snap = snaps[n];
const prevSnap = snaps[n - 1];
const prevPrevSnap = snaps[n - 2];
if (!snap || !prevSnap || !prevPrevSnap) return null;
if (snap.adx == null || snap.atr == null || snap.plusDI == null || snap.minusDI == null || snap.sma20 == null || snap.sma50 == null) return null;
if (prevSnap.adx == null || prevPrevSnap.adx == null) return null;

if (snap.adx < 22) return null;
if (snap.adx <= prevSnap.adx || prevSnap.adx <= prevPrevSnap.adx) return null;

const buffer = 0.15 * snap.atr;
const maxExtension = 1.75 * snap.atr;
const volConfirmed = cur.v > avgVol;

const longSignal = cur.c > highestHigh + buffer
  && prevBar.c <= highestHigh
  && snap.plusDI > snap.minusDI
  && snap.sma20 > snap.sma50
  && (cur.c - highestHigh) < maxExtension
  && volConfirmed;

const shortSignal = cur.c < lowestLow - buffer
  && prevBar.c >= lowestLow
  && snap.minusDI > snap.plusDI
  && snap.sma20 < snap.sma50
  && (lowestLow - cur.c) < maxExtension
  && volConfirmed;

if (longSignal) {
  return { side: "long", note: "Close " + cur.c.toFixed(2) + " broke above 20-bar high " + highestHigh.toFixed(2) + " on above-avg volume, ADX rising 2 bars (" + prevPrevSnap.adx.toFixed(1) + "->" + prevSnap.adx.toFixed(1) + "->" + snap.adx.toFixed(1) + "), +DI>-DI, sma20>sma50" };
}
if (shortSignal) {
  return { side: "short", note: "Close " + cur.c.toFixed(2) + " broke below 20-bar low " + lowestLow.toFixed(2) + " on above-avg volume, ADX rising 2 bars (" + prevPrevSnap.adx.toFixed(1) + "->" + prevSnap.adx.toFixed(1) + "->" + snap.adx.toFixed(1) + "), -DI>+DI, sma20<sma50" };
}
return null;
```

## Backtest history

- Research pipeline backtest (5y, 1d): 19 trades, 68.4% win rate, profit factor 1.24, total P/L $9.75, Sharpe 1.36.

## Live status

Rejected after review - not live. From research run #63.
