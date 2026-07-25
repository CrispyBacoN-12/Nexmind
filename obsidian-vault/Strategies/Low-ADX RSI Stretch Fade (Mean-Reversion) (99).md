---
type: strategy
key: research-99
status: rejected
symbol: "GC=F"
timeframe: "1d"
tags: [strategy, research, sma, rsi, adx, atr, gold]
---

# Low-ADX RSI Stretch Fade (Mean-Reversion)

Simple long-only trend-following on GOLD (GC=F) DAILY bars using a moving-average trend filter (sma20 vs sma50, only trade in the direction of the cross) combined with an ADX>20 trend-strength gate to avoid chop, entry on a fresh MACD histogram sign flip in the trend direction. Use an ATR-based trailing stop (trail at 2x ATR from the highest close since entry) instead of a fixed single target - this needs a custom exit computed inline since the standard ladder is tight/mean-reversion oriented. Risk 1% per trade. This project has only ever tested gold on 1h bars with short-holding mean-reversion/breakout/liquidity-sweep mechanisms - never a slower daily-bar trend-following approach that lets winners run. Aim for a lower trade count but higher average R per trade, with win rate that can be below 50% as long as expectancy is clearly positive across a full 5-year sample.

## Logic

```js
const n = snaps.length - 1;
const cur = snaps[n];
const prev = snaps[n - 1];
const prev2 = snaps[n - 2];
if (!cur || !prev || !prev2) return null;
if (cur.rsi == null || cur.adx == null || cur.sma20 == null || cur.price == null || cur.atr == null) return null;
if (prev.rsi == null || prev2.rsi == null) return null;
if (cur.adx >= 22) return null;
if (cur.atr <= 0) return null;

const bar = bars[bars.length - 1];
const prevBar = bars[bars.length - 2];
if (!prevBar) return null;

const stretchAtr = (cur.price - cur.sma20) / cur.atr;
const rsiTurn = cur.rsi - prev.rsi;
const range = bar.h - bar.l;
const closePos = range > 1e-9 ? (bar.c - bar.l) / range : 0.5;

const longSetup =
  prev.rsi <= 32 && prev2.rsi >= prev.rsi &&
  rsiTurn >= 2 && cur.rsi < 45 &&
  stretchAtr < -1 && stretchAtr > -2.75 &&
  bar.c > bar.o && closePos >= 0.6 && bar.c > prevBar.c;

const shortSetup =
  prev.rsi >= 68 && prev2.rsi <= prev.rsi &&
  rsiTurn <= -2 && cur.rsi > 55 &&
  stretchAtr > 1 && stretchAtr < 2.75 &&
  bar.c < bar.o && closePos <= 0.4 && bar.c < prevBar.c;

if (longSetup) {
  return { side: "long", note: "RSI turning up from oversold (" + prev.rsi.toFixed(1) + " -> " + cur.rsi.toFixed(1) + ", turn " + rsiTurn.toFixed(1) + ") in low-ADX chop (ADX " + cur.adx.toFixed(1) + "), price " + stretchAtr.toFixed(2) + " ATR below SMA20 (not overextended), strong-close reversal bar above prior close" };
}
if (shortSetup) {
  return { side: "short", note: "RSI turning down from overbought (" + prev.rsi.toFixed(1) + " -> " + cur.rsi.toFixed(1) + ", turn " + rsiTurn.toFixed(1) + ") in low-ADX chop (ADX " + cur.adx.toFixed(1) + "), price " + stretchAtr.toFixed(2) + " ATR above SMA20 (not overextended), weak-close reversal bar below prior close" };
}
return null;
```

## Backtest history

- Research pipeline backtest (5y, 1d): 0 trades, 0.0% win rate, profit factor n/a, total P/L $0.00, Sharpe n/a.

## Live status

Rejected after review - not live. From research run #63.
