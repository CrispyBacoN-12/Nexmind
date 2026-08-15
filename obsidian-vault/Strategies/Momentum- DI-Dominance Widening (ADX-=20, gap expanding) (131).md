---
type: strategy
key: research-131
status: rejected
symbol: "NG=F"
timeframe: "1h"
tags: [strategy, research, sma, adx, di, macd]
---

# Momentum: DI-Dominance Widening (ADX>=20, gap expanding)

DI-Dominance Widening entry signal (fires whenever the +DI/-DI gap is widening while ADX >= 20, no fresh crossover required - the same logic behind the live gold strategy research-30: 695 trades, 57.3% win rate, approved) for NG=F (natural gas futures) 1h/1y. This is a genuinely fresh symbol test: natural gas has never been tried in this project, and DI-Dominance Widening is the single strongest validated concept here, already ported to SI=F (rejected, both attempts had thin trade counts or negative expectancy) and CL=F (crossover variant, rejected, trades too thin). Natural gas is a classically trend-prone commodity like gold, so this checks whether the mechanism generalizes to a third commodity. Tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, target win rate >50%, adequate trade count (widen range if signal is rare).

## Logic

```js
var i = bars.length - 1;
if (i < 3) return null;
var s = snaps[i], sp = snaps[i - 1], sp2 = snaps[i - 2];
if (!s || !sp || !sp2) return null;
if (s.adx == null || s.plusDI == null || s.minusDI == null) return null;
if (sp.plusDI == null || sp.minusDI == null) return null;
if (sp2.plusDI == null || sp2.minusDI == null) return null;
if (sp.adx == null || s.macdHist == null || sp.macdHist == null) return null;
if (s.sma20 == null || s.sma50 == null || s.price == null) return null;
if (s.adx < 28 || s.adx > 45) return null;
if (s.adx <= sp.adx) return null;
var gap = s.plusDI - s.minusDI;
var prevGap = sp.plusDI - sp.minusDI;
var prevGap2 = sp2.plusDI - sp2.minusDI;
if (Math.abs(gap) <= Math.abs(prevGap)) return null;
if (Math.abs(prevGap) <= Math.abs(prevGap2)) return null;
if (Math.abs(gap) < 6) return null;
var side = gap > 0 ? "long" : "short";
if (side === "long" && (s.macdHist <= 0 || s.macdHist <= sp.macdHist)) return null;
if (side === "short" && (s.macdHist >= 0 || s.macdHist >= sp.macdHist)) return null;
if (side === "long" && !(s.price > s.sma20 && s.sma20 > s.sma50)) return null;
if (side === "short" && !(s.price < s.sma20 && s.sma20 < s.sma50)) return null;
return { side: side, note: "DI gap widening to " + gap.toFixed(2) + " with MA-stack alignment (ADX " + s.adx.toFixed(1) + " in 28-45 band rising, MACD hist accelerating " + s.macdHist.toFixed(4) + ")" };
```

## Backtest history

- Research pipeline backtest (1y, 1h): 66 trades, 48.5% win rate, profit factor 0.64, total P/L $-0.09, Sharpe -2.72.

## Live status

Rejected after review - not live. From research run #75.
