# Proposal: replace single-symbol validation with a walk-forward panel

Status: **proposal, nothing implemented.** Written 2026-08-25 from the measurements below.
Adopting it invalidates every stored `backtestSummary` as a basis for comparison, so it needs an
explicit decision before any code moves.

## 1. What is actually broken

Three findings, all measured, not inferred.

### (a) The sample is tiny, and depth does not fix it

Across the 128 non-mock research candidates that carry a backtest:

```
ALL non-mock  n=128  median=23 trades  p75=89   >= MIN_TRADES(20): 65/128
DAILY (1d)    n= 18  median= 4 trades  p75=10   >= MIN_TRADES(20):  1/18
```

The daily group already contains `5y/1d` and `max/1d` runs. Fetching deeper history did not move
the median off 4. The cause is that `runResearch` backtests **one symbol**
(`src/lib/research/runResearch.ts:300`), and a daily swing rule fires a handful of times a year.

The round that finished while this was being written is the same story again — run #110,
`stocks-meanrev`, AAPL `1d/2y`, three candidates, all rejected at **4, 4 and 5 trades**. Nothing
about those three proposals was evaluated. They failed a counting test.

### (b) Breadth is not the same thing as regime diversity

Measured on `.cache/bars/sp500-1d.json` (491 symbols, 2016-01-04 .. 2026-08-14, 1,277,489 bars):

| window | symbols | % up | ret p10 / med / p90 | avg pairwise corr | N_eff |
|---|---|---|---|---|---|
| 2016–2018 | 470 | 83% | −12 / 39 / 101% | 0.312 | 3.2 |
| 2019–2020 | 477 | 87% | −7 / 46 / 127% | 0.467 | 2.1 |
| 2021–2022 | 483 | 72% | −26 / 16 / 66% | 0.350 | 2.8 |
| 2023–2024 | 488 | 75% | −20 / 23 / 108% | 0.242 | 4.1 |
| last 2y | 489 | 69% | −27 / 17 / 94% | 0.345 | 2.9 |

Individual names disagree enormously in *magnitude* (p10 −27% vs p90 +94% over the last two
years) but agree on *direction*: average pairwise daily-return correlation is 0.24–0.47, and no
window has fewer than 69% of names up. `N_eff = N / (1 + (N−1)ρ)` says 491 correlated names carry
roughly **3 independent observations** of market direction.

Read that bound honestly. It is the pessimistic end, exact when a strategy's return is
essentially a bet on market direction. A strategy whose entries are genuinely scattered in time
across names does better than 3. But all four rotation briefs
(`src/lib/research/scheduledResearch.ts:38`) ask for long-biased daily equity swing entries, which
sits near the pessimistic end rather than the optimistic one.

Consequence: **breadth fixes the trade count, depth fixes the regime count, and they are not
substitutes for each other.** Note also that ρ itself moves with the regime — 0.467 through the
COVID window where everything moved together, 0.242 in 2023–2024. Different years are structurally
different markets, and no amount of cross-section recovers that.

### (c) The blind test overlaps its own training data

`blindTest.ts:208` takes the held-out set as every bar *older* than the last 365 days of a `5y`
fetch, while the in-sample number it compares against is the stored `backtestSummary` from a `2y`
fetch. Measured on AAPL:

```
in-sample  (2y/1d)   2023-09-22 .. 2026-08-21   (2.9y - "2y" is a bar count, not a date range)
deep fetch (5y/1d)   2021-11-10 .. 2026-08-21   (4.8y - Webull's 1200-bar ceiling)
cutoff = last - 365d                2025-08-21
held-out             2021-11-10 .. 2025-08-21
overlap              2023-09-22 .. 2025-08-21   =  1.92y
```

**66% of the in-sample window sits inside the "held-out" set.** The gate re-tests the candidate on
data it was fitted to. `MIN_HOLDOUT_RETENTION = 0.5`, added in `158df23`, therefore compares two
samples that overlap by two thirds: measured retention is biased upward and the bar is weaker than
its own docstring claims.

## 2. Design principle

Every step that *looks at a number and then changes something* is fitting. There are four, and
they currently all run on the same bars:

| step | where | what it fits |
|---|---|---|
| propose | `proposeCandidates` | the mechanism — blind to data today, keep it that way |
| refine | `runOneCandidate`, `MAX_REFINEMENT_ROUNDS = 2` | the code, against backtest output |
| sweep exits | `sweepLadder` over 8 `LADDER_OPTIONS`, selected on avgR | the exit geometry |
| gate | `autoReviewStatus` | approve / reject |

Only a fold untouched by all four is worth anything. So: **three disjoint folds, split by time,
each using all 491 symbols.**

Split by **time and not by symbol**. With ρ ≈ 0.31, two halves of the symbol universe over the
same dates are close to being the same observation twice.

## 3. Fold layout

Use the cache's full depth in an expanding-window walk-forward with **three** test folds rather
than one — because a single test fold is a single regime, and (b) says one regime is worth about
three observations:

```
split 1   TRAIN 2016-01..2018-12   SELECT 2019-01..2019-12   TEST 2020-01..2021-12
split 2   TRAIN 2016-01..2020-12   SELECT 2021-01..2021-12   TEST 2022-01..2023-12
split 3   TRAIN 2016-01..2022-12   SELECT 2023-01..2023-12   TEST 2024-01..2026-08
```

