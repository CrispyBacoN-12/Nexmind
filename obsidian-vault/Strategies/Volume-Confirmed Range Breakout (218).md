---
type: strategy
key: research-218
status: rejected
symbol: "SP500-PANEL"
timeframe: "1d"
tags: [strategy, research, sma, rsi, adx, di, macd, atr]
---

# Volume-Confirmed Range Breakout

Momentum/breakout entry signal for US equities swing trading, risk 1% per trade, exit geometry swept separately, edge that holds across the whole cross-section (many names contributing, not one) and across both halves of the sample.

## Logic

```js
const n = bars.length;
const LOOKBACK = 30;
const ADX_MIN = 25;
const VOL_MULT = 1.8;
if (n < LOOKBACK + 10) return null;
const s = snaps[n-1];
const sPrev = snaps[n-2];
if (!s || !sPrev) return null;
if (s.atr == null || s.adx == null || s.plusDI == null || s.minusDI == null || s.macdHist == null || s.rsi == null || s.sma20 == null || s.sma50 == null || sPrev.atr == null) return null;
let hh = -Infinity, ll = Infinity, volSum = 0;
for (let i = n - 1 - LOOKBACK; i < n - 1; i++) {
  const b = bars[i];
  if (b.h > hh) hh = b.h;
  if (b.l < ll) ll = b.l;
  volSum += b.v;
}
const avgVol = volSum / LOOKBACK;
const cur = bars[n-1];
const prev = bars[n-2];
const volConfirm = avgVol > 0 && cur.v > avgVol * VOL_MULT;
const trending = s.adx > ADX_MIN;
const atr = s.atr;
const minBreakBuffer = atr * 0.3;
const maxExtension = atr * 1.2;
const atrExpanding = atr > sPrev.atr;
const barRange = cur.h - cur.l;
const closeStrengthLong = barRange > 0 ? (cur.c - cur.l) / barRange : 0;
const closeStrengthShort = barRange > 0 ? (cur.h - cur.c) / barRange : 0;
const freshLongBreak = prev.c <= hh && cur.c > hh + minBreakBuffer && (cur.c - hh) < maxExtension;
const freshShortBreak = prev.c >= ll && cur.c < ll - minBreakBuffer && (ll - cur.c) < maxExtension;
const trendAlignLong = s.sma20 > s.sma50;
const trendAlignShort = s.sma20 < s.sma50;
if (freshLongBreak && volConfirm && trending && atrExpanding && closeStrengthLong > 0.66 && s.plusDI > s.minusDI && s.macdHist > 0 && trendAlignLong && s.rsi < 78) {
  return { side: "long", note: "Fresh strong-close breakout above 30-bar high, expanding ATR, MA/trend/momentum/volume aligned" };
}
if (freshShortBreak && volConfirm && trending && atrExpanding && closeStrengthShort > 0.66 && s.minusDI > s.plusDI && s.macdHist < 0 && trendAlignShort && s.rsi > 22) {
  return { side: "short", note: "Fresh strong-close breakdown below 30-bar low, expanding ATR, MA/trend/momentum/volume aligned" };
}
return null;
```

## Backtest history

- Research pipeline backtest (fit:2016-2018, 1d): 363 trades, 48.2% win rate, profit factor 0.23, total P/L $-150.21, Sharpe -1.43.

## Live status

Rejected after review - not live. From research run #112.
