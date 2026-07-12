---
type: backtest
date: 2026-07-07
symbol: GC=F
timeframe: 1h
tags: [backtest, blind-test, DI]
---

# Blind Test — DI-Dominance v2 candidate

User proposed a stricter variant of [[DI-Dominance Widening]]: ADX ≥ 25 **and rising**, plus a "crossover within the last 3 bars" filter, on top of the existing gap-widening condition. Tested with `scripts/blind-test-di-v2.mts` on GC=F 1h bars **older than the most recent 365 days** (never touched by any prior sweep/tune) — 2y fetch → 362-day held-out segment, 5,758 bars. 5y fetch failed (Yahoo upstream 422).

## Result

| Strategy | Trades | Win% | PnL (blind) | Annualized |
|---|---|---|---|---|
| DI-Dominance Widening (live, research-30) | 669 | 59.2% | +$4,380 | +$4,419/yr |
| DI-Dominance v2 (ADX≥25 rising + recent cross) | 13 | 61.5% | +$140 | +$141/yr |

## Verdict

v2 technically "passes" (positive win rate and PnL) but the added filters cut trade frequency by ~98% (669 → 13 trades/yr ≈ 1/month). 13 trades is too small a sample to trust the win-rate edge, and annualized return is ~30x lower than the live strategy purely from starvation of setups.

**Not adopted.** The "recent crossover within 3 bars" filter appears to conflict with "gap widening" — gap-widening often happens well after the crossover, outside a 3-bar lookback. If revisited: try loosening `CROSSOVER_LOOKBACK` to 8–10 bars, or drop the "ADX rising" requirement and keep only ADX≥25 + crossover.
