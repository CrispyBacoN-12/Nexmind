---
type: backtest
date: 2026-07-13
symbol: "multi (GC=F, SI=F, EURUSD=X, BTC-USD)"
timeframe: "multi (15m / 1h / 1d)"
tags: [backtest, sweep, range-trading, synthesis]
---

# Range-Trading Exploration Summary (research-63 through research-82)

## Motivation

The entire approved strategy portfolio turned out to require a trend context to fire - every live strategy gates on an ADX floor and/or SMA alignment. That means the bot sits flat for the (large) fraction of time gold/silver/forex/BTC spend ranging rather than trending. This exploration set out to find *any* mean-reversion / range-fade mechanism that could pass the standard bar (in-sample win rate > 50% and positive P/L, confirmed on a blind held-out year) well enough to fill that coverage gap.

**20 distinct candidates (research-63 through research-82) were dispatched and rejected this session**, spanning 8 underlying mechanisms, 4 markets (gold, silver, EURUSD, BTC-USD) and 3 timeframes (15m, 1h, 1d). Three genuinely new indicators - Stochastic %K/%D, Bollinger %B/bandwidth, and session-anchored VWAP deviation - were added to the codebase specifically to broaden the search (see [[#New indicators added]] below). None of the 20 candidates produced a mechanism that held up; one (research-82) looked anomalously promising and got a dedicated follow-up experiment, documented separately below since it was never dispatched through the normal research pipeline.

**Conclusion: no discoverable range-trading edge was found** on these markets/timeframes with the full available indicator toolkit. Per the user's decision, the search is paused here - see [[#Verdict]].

## Result

| # | Strategy | Symbol / TF | Trades | Win% | PF | Total P/L | Verdict |
|---|---|---|---|---:|---:|---:|---|
| 63 | [[Liquidity Sweep (20-bar, gold, RSI-extreme) (63)]] | GC=F / 1h | 213 | 53.5% | 1.06 | +$19.11 | Rejected - too thin to trust |
| 64 | [[Liquidity Sweep (10-bar, gold) (64)]] | GC=F / 1h | 514 | 53.3% | 0.96 | -$29.15 | Rejected - negative |
| 65 | [[RSI Extreme Fade (low-ADX range) (65)]] | GC=F / 1h | 11 | 72.7% | 1.77 | +$9.51 | Rejected - sample too small (11 trades) |
| 66 | [[RSI Extreme Fade (low-ADX range, 2y sample) (66)]] | GC=F / 1h | 23 | 52.2% | 1.02 | +$0.42 | Rejected - v1's edge was noise, confirmed on 2y |
| 67 | [[RSI Extreme Fade (low-ADX range, ADX-25) (67)]] | GC=F / 1h | 28 | 67.9% | 1.47 | +$15.18 | Rejected after failed blind test |
| 68 | [[RSI Extreme Fade (low-ADX range, ADX-25, 2y sample) (68)]] | GC=F / 1h | 57 | 57.9% | 1.29 | +$15.46 | Rejected - same underlying signal as 67 |
| 69 | [[ATR-Band Mean Reversion (gold) (69)]] | GC=F / 1h | 48 | 64.6% | 1.40 | +$19.86 | Rejected after failed blind test |
| 70 | [[MACD Histogram Exhaustion Fade (gold) (70)]] | GC=F / 1h | 567 | 54.7% | 0.93 | -$60.87 | Rejected - negative, large sample |
| 71 | [[Liquidity Sweep (20-bar, BTC-USD) (71)]] | BTC-USD / 1h | 602 | 55.8% | 0.97 | -$685.83 | Rejected - negative, large sample |
| 72 | [[Liquidity Sweep (20-bar, EURUSD) (72)]] | EURUSD=X / 1h | 388 | 53.9% | 0.77 | -$0.01 | Rejected - negative |
| 73 | [[Volume Climax Fade (gold) (73)]] | GC=F / 1h | 243 | 48.6% | 0.74 | -$96.16 | Rejected - negative |
| 74 | [[RSI Extreme Fade (low-ADX range, gold 15m) (74)]] | GC=F / 15m | 6 | 50.0% | 0.68 | -$1.96 | Rejected - negative, too thin |
| 75 | [[Bollinger %B + Stochastic Fade (gold) (75)]] | GC=F / 1h | 96 | 55.2% | 1.00 | -$0.32 | Rejected - dead breakeven |
| 76 | [[Bollinger %B + Stoch %K-%D Crossover Fade (gold) (76)]] | GC=F / 1h | 61 | 57.4% | 1.06 | +$4.75 | Rejected after failed blind test (47 trades, 44.7% win, -$920) |
| 77 | [[Bollinger %B + Stoch %K-%D Crossover Fade (EURUSD) (77)]] | EURUSD=X / 1h | 84 | 47.6% | 0.59 | -$0.00 | Rejected - negative |
| 78 | [[Stochastic %K-%D Crossover Fade (gold) (78)]] | GC=F / 1h | 178 | 53.4% | 0.86 | -$34.47 | Rejected - negative |
| 79 | [[VWAP Deviation Fade (gold) (79)]] | GC=F / 1h | 152 | 51.3% | 0.81 | -$52.24 | Rejected - negative |
| 80 | [[Bollinger %B + Stoch %K-%D Crossover Fade (gold 1d) (80)]] | GC=F / 1d | 13 | 38.5% | 0.42 | -$27.26 | Rejected - negative, too thin |
| 81 | [[Bollinger %B + Stoch %K-%D Crossover Fade (silver) (81)]] | SI=F / 1h | 43 | 53.5% | 0.73 | -$0.58 | Rejected - negative |
| 82 | [[Bollinger Band Reclaim Fade (gold) (82)]] | GC=F / 1h | 132 | 56.1% | 1.03 | +$5.76 | Rejected after failed blind test (137 trades, 55.5% win, -$20) - see below |

## The research-82 anomaly and custom-exit follow-up

Research-82 (Bollinger Band Reclaim Fade) stood out from every other candidate: its win rate held remarkably steady across windows - **56.1% in-sample, 55.5% on the blind held-out year** - which is exactly the kind of consistency a real signal should show. Yet total P/L was flat-to-negative in both windows (+$5.76 in-sample, -$20 blind). That combination (stable win rate, losing P/L) pointed at the *entry* being real but the shared *exit scheme* being a poor fit, not the signal being noise.

The shared backtest engine (`backtestCandles` in `src/lib/backtest/engine.ts`) applies a fixed exit to every strategy - SL at 1.5x ATR, TP at 2.5x ATR (or 1.2x ATR in single-target mode) - with no per-strategy override. That's a reasonable target for a breakout/continuation trade, but arbitrary for a mean-reversion trade like this one, where the natural target is the level price is reverting toward (the middle Bollinger band / SMA20), not a fixed ATR multiple.

Rather than modify the shared engine (which scores every approved strategy and would be a consequential, invasive change), a standalone script (`scripts/custom-exit-bb-reclaim.mts`, not dispatched through `runResearch` - no auto-generated Strategies/ note exists for it) re-ran the identical entry signal with SL unchanged (1.5x ATR) but TP replaced by the middle-band value fixed at signal time:

| Window | Trades | Win% | Total P/L | Result |
|---|---:|---:|---:|---|
| In-sample (1y) | 123 | 55.3% | +$573 | PASSED |
| Holdout (blind, ~1y older) | 123 | 49.6% | -$1,396 | FAILED |

The custom exit *did* pass in-sample - but failed decisively on the blind window, worse than the original fixed-ATR exit did. Conclusion: the apparent edge was fragile and scoring-scheme-dependent rather than a real, generalizable signal. This closes out the most promising lead found this session as a negative result.

## New indicators added

Added to `src/lib/indicators.ts` / wired into `src/lib/research/adapter.ts` (`computeSnapshots`) and `src/lib/trading/scanner.ts` (`scanSymbol`), extending the shared `ScanSnapshot` type with optional fields so the other snapshot-building code paths (backtest engine's built-in trend-pullback path, `strategies.ts`) were left untouched:

- **Stochastic %K/%D** (`stochastic()`, new function) - `stochK`, `stochD`
- **Bollinger %B / bandwidth** (using the pre-existing `bollinger()` function, not previously wired into snapshots) - `bbPercentB`, `bbWidth`
- **Session-anchored VWAP deviation** (using the pre-existing `anchoredVWAP()`/`dailyAnchor()` functions) - `vwapDevPct`

## Verdict

**No range-trading edge found, across 20 mechanisms / 4 markets / 3 timeframes / 8 distinct indicator combinations.** Every candidate either failed in-sample, failed a blind held-out-year test, or (research-82) failed once a custom exit was tried to rescue an anomalously consistent win rate.

Stopping the range-trading search here per instruction. The approved trend-continuation portfolio should be understood as **correctly designed to sit flat during ranging markets**, not as having a gap that needs to be force-filled - forcing a losing range edge into the live portfolio would be worse than no range coverage at all.

If revisited later, the more promising directions based on this round are:
- The research-82 entry signal (Bollinger reclaim, ADX<25) is the closest thing to a real pattern found - if revisited, try exits between the two extremes tested (partial fixed-ATR, partial band-target) rather than pure versions of either.
- Every mechanism here was point-in-time (single-bar) fades/reclaims. Multi-bar confirmation or session/regime filters (e.g., time-of-day, day-of-week) were not explored and remain open.
- Only 15m/1h/1d were tried; no mechanism was tested on 4h.