- **TRAIN** — propose, refine, sweep the ladder.
- **SELECT** — the approve/reject decision (`autoReviewStatus`).
- **TEST** — read once, reported, never gated on.

Train always precedes test in wall-clock order, matching how the thing would actually be deployed.

The three TEST folds cover the COVID crash plus the 2021 melt-up, the 2022 bear, and the 2024–2026
bull. That is roughly 9 effective observations against today's 1 — a real improvement, and still
not a large number. Say so in the write-up rather than rounding it up.

A candidate must clear the bar in **all three** splits, not on their average. Averaging lets one
strong regime carry two dead ones, which is the exact failure mode the desk already lived through
with research-29.

## 4. Pass bar — pre-register it before looking at any candidate

At 491 symbols the current `MIN_TRADES = 20` is met trivially (a toy 20-bar breakout produced
8,555 trades across 120 symbols, with all 120 trading) and stops carrying information. Replace it
with four bars:

1. **Participation.** ≥ 200 trades in the TEST fold **and** ≥ 100 distinct symbols that traded.
   Blocks a result driven by three names.

2. **Beats a matched random-entry control.** This is the important one. Run N = 200 controls on
   the same fold, same symbols, same exit ladder, same cost model, with entry timestamps drawn at
   random but matched to the strategy's trades-per-symbol. Require the strategy's avgR to exceed
   the **95th percentile** of the control distribution. With 69–87% of names up in every window, a
   long-biased rule shows positive expectancy from beta alone; the control is what separates edge
   from beta.

3. **Block-bootstrapped confidence.** Resample **calendar months with replacement, taking all
   symbols within a sampled month together.** That preserves the cross-sectional correlation
   measured in (b), which a naive per-trade bootstrap throws away and thereby badly overstates
   significance. Require the 5th percentile of bootstrapped TEST avgR > 0.

4. **Retention.** Keep `MIN_HOLDOUT_RETENTION = 0.5`, but now measured between genuinely disjoint
   folds, where it finally means what its docstring says.

Bar (2) is also what makes the survivorship-biased cache usable: the control absorbs the same
bias, so the *comparison* is bias-cancelling even though neither side is bias-free. It does not
make the absolute numbers trustworthy — those stay inflated and must be reported relative to
control, never as a standalone expectancy.

## 5. What it costs

Measured: **300 ms per symbol** for a full 10.6y backtest including snapshots (snapshots are 2% of
that; the cost is the simulation loop).

```
491 symbols, one candidate, one fold       ~2.5 min
3 candidates x 3 folds                     ~22 min
ladder sweep, 8 options, TRAIN fold only   ~20 min per candidate
```

Three walk-forward splits multiplies that again — a full round lands in the **1–2 hour** range.
Fine for a nightly job, wrong for anything interactive.

Two mitigations, in payoff order:

- **Separate entry from exit in the sweep.** The 8 ladder options share one entry signal, so entry
  indices can be computed once per symbol and only the exit simulation re-run. That is most of the
  20 minutes.
- **Sweep the ladder on a 100-symbol subsample**, then confirm the winner on the full panel. The
  ladder choice is not a knife-edge decision.

Also drop the research schedule from daily to **weekly**. A daily cadence on a 1–2 hour job that
yields roughly one keepable candidate a month is not buying anything.

## 6. Migration

The 128 non-mock rows cannot be compared against panel results — different universe, different
window, different bar. Do not delete them and do not silently re-score them. Add a `validation`
column (`legacy-single-symbol` | `panel-v1`) and require `panel-v1` before a candidate is eligible
for the desk. The 6 currently-approved rows are off-universe anyway (`STATE.md` §4b: BTC-USD,
GC=F, NG=F) and would fail on universe grounds before validation even ran.

## 7. What this does not fix

- **Survivorship bias.** `sp500-1d.json` holds today's constituents, so names delisted between 2016
  and 2026 are absent. §4 bar (2) cancels most of its effect on the comparison; it does not make
  the absolute numbers honest. A point-in-time constituent list is the real fix and is separate
  work.
- **Idealised stop fills.** The engine fills stops at the stop price. Untouched here, still
  `STATE.md` §4d.
- **Cache reproducibility.** The cache carries a `fetchedAt` (`2026-08-16T20:39:45Z`). Pin it into
  every stored result so a re-run is comparable. That is the whole provider question reduced to one
  field — and it is why the Webull-vs-Alpaca argument in §4a largely dissolves once backtests read
  the cache instead of the API.
- **HAWK / SAGE.** None of this touches the fact that no live trade has ever been decided by the
  agents. A validated strategy is a precondition for that test, not the test itself.

## 8. Implementation order

1. `src/lib/research/panel.ts` — load the cache, expose `SPLITS`, `foldBars(symbol, fold)`, and the
   `fetchedAt` stamp. Pure, testable, no network.
2. Entry/exit separation in `backtestCandles` so the ladder sweep stops re-simulating entries.
3. `src/lib/research/control.ts` — the matched random-entry control and the monthly block
   bootstrap. Pure functions, unit-tested against a known-null signal.
4. Rewire `runOneCandidate` and `sweepLadder` to TRAIN, `autoReviewStatus` to SELECT.
5. Rewrite `runBlindTest` against TEST with the §4 bar. Delete the 365-day-cutoff path.
6. `validation` column + migration; gate desk eligibility on `panel-v1`.
7. Move the schedule to weekly.

Steps 1–3 are self-contained and land without changing a single stored row, so they can go in
ahead of the decision on the rest.
