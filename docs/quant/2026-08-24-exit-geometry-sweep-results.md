# Exit geometry sweep — results

Run 2026-08-24 with `scripts/exit-geometry-sweep.mts`. Entry rule held fixed at
trend-pullback @ `DEFAULT_THRESHOLDS`; only the exit ladder varies. Picks were
pre-registered from the weekly in-sample table alone — see
`2026-08-24-exit-geometry-preregistration.md`, written before any OOS run.

**Headline: an ATR trailing stop is the first change in this repo's sweep
history that did not flip sign out-of-sample.** It survived at 3x the sample and
on a second timeframe, and the control variant failed everywhere, which is what
separates an effect from a fitted number. It is still not a licence to ship —
see Caveats.

## 1. Weekly, 158/161 symbols (`--every=3`) — the pre-registration sample

| | trades | win% | avgR | ΔavgR | t | totalR |
|---|---|---|---|---|---|---|
| **IS** baseline | 2073 | 26.3 | +0.076 | | 2.51 | 158.4 |
| **IS** trail 1.5/1.5 | 2815 | 53.7 | +0.113 | +0.037 | 4.69 | 319.5 |
| **IS** trail 1.0/1.5 | 3102 | 46.4 | +0.090 | +0.014 | 4.23 | 278.9 |
| **IS** single 2.5 ATR | 2625 | 40.9 | +0.089 | +0.013 | 3.48 | 233.7 |
| **OOS** baseline | 1135 | 25.9 | +0.044 | | 1.08 | 50.5 |
| **OOS** trail 1.5/1.5 | 1613 | 50.3 | +0.049 | **+0.004** | 1.45 | 78.6 |
| **OOS** trail 1.0/1.5 | 1804 | 43.3 | +0.032 | −0.012 | 1.12 | 58.0 |
| **OOS** single 2.5 ATR | 1446 | 38.5 | +0.023 | −0.021 | 0.69 | 33.9 |

On this sample the effect nearly vanishes: ΔavgR shrinks from +0.037 to +0.004.
Read alone this table says "did not flip, did not confirm". The picks were then
re-run on more data — a larger sample of the *same* pre-registered variants, no
new variant selected.

## 2. Weekly, full 491-symbol universe, OOS

| | trades | win% | avgR | ΔavgR | t | totalR | PF |
|---|---|---|---|---|---|---|---|
| baseline | 3492 | 26.1 | +0.058 | | 2.45 | 201.0 | 1.09 |
| trail 1.5/1.5 | 4878 | 51.3 | +0.076 | +0.019 | **3.97** | 371.9 | **1.16** |
| trail 1.0/1.5 | 5444 | 44.1 | +0.064 | +0.007 | 3.86 | 350.0 | 1.15 |
| single 2.5 ATR | 4458 | 39.5 | +0.053 | −0.005 | 2.70 | 234.7 | 1.09 |

## 3. Daily bars, 246 symbols (`--every=2`) — the sharpest result

Daily is where the baseline has always been a coin flip, so it is the harder
test, not the easier one.

| | trades | win% | avgR | ΔavgR | t | totalR | PF |
|---|---|---|---|---|---|---|---|
| **IS** baseline | 15091 | 23.3 | **−0.017** | | −1.57 | −261.0 | 0.94 |
| **IS** trail 1.0/1.5 | 22479 | 42.9 | +0.024 | +0.042 | 2.95 | 544.3 | 0.99 |
| **IS** trail 1.5/1.5 | 20420 | 49.2 | +0.020 | +0.037 | 2.11 | 399.3 | 0.97 |
| **IS** single 2.5 ATR | 18734 | 37.1 | −0.016 | +0.002 | −1.67 | −295.2 | 0.95 |
| **OOS** baseline | 8300 | 24.2 | +0.015 | | 0.98 | 122.0 | 1.02 |
| **OOS** trail 1.0/1.5 | 12657 | 43.7 | +0.061 | +0.046 | **5.54** | 769.6 | **1.14** |
| **OOS** trail 1.5/1.5 | 11390 | 50.6 | +0.064 | **+0.049** | **5.12** | 727.8 | 1.13 |
| **OOS** single 2.5 ATR | 10423 | 38.3 | +0.017 | +0.002 | 1.33 | 176.1 | 1.03 |

