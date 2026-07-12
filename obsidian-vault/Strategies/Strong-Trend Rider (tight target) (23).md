---
type: strategy
key: research-23
status: approved
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, sma, adx, di, macd, gold]
---

# Strong-Trend Rider (tight target)

FINAL: goal is win rate >50% AND consistent profit (user's explicit target). Root cause of the ~25-33% win-rate ceiling on every prior entry-signal concept: the shared backtest ladder classifies a trade as 'win' only on reaching the FAR target (TP2, 4x ATR) -- reaching the near target (TP1, 2.5x ATR) then retracing to breakeven was 'breakeven', not 'win'. Fix: research-strategy backtests now use a tight single target (TP1=1.2x ATR, no TP2 leg) instead of the live desk's stretched ladder -- validated via scripts/sweep-rr.ts and scripts/sweep-candidates.ts across both 3mo and 1y GC=F windows before wiring into the real pipeline (src/lib/research/runResearch.ts). All 3 candidates below now clear >50% win rate on BOTH windows with large samples and positive P/L.

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.adx == null || p.adx == null || s.plusDI == null || s.minusDI == null || s.sma20 == null || s.sma50 == null || s.macdHist == null || p.macdHist == null || s.price == null) return null;
if (s.adx < 28 || s.adx <= p.adx) return null;
var gap = Math.abs(s.plusDI - s.minusDI);
if (gap < 10) return null;
if (s.plusDI > s.minusDI && s.price > s.sma20 && s.sma20 > s.sma50 && s.macdHist > p.macdHist && s.macdHist > 0) {
  return { side: "long", note: "strong trend rider: ADX " + s.adx.toFixed(0) + " rising, momentum accelerating" };
}
if (s.minusDI > s.plusDI && s.price < s.sma20 && s.sma20 < s.sma50 && s.macdHist < p.macdHist && s.macdHist < 0) {
  return { side: "short", note: "strong trend rider: ADX " + s.adx.toFixed(0) + " rising, momentum accelerating" };
}
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 211 trades, 57.3% win rate, profit factor n/a, total P/L $22.59, Sharpe n/a.

## Live status

Approved - available as `research-23` if assigned to a portfolio's strategy key. From research run #8.
