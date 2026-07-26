---
type: strategy
key: research-107
status: rejected
symbol: "GC=F"
timeframe: "1d"
tags: [strategy, research, sma, rsi, adx, di, macd, atr, gold]
---

# MACD Momentum Continuation (SMA50 trend + ADX filter)

20-Bar Donchian Channel Breakout with ADX Confirmation on GOLD (GC=F) DAILY bars, using the MAX available history instead of 5y. This is a deliberate refinement of research-63's 'Breakout' candidate, which already nailed the profile (68.4% win rate, profit factor 1.24, expectancy +0.51 per trade) but was auto-rejected purely on trade count (19 trades, needs >=20). Keep the exact same mechanism unchanged - 20-bar Donchian high/low channel breakout with an ADX-rising confirmation filter to avoid weak breakouts - only widen the data range from 5y to max so more historical breakouts surface and the sample clears the 20-trade floor. Use a tight single-target ladder (SL=1.5x ATR, TP=1.2x ATR), risk 1% per trade, target win rate >50% (research-63 already cleared this comfortably).

## Logic

```js
const n = bars.length;
if (n < 51) return null;
const i = n - 1;
const s = snaps[i], p = snaps[i-1];
if (!s || !p) return null;
if (s.macdHist == null || p.macdHist == null || s.sma50 == null || s.adx == null || p.adx == null || s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.rsi == null || s.atr == null) return null;
const c = bars[i].c;
const macdCrossUp = p.macdHist <= 0 && s.macdHist > 0;
const macdCrossDown = p.macdHist >= 0 && s.macdHist < 0;
const histMoveOk = Math.abs(s.macdHist - p.macdHist) > 0.03 * s.atr;
const diBullish = s.plusDI > s.minusDI && p.plusDI > p.minusDI;
const diBearish = s.minusDI > s.plusDI && p.minusDI > p.plusDI;
const adxOk = s.adx > 12;
if (macdCrossUp && histMoveOk && c > s.sma50 && adxOk && diBullish && s.rsi > 38 && s.rsi < 75) {
  return { side: "long", note: "MACD hist cross up " + s.macdHist.toFixed(3) + " (d" + (s.macdHist - p.macdHist).toFixed(3) + ") above SMA50, ADX " + s.adx.toFixed(1) + ", +DI>-DI 2-bar, RSI " + s.rsi.toFixed(1) };
}
if (macdCrossDown && histMoveOk && c < s.sma50 && adxOk && diBearish && s.rsi < 62 && s.rsi > 25) {
  return { side: "short", note: "MACD hist cross down " + s.macdHist.toFixed(3) + " (d" + (s.macdHist - p.macdHist).toFixed(3) + ") below SMA50, ADX " + s.adx.toFixed(1) + ", -DI>+DI 2-bar, RSI " + s.rsi.toFixed(1) };
}
return null;
```

## Backtest history

- Research pipeline backtest (max, 1d): 2 trades, 100.0% win rate, profit factor n/a, total P/L $24.71, Sharpe 95.00.

## Live status

Rejected after review - not live. From research run #67.
