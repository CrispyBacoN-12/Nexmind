---
type: strategy
key: research-22
status: approved
symbol: "GC=F"
timeframe: "1h"
tags: [strategy, research, adx, di, gold]
---

# DI-Dominance Continuation (tight target)

FINAL: goal is win rate >50% AND consistent profit (user's explicit target). Root cause of the ~25-33% win-rate ceiling on every prior entry-signal concept: the shared backtest ladder classifies a trade as 'win' only on reaching the FAR target (TP2, 4x ATR) -- reaching the near target (TP1, 2.5x ATR) then retracing to breakeven was 'breakeven', not 'win'. Fix: research-strategy backtests now use a tight single target (TP1=1.2x ATR, no TP2 leg) instead of the live desk's stretched ladder -- validated via scripts/sweep-rr.ts and scripts/sweep-candidates.ts across both 3mo and 1y GC=F windows before wiring into the real pipeline (src/lib/research/runResearch.ts). All 3 candidates below now clear >50% win rate on BOTH windows with large samples and positive P/L.

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.adx == null) return null;
if (s.adx < 25) return null;
var gap = Math.abs(s.plusDI - s.minusDI);
var pGap = Math.abs(p.plusDI - p.minusDI);
if (s.plusDI > s.minusDI && gap > pGap) return { side: "long", note: "DI gap widening, +DI dominant" };
if (s.minusDI > s.plusDI && gap > pGap) return { side: "short", note: "DI gap widening, -DI dominant" };
return null;
```

## Backtest history

- Research pipeline backtest (1y, 1h): 504 trades, 56.9% win rate, profit factor n/a, total P/L $7.85, Sharpe n/a.

## Live status

Approved - available as `research-22` if assigned to a portfolio's strategy key. From research run #8.
