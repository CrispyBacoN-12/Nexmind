# DI-Dominance Re-Tune Proposal (+ MACD+Trend discovery)

**Status:** PROPOSAL — no DB changes made. Review before applying.
**Date:** 2026-07-22
**Scope:** the DI-Dominance *widening* strategies only — `research-30` and `research-22`. (DI-*Cross* strategies `research-25`/`research-26` use a different trigger and were NOT swept; see Out of Scope.)

## TL;DR

The DI-Dominance mechanism behind most of the approved portfolio has a **real but thin, regime-dependent** edge on gold — it is *not* a pure fluke like the Donchian breakout family. But the params the approved strategies actually use (`ADX≥20`/`ADX≥25`) sit **off** the robust region. Re-tuning to `no-ADX-gate + gap-widening + TP=2.0` roughly **2–4×'s the per-trade edge in favorable periods** with the same block-level consistency, and with better downside control. It does **not** fix the mechanism's ~1/3-of-the-time dead periods — no parameterization does.

**Update (weighted-indicator experiment): a stronger rule was found.** Trying unequal indicator weights (`scripts/sweep-weighted-score-gcf.mts`) did not produce a fractional-weight winner — the weights were degenerate — but the search *surfaced a better indicator SET*: **enter where the MACD-histogram sign and the SMA20-vs-SMA50 trend AGREE, gated by DI-gap widening, TP=2.0×ATR** (DI dominance itself turned out nearly irrelevant). On GC=F walk-forward it beats the retuned DI-only baseline: **positive in 5/6 blocks vs 4/6**, and — critically — it is positive in the 2025-07 regime that the DI baseline *lost*. This is the strongest candidate found in the whole quant pass. See "MACD+Trend discovery" below, including its caveats (one −0.15R block; only moderate on GLD).

## How this was measured

- **Data:** the Alpaca single-symbol fetcher was fixed to paginate (`src/lib/alpaca.ts`), unlocking deep intraday history. Sweeps ran on GC=F 1h 2y (~11,467 bars, 24h futures) — the approved strategies' own instrument — via `scripts/sweep-di-dominance-gld.mts "GC=F" 2y`.
- **Eval contract:** identical to the research pipeline — `singleTarget`, `DEFAULT_COST_MODEL` (0.5bp slip + 1bp commission), lot 0.1, SL fixed 1.5×ATR by the engine. Only the entry params and TP multiple vary.
- **Sweep:** 120 combos (ADX gate ∈ {off,15,20,25,30} × require-widening × min-gap ∈ {0,2,5} × TP ∈ {1.0,1.2,1.5,2.0}). Chronological 65/35 train/test split; a combo is "robust" only if it clears the bar on the untouched test window too.
- **Walk-forward:** the top robust params were then re-checked across 6 sequential time blocks (`scripts/walkforward-di-gcf.mts`) to rule out the single-split selection-bias trap.

## Evidence

**Sweep (GC=F 2y, 120 combos):** 21 passed the train bar, **6 survived out-of-sample**. The approved params were NOT among the robust ones — higher ADX gates did *worse* OOS:

| params | train PF | test PF | test avgR | test trades |
|---|---|---|---|---|
| `adx-off widen gap≥0 tp=1.5` | 1.07 | **1.06** | +0.056 | 500 |
| `adx≥15 widen gap≥0 tp=1.5` | 1.06 | 1.04 | +0.061 | 457 |
| `adx-off widen gap≥2 tp=2.0` | 1.07 | 1.01 | +0.047 | 389 |
| **approved** `adx≥20 widen tp=1.2` | 1.09 | 0.94 | **−0.003** | 469 |

**Walk-forward (GC=F 2y, 6 blocks):** every variant — retuned and approved — is positive in **4/6** blocks and loses in the *same* two (2024-07, 2025-07). The difference is magnitude:

| params | avgR in good blocks | avgR in bad blocks |
|---|---|---|
| RETUNED `adx-off gap≥2 tp=2.0` | +0.05 … **+0.10** | **−0.01, −0.03** ← best downside |
| RETUNED `adx-off gap≥0 tp=1.5` | +0.04 … +0.08 | −0.05, −0.07 |
| APPROVED `research-30 adx≥20 tp=1.2` | +0.00 … +0.07 | −0.02 |
| APPROVED `research-22 adx≥25 tp=1.2` | +0.00 … +0.03 | −0.09 |