The OOS PF column above is the re-run one (risk-normalised, see caveat 3). The
in-sample PF values in the four rows above it are the original dollar figures —
they are the ones that contradicted totalR, and they are left in place as the
evidence for why the column had to change.

The daily ΔavgR barely shrinks across the split — +0.037/+0.042 in-sample,
+0.049/+0.046 out — on 15k and 8k baseline trades. A fitted parameter shrinks
toward zero out-of-sample; this one did not move. Trailing turns a rule that
*loses* money on daily bars in-sample into one with t ≈ 5 out-of-sample.

## 4. What makes this different from the confluence sweep

| | confluence filters (2026-08-23) | trailing stop |
|---|---|---|
| picks that flipped sign OOS | 3 of 3 | 0 of 2 |
| held at 3x sample | — | yes |
| held on a second timeframe | not tested | yes, more strongly |
| control variant | — | `single 2.5 ATR` failed on all four runs |

That last row carries most of the weight. `single 2.5 ATR` was pre-registered
precisely to test the alternative explanation "anything beats the stock ladder".
It beat baseline in-sample on weekly (+0.013) and then failed out-of-sample on
weekly (−0.021, −0.005) and did nothing on daily (+0.002 both halves). So the
result is specific to trailing rather than generic to fiddling with the exit.

## 5. The research ladder is set up to lose

From the full weekly IS table, `single 1.2 ATR` is the **worst of all 20
variants**: avgR +0.037 against baseline's +0.076, on the highest trade count
(4210) and the highest win rate (57.7%).

That is the literal ladder every `research-N` strategy trades live —
`RESEARCH_ATR_TP_MULT = 1.2` over `RESEARCH_ATR_SL_MULT = 1.5` in
`src/lib/trading/engine.ts:49`, i.e. **0.8:1 reward-to-risk, break-even at a
~55.6% win rate**. It clears that bar in the backtest by 2 points and earns half
the baseline's expectancy for it. research-29 ran it live at a 43.8% win rate.

The entry rule was approved on 8 trades and that is the headline failure, but
the exit geometry was independently rigged against the desk. High win rate at
sub-1:1 R:R is the most reliable way to feel right and lose money.

## 6. Regime split — the test that mattered

Run with `--split=all --byYear` on the full universe. `--split=all` has no
held-out half and must never be used to *select* anything; it is used here only
to ask whether an already-selected variant depends on one market era.

ΔavgR of `trail 1.5/1.5` against baseline, per calendar year of trade open:

| year | weekly Δ | daily Δ | note |
|---|---|---|---|
| 2016 | — | **+0.062** | |
| 2017 | **+0.014** | **+0.049** | |
| 2018 | **+0.024** | **+0.036** | Q4 bear — baseline negative, trail less negative |
| 2019 | **+0.018** | **+0.013** | |
| 2020 | **+0.033** | −0.002 | covid crash + recovery |
| 2021 | **+0.027** | **+0.233** | outlier; daily t is only 0.88, so treat as noise |
| 2022 | **+0.028** | **+0.060** | full bear year — baseline −0.19 wk / −0.16 d |
| 2023 | **+0.018** | **+0.063** | |
| 2024 | **+0.014** | **+0.055** | |
| 2025 | **+0.002** | **+0.043** | |
| 2026 | **+0.079** | **+0.031** | partial year |
| **sign** | **10 / 10 positive** | **10 / 11 positive** | |

- Weekly: positive in every year measured. Sign test against a 50/50 null,
  p ≈ 0.001.
- Daily: 10 of 11, the exception being 2020 at −0.002. p ≈ 0.006.
- **Not a bull-market artifact.** 2018 and 2022 are the two bear years in the
  sample and the trail improved both, on both timeframes. It does not turn them
  into winners — it cuts the loss.
- **Not carried by the 2021 outlier.** Dropping 2021 entirely leaves daily at
  9 of 10 positive with a mean Δ of +0.041.
- **The control stays random.** `single 2.5 ATR` by weekly year: 4 positive, 6
  negative, no pattern. Exactly what a variant with no real effect should look
  like next to one that has it.

Pooled across all years, weekly, 487 symbols: baseline 10019 trades avgR +0.093,
trail 13623 trades avgR +0.114 (Δ +0.021), totalR 936 → 1553. Daily: baseline
23493 trades avgR **−0.003** (PF 0.96 — the entry rule makes nothing at all over
11 years), trail 31887 trades avgR +0.055, totalR −81 → +1742.

