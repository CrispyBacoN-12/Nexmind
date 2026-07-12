---
type: strategy
key: research-30
status: approved
symbol: GC=F
timeframe: 1h
tags: [strategy, gold, DI, ADX]
---

# DI-Dominance Widening

Fires whenever the +DI/−DI gap is widening while ADX ≥ 20 — no fresh crossover required (unlike [[DI-Cross]], which only fires at the moment of a flip). Designed to keep firing during sustained one-directional trends where DI-Cross goes quiet.

## Logic

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null || s.adx == null) return null;
if (s.adx < 20) return null;
var gap = Math.abs(s.plusDI - s.minusDI);
var pGap = Math.abs(p.plusDI - p.minusDI);
if (s.plusDI > s.minusDI && gap > pGap) return { side: "long", note: "DI gap widening, +DI dominant" };
if (s.minusDI > s.plusDI && gap > pGap) return { side: "short", note: "DI gap widening, -DI dominant" };
return null;
```

Two conditions must hold together: ADX ≥ 20 **and** the DI gap wider than the prior bar. A high ADX alone (e.g. 33) doesn't fire if the gap isn't widening — this tripped up a reading of the scan log on 2026-07-06 (the `ADX 33 · RSI 50 · above SMA50` line is generic diagnostic text from `snapshotDiag()`, not proof the strategy's own condition was met).

## Backtest history

- Tuning window (1h/1y): 695 trades/yr, 57.3% win rate, +$2,140/yr pooled annualized. Split-half stable (H1 58%/+$1,380, H2 57%/+$660).
- See [[2026-07-07 Blind Test - DI-Dominance v2]] for the held-out (2y, pre-1y) result: 669 trades, 59.2% win, +$4,419/yr annualized — consistent with the tuning window, no overfitting red flag.

## Live status

Runs on [[Gold Desk]] (#8) as a merged secondary pass (`research-30`, 1h/3mo) alongside the desk's own default `combo-gold` (1d/5y) pass. Originally lived on Gold Trend Desk (#13), which is now archived after the merge — see [[Gold Desk Merge]].
