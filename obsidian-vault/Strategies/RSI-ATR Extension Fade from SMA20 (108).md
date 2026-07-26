---
type: strategy
key: research-108
status: rejected
symbol: "GC=F"
timeframe: "1d"
tags: [strategy, research, sma, rsi, adx, macd, atr, gold]
---

# RSI/ATR Extension Fade from SMA20

20-Bar Donchian Channel Breakout with ADX Confirmation on GOLD (GC=F) DAILY bars, using the MAX available history instead of 5y. This is a deliberate refinement of research-63's 'Breakout' candidate, which already nailed the profile (68.4% win rate, profit factor 1.24, expectancy +0.51 per trade) but was auto-rejected purely on trade count (19 trades, needs >=20). Keep the exact same mechanism unchanged - 20-bar Donchian high/low channel breakout with an ADX-rising confirmation filter to avoid weak breakouts - only widen the data range from 5y to max so more historical breakouts surface and the sample clears the 20-trade floor. Use a tight single-target ladder (SL=1.5x ATR, TP=1.2x ATR), risk 1% per trade, target win rate >50% (research-63 already cleared this comfortably).

## Logic

```js
const n = bars.length;
if (n < 21) return null;
const i = n - 1;
const s = snaps[i];
const p = snaps[i - 1];
if (!s || !p) return null;
if (s.rsi == null || s.sma20 == null || s.atr == null || s.atr <= 0 || s.adx == null || s.macdHist == null || p.macdHist == null) return null;

const c = bars[i].c;
const distAtr = (c - s.sma20) / s.atr;

// Widened from ADX>25 (0 trades) - ranging/mild-trend regimes still allow reversion
if (s.adx > 32) return null;

// Long fade: oversold, stretched below SMA20, momentum decelerating or turning up
if (s.rsi < 32 && distAtr < -1.5 && s.macdHist >= p.macdHist - Math.abs(p.macdHist) * 0.05) {
  return { side: "long", note: "RSI oversold " + s.rsi.toFixed(1) + ", " + Math.abs(distAtr).toFixed(2) + "x ATR below SMA20, ADX " + s.adx.toFixed(1) + " (ranging), MACD hist stabilizing/turning up - fade reversion" };
}
// Short fade: overbought, stretched above SMA20, momentum decelerating or turning down
if (s.rsi > 68 && distAtr > 1.5 && s.macdHist <= p.macdHist + Math.abs(p.macdHist) * 0.05) {
  return { side: "short", note: "RSI overbought " + s.rsi.toFixed(1) + ", " + distAtr.toFixed(2) + "x ATR above SMA20, ADX " + s.adx.toFixed(1) + " (ranging), MACD hist stabilizing/turning down - fade reversion" };
}
return null;
```

## Backtest history

- Research pipeline backtest (max, 1d): 1 trades, 0.0% win rate, profit factor 0.00, total P/L $-11.70, Sharpe n/a.

## Live status

Rejected after review - not live. From research run #67.