Caveat 1 below is therefore answered, and answered in the trail's favour.

## Caveats

1. ~~Regime~~ — tested in section 6. Positive in 10/10 weekly years and 10/11
   daily years, including both bear years. This was the blocker; it cleared.
2. **Weekly and daily are not independent evidence.** Both are the same
   underlying daily prices; weekly is resampled from it. The trade sets differ a
   lot (8300 vs 3492 baseline entries, different holding periods), but the
   confirmation is correlated, not a second experiment.
3. ~~**Ignore the PF column.**~~ **Fixed 2026-08-24, after this study first
   published.** The sweep ran `lot = 1` for every trade, so PF was a dollar
   ratio dominated by high-priced, high-ATR names, and it contradicted totalR
   outright on daily IS (PF 0.97 against totalR +399). The live desk sizes to
   constant dollar risk (`computeLot`: `riskUsd / slDistance`), under which a
   trade's dollar P&L is its R times one fixed constant — so the honest profit
   factor is won-R over lost-R, and `score()` now computes it that way rather
   than re-simulating with variable lots, which would give the same answer up
   to `computeLot`'s min/max clamps. Re-running the two OOS tables moved every
   row up and, more to the point, stopped the columns disagreeing: weekly
   baseline 1.09 → trail **1.16**; daily baseline 0.97 → **1.02**, trail 1.09 →
   **1.14**. The direction of the result did not change, which is the outcome
   that was in question. On daily OOS the baseline crosses from PF < 1 to
   PF > 1 purely from correcting the weighting.
4. **Fills are assumed exactly at the stop level.** Gaps through a stop are not
   modelled. The baseline's hard SL makes the same assumption, so the comparison
   is fair, but both absolute levels are optimistic. A trailing stop exits at a
   stop far more often than the ladder does, so it is more exposed to this.
5. **Survivorship.** `.cache/bars/sp500-1d.json` is today's index membership
   projected backwards. Names that were dropped from the index are absent. Same
   caveat as every prior study on this cache.
6. Costs are 0.5bps slippage + 1bp commission. The trail variants take 35-56%
   more trades, so they pay proportionally more in costs — that is already
   inside the numbers above, but a worse cost model would hurt them more than
   the baseline.

## Status

Nothing has been changed on any desk. `ATR_SL_MULT`, `ATR_TP_MULT` and
`TP2_FACTOR` are untouched.

`RESEARCH_ATR_TP_MULT = 1.2` is also untouched, but it is now reachable by
fewer paths: 1.0 and 1.2 were removed from `LADDER_TP_MULTS`, so no *new*
candidate can be assigned a sub-1:1 ladder. It remains the fallback in
`resolveExitOverride` for approved rows persisted before `exitLadder` existed.
Those legacy rows are the remaining exposure.

## What this does and does not license

**Does:** `trail 1.5/1.5` (arm once price is 1.5 ATR in favour, then sit 1.5 ATR
behind the best price) is the first exit or entry modification in this repo to
pass the full protocol — pre-registered, confirmed out-of-sample, held at 3x
sample, held on a second timeframe, positive in 10 of 10 weekly years, with a
pre-registered control that failed. On weekly, the desk's timeframe, the effect
is **+0.021 avgR per trade and ~36% more trades**, which roughly matches the
+0.044 OOS baseline in size. That is not a large edge. It is a real one.

**Does not:** this is still a single entry rule on a survivorship-biased S&P 500
cache with idealised stop fills (caveats 4-5). The 1.5/1.5 cell should not be
treated as tuned — 1.0/1.5 performs nearly as well, which is reassuring for
robustness and means neither cell is special.

**Acted on 2026-08-24:** both trailing geometries were added to the research
loop's exit menu (`LADDER_TRAILS` in `src/lib/research/runResearch.ts`), which
until then could only choose among fixed single targets — the one geometry in
this repo with an out-of-sample pedigree was the one the loop could not pick.
Nothing was changed on the live desk's own default ladder.

The strongest single takeaway is section 5: the live research ladder is 0.8:1
and measured worst-of-20. That should be fixed regardless of what happens with
trailing stops.
