---
type: strategy
key: research-98
status: rejected
symbol: "GC=F"
timeframe: "1d"
tags: [strategy, research, sma, rsi, adx, di, macd, gold]
---

# Trend-Following MA Cross + ADX + MACD Flip (Momentum)

Simple long-only trend-following on GOLD (GC=F) DAILY bars using a moving-average trend filter (sma20 vs sma50, only trade in the direction of the cross) combined with an ADX>20 trend-strength gate to avoid chop, entry on a fresh MACD histogram sign flip in the trend direction. Use an ATR-based trailing stop (trail at 2x ATR from the highest close since entry) instead of a fixed single target - this needs a custom exit computed inline since the standard ladder is tight/mean-reversion oriented. Risk 1% per trade. This project has only ever tested gold on 1h bars with short-holding mean-reversion/breakout/liquidity-sweep mechanisms - never a slower daily-bar trend-following approach that lets winners run. Aim for a lower trade count but higher average R per trade, with win rate that can be below 50% as long as expectancy is clearly positive across a full 5-year sample.

## Logic

```js
const n = snaps.length - 1;
if (n < 50) return null;
const cur = snaps[n];
const prev = snaps[n - 1];
if (!cur || !prev) return null;
if (cur.sma20 == null || cur.sma50 == null || cur.adx == null || prev.adx == null || cur.macdHist == null || prev.macdHist == null) return null;
if (cur.plusDI == null || cur.minusDI == null || cur.rsi == null || cur.price == null) return null;

const trendUp = cur.sma20 > cur.sma50 && cur.price > cur.sma20;
if (!trendUp) return null;

if (cur.adx <= 25) return null;
if (cur.adx <= prev.adx) return null;

const diSpread = cur.plusDI - cur.minusDI;
if (diSpread <= 4) return null;

if (cur.rsi >= 68 || cur.rsi <= 50) return null;

const freshFlip = prev.macdHist <= 0 && cur.macdHist > 0;
if (!freshFlip) return null;

const bar = bars[n];
const prevBar = bars[n - 1];
if (!bar || !prevBar) return null;
if (bar.c <= prevBar.h) return null;

return { side: "long", note: "SMA20>SMA50 uptrend w/ price>SMA20, ADX " + cur.adx.toFixed(1) + " rising, DI spread " + diSpread.toFixed(1) + ", RSI " + cur.rsi.toFixed(1) + ", MACD hist fresh flip +" + cur.macdHist.toFixed(3) + ", breakout close above prior high (trail 2xATR from highest close since entry)" };
```

## Backtest history

- Research pipeline backtest (5y, 1d): 4 trades, 50.0% win rate, profit factor 0.71, total P/L $-2.08, Sharpe -2.66.

## Live status

Rejected after review - not live. From research run #63.