## Recommendation

**Leading option — adopt the MACD+Trend rule** (see section below) as a new/replacement gold strategy on GC=F: it is the strongest walk-forward result found (5/6 blocks, survives the regime that sinks DI). Treat its 2024-11 −0.15R block as the known worst-case when sizing.

**Conservative option — re-tune the existing DI strategies.** If keeping the DI-Dominance family, re-tune `research-30` and `research-22` to the best-balanced robust variant:

- **Remove the ADX gate** (or lower to ≥15 — negligible difference).
- **Keep** the gap-widening trigger and +DI/−DI direction (unchanged).
- **Add `minGap ≥ 2`** (skip near-tied DI where dominance is noise).
- **Change exit to TP = 2.0×ATR** (from 1.2), SL stays 1.5×ATR.

Proposed entry code (replaces both research-30 and research-22's bodies):

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null) return null;
var gap = Math.abs(s.plusDI - s.minusDI);
var pGap = Math.abs(p.plusDI - p.minusDI);
if (gap < 2) return null;              // dominance must be meaningful, not a near-tie
if (gap <= pGap) return null;          // only when the gap is widening
if (s.plusDI > s.minusDI) return { side: "long",  note: "DI gap widening, +DI dominant (retuned)" };
if (s.minusDI > s.plusDI) return { side: "short", note: "DI gap widening, -DI dominant (retuned)" };
return null;
```

Plus set the strategy's TP multiple to 2.0 (was 1.2).

## MACD+Trend discovery (leading candidate)

Discovered rule (`scripts/walkforward-macd-trend-gcf.mts`):

```js
var i = bars.length - 1;
if (i < 1) return null;
var s = snaps[i], p = snaps[i - 1];
if (s.plusDI == null || s.minusDI == null || p.plusDI == null || p.minusDI == null) return null;
if (s.macdHist == null || s.sma20 == null || s.sma50 == null) return null;
var gap = Math.abs(s.plusDI - s.minusDI);
var pGap = Math.abs(p.plusDI - p.minusDI);
if (gap <= pGap) return null;                                    // DI-gap widening gate
if (s.macdHist > 0 && s.sma20 > s.sma50) return { side: "long",  note: "MACD+ & uptrend agree, DI widening" };
if (s.macdHist < 0 && s.sma20 < s.sma50) return { side: "short", note: "MACD- & downtrend agree, DI widening" };
return null;
```
TP = 2.0×ATR, SL 1.5×ATR (engine default).

**GC=F walk-forward (6 blocks) — beats DI baseline:**

| block | discovered avgR | DI baseline avgR |
|---|---|---|
| 2024-07 | +0.02 | −0.03 |
| 2024-11 | **−0.15** | +0.06 |
| 2025-03 | +0.12 | +0.10 |
| 2025-07 | **+0.14** | −0.01 |
| 2025-11 | +0.04 | +0.05 |
| 2026-03 | +0.15 | +0.05 |
| **positive** | **5/6** | 4/6 |

Wins where it counts (survives 2025-07 regime that sank DI; bigger up-magnitude), but has its own single ugly block (2024-11, −0.15R) — a real, concentrated drawdown risk. It trades less (~120/block vs ~190) because it demands MACD + trend + widening all align.

**GLD generalization check (5y, 6 blocks) — moderate, not dramatic:** discovered rule positive in **4/6** blocks (strong 2024-25: +0.16/+0.10/+0.06; flat-negative 2021-23: −0.01/+0.01/−0.01). It does NOT collapse on the ETF the way the Donchian family did, so it generalizes better — but GLD's RTH-gappy bars give it only a weak, recent-concentrated edge. Keep it on GC=F.

**Correction to an earlier claim:** the DI-only rule does not "die" on GLD — on the same GLD walk-forward it is weakly positive in 6/6 blocks, but at avgR ~+0.01–0.02 (below the meaningful PF>1.05 bar). Precise statement: DI on GLD is *break-even/below-threshold*, not clearly losing. The strict sweep's "0/120 robust on GLD" was about clearing PF>1.05, which this break-even edge doesn't.

## Weighted voting (tested, does NOT help) + combo-gold small-sample warning

`scripts/sweep-weighted-vote-gcf.mts` tested whether giving combo members
UNEQUAL vote weights beats the current equal-vote≥2 (`combineStrategies` counts
1 per member). Members = combo-gold's three (swing-trend-continuation,
trend-pullback, mean-rev) + the MACD+trend rule as a 4th. Swept 903
weight/threshold combos, train/test split:

- **1h GC=F 2y:** 0/903 weighted configs beat the equal-vote baseline OOS.
- **1d GC=F 5y (combo-gold's real cadence):** 0/903 beat it either.

**Conclusion: weighting the votes adds nothing.** Equal voting already captures
whatever edge the members share; unequal weights just reshuffle without
improving out-of-sample. The current equal-vote design is not leaving money on
the table here.

**Red flag surfaced — combo-gold is small-sample.** On its own daily cadence the
equal-vote≥2 baseline makes only **~10 train / ~8 test trades over 5 years**
(TEST showed 8 trades, 100% win — an unfalsifiable number). combo-gold's
headline "PF 3.25 / 72% win" rests on ~18 trades total; it is statistically
meaningless, the same small-sample trap as the candlestick family and
research-100. vote≥2-of-3 on daily gold is simply too restrictive to fire enough
times to trust. This *raises* the relative standing of the MACD+trend rule,
which fires hundreds of trades on 1h — a trustworthy statistical regime.

## Indicator + candlestick confluence (tested, does NOT help)

`scripts/confluence-indicator-candle-gcf.mts` (trend context) and
`scripts/confluence-meanrev-candle-gcf.mts` (mean-reversion context) tested
using an indicator to set direction/zone, then requiring a candlestick pattern
to confirm the entry bar. Both fail to produce a trustworthy edge:

- **Trend + candle:** the candle gate collapses trades 265 → 4–20. Cells with
  eye-catching PF (1.99, 2.39) have only 4–7 trades — mirages. Cells that keep
  enough trades (looser trend context) don't beat the MACD+trend baseline.
- **Mean-reversion + candle:** the principled pairing (candles ARE reversal
  signals). Positive-OOS cells appear (RSI+candle PF 1.45/48tr, BB+candle PF
  1.98/15tr) but every one has a strongly NEGATIVE train half — the inverted
  split is the tell: the candle gate carves out a small subset that happened to
  win in the test window, not a stable edge. Zone-alone is negative; the "lift"
  is overfitting, not confirmation.

**Candlestick verdict (all three forms tested): no reliable predictive value on
gold 1h** — standalone (overfit, earlier), as trend confirmation (sample
destruction), or as reversal confirmation (inverted-split flukes). The best
strategy of the whole pass, MACD+trend+widening, uses no candlesticks.

## Honest expectations / caveats

- **The edge is thin.** PF ~1.05 and avgR ~+0.05R in good periods. This is a real but marginal edge, not a transformation. Re-tuning improves the *size* of the win, not the *frequency* of winning periods.
- **Regime-dependent.** ~1/3 of the time (e.g. 2024-07, 2025-07) the mechanism loses regardless of params. A regime filter (only trade this when some external condition holds) is a separate, unexplored improvement.
- **Instrument-specific.** The same sweep on GLD (gold ETF, RTH-only gappy bars) found **0/120 robust** — this edge lives in 24h-futures bar structure, not gold price per se. Keep these strategies on GC=F, not on gold ETFs.
- **Selection caveat honored:** the recommended params were confirmed on walk-forward blocks the train/test selection did not optimize, not just the single split that surfaced them.

## Out of scope (not yet validated)

- `research-25` / `research-26` are **DI-Cross** (crossover of +DI over −DI), a different trigger than DI-Dominance *widening*. They were not swept. A separate sweep is needed before any claim about them.
- The other approved families (RSI-50 momentum, MACD-flip, Engulfing, Liquidity-Sweep) are untouched by this analysis.

## To apply later

Update `research-30` and `research-22` `code` + TP fields in the DB (via a script analogous to `scripts/approve-strategy.ts`), then re-export their Obsidian notes. Not done here per the "proposal first" decision.
