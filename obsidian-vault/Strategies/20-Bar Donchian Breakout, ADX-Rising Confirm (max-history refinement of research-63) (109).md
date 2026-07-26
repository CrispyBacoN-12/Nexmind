---
type: strategy
key: research-109
status: rejected
symbol: "GC=F"
timeframe: "1d"
tags: [strategy, research, sma, adx, di, macd, atr, donchian, gold]
---

# 20-Bar Donchian Breakout, ADX-Rising Confirm (max-history refinement of research-63)

20-Bar Donchian Channel Breakout with ADX Confirmation on GOLD (GC=F) DAILY bars, using the MAX available history instead of 5y. This is a deliberate refinement of research-63's 'Breakout' candidate, which already nailed the profile (68.4% win rate, profit factor 1.24, expectancy +0.51 per trade) but was auto-rejected purely on trade count (19 trades, needs >=20). Keep the exact same mechanism unchanged - 20-bar Donchian high/low channel breakout with an ADX-rising confirmation filter to avoid weak breakouts - only widen the data range from 5y to max so more historical breakouts surface and the sample clears the 20-trade floor. Use a tight single-target ladder (SL=1.5x ATR, TP=1.2x ATR), risk 1% per trade, target win rate >50% (research-63 already cleared this comfortably).

## Logic

```js
const n = bars.length;
if (n < 23) return null;
const i = n - 1;
const s = snaps[i];
const prev = snaps[i-1];
const prev2 = snaps[i-2];
if (!s || !prev || !prev2) return null;
if (s.adx == null || prev.adx == null || prev2.adx == null) return null;
if (s.plusDI == null || s.minusDI == null || s.atr == null) return null;
if (s.macdHist == null || prev.macdHist == null) return null;
if (s.sma20 == null) return null;
let hh = -Infinity, ll = Infinity, volSum = 0;
for (let k = i - 20; k < i; k++) {
  const b = bars[k];
  if (b.h > hh) hh = b.h;
  if (b.l < ll) ll = b.l;
  volSum += b.v;
}
if (!isFinite(hh) || !isFinite(ll)) return null;
const avgVol = volSum / 20;
const curVol = bars[i].v;
const adxRising = s.adx > prev.adx && prev.adx > prev2.adx;
const adxStrong = s.adx > 23;
const c = bars[i].c;
const buffer = s.atr * 0.2;
const volConfirmed = curVol > avgVol * 1.1;
const extension = Math.abs(c - s.sma20) / s.atr;
const notOverextended = extension < 3.5;
const macdRisingLong = s.macdHist > prev.macdHist && s.macdHist > 0;
const macdFallingShort = s.macdHist < prev.macdHist && s.macdHist < 0;
if (c > hh + buffer && adxRising && adxStrong && s.plusDI > s.minusDI && volConfirmed && notOverextended && macdRisingLong) {
  return { side: "long", note: "Donchian20 breakout above " + hh.toFixed(2) + "+buf, ADX rising " + prev2.adx.toFixed(1) + "->" + prev.adx.toFixed(1) + "->" + s.adx.toFixed(1) + ", +DI>-DI, vol " + (curVol/avgVol).toFixed(2) + "x avg, MACD accelerating up, ext " + extension.toFixed(1) + "atr" };
}
if (c < ll - buffer && adxRising && adxStrong && s.minusDI > s.plusDI && volConfirmed && notOverextended && macdFallingShort) {
  return { side: "short", note: "Donchian20 breakdown below " + ll.toFixed(2) + "-buf, ADX rising " + prev2.adx.toFixed(1) + "->" + prev.adx.toFixed(1) + "->" + s.adx.toFixed(1) + ", -DI>+DI, vol " + (curVol/avgVol).toFixed(2) + "x avg, MACD accelerating down, ext " + extension.toFixed(1) + "atr" };
}
return null;
```

## Backtest history

- Research pipeline backtest (max, 1d): 1 trades, 100.0% win rate, profit factor n/a, total P/L $14.55, Sharpe n/a.

## Live status

Rejected after review - not live. From research run #67.
