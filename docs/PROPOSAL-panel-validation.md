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

> **As built (2026-08-25).** The expanding-window layout below was proposed and then **not**
> shipped, because it does not do what §2 requires. Read the correction first; the original is
> kept underneath it because the reason it failed is the useful part.

### Shipped: one FIT, one SELECT, three chronological TEST folds

```
FIT      2016-01-01 .. 2019-01-01   post-2015 correction recovery through the 2018 Q4 selloff
SELECT   2019-01-01 .. 2020-01-01   2019 melt-up on falling rates
TEST 1   2020-01-01 .. 2022-01-01   COVID crash and the liquidity-driven recovery
TEST 2   2022-01-01 .. 2024-01-01   rate-hike bear market and the 2023 recovery
TEST 3   2024-01-01 .. 2027-01-01   2024-2026 bull, AI-concentrated leadership
```

Five folds, every one disjoint from every other, and **every TEST fold strictly after both
fitting folds in wall-clock time**. `FOLDS` in `src/lib/research/panel.ts` is the authority;
`panel.test.ts` asserts the disjointness and the ordering, so this cannot drift silently.

**Why the expanding layout had to go.** Look at what it schedules:

```
split 1   TRAIN 2016-01..2018-12                 TEST 2020-01..2021-12
split 3   TRAIN 2016-01..2022-12  <-- contains ---^^^^^^^^^^^^^^^^^^^^
```

Split 3's TRAIN window **contains split 1's and split 2's TEST windows**. So by split 3 the
loop is refining code and sweeping ladders on bars it has already been measured against — and
the requirement that a candidate clear *all three* splits makes that worse, not better: it is
precisely the candidate that survives splits 1–2 which then gets fitted to them in split 3.
That is the same fault as §1c, reintroduced one layer up. Expanding-window walk-forward is a
sound method when each split is a separate model; it is not sound when one candidate must pass
every split, which is what §2 asks for.

Fitting once, at the start, and never touching the later data is the only layout that keeps
§2's "untouched by all four steps" true for all three TEST folds at once.

**The honest cost.** FIT ends in 2018, so a candidate is fitted on a market seven years stale by
the time it is deployed. For validation that is a feature — surviving it is evidence the
mechanism is not regime-specific. For tuning it is a real limitation, and it is the price of
having any untouched data left at all given that the cache starts in 2016.

- **FIT** — propose, refine, sweep the ladder.
- **SELECT** — the approve/reject decision (`autoReviewStatus`).
- **TEST x3** — read once by `runBlindTest`, reported, never gated on.

A candidate must clear the bar in **all three** TEST folds, not on their average. Averaging lets
one strong regime carry two dead ones, which is the exact failure mode the desk already lived
through with research-29. The three folds are roughly 9 effective observations against today's
1 — a real improvement, and still not a large number. Say so in the write-up rather than
rounding it up.

### Superseded: the expanding-window proposal

Use the cache's full depth in an expanding-window walk-forward with **three** test folds rather
than one — because a single test fold is a single regime, and (b) says one regime is worth about
three observations:

```
split 1   TRAIN 2016-01..2018-12   SELECT 2019-01..2019-12   TEST 2020-01..2021-12
split 2   TRAIN 2016-01..2020-12   SELECT 2021-01..2021-12   TEST 2022-01..2023-12
split 3   TRAIN 2016-01..2022-12   SELECT 2023-01..2023-12   TEST 2024-01..2026-08
```

Split by **time and not by symbol** — that part stands, and the shipped layout keeps it. The
expanding TRAIN window is the part that does not.

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

> **Measured after building it (2026-08-25): a full round is ~8-10 minutes, not the 1-2 hours
> estimated below.** The estimate assumed a 10.6y backtest per symbol per fold; the shipped
> folds are 1-3y each, and the entry/exit split (step 2) removed the sweep's dominant cost by
> computing signals once per symbol per fold and re-running only the exit simulation — for the
> 8-option ladder sweep and for all 200 control runs alike. Without that split a control would
> have cost 200x a backtest instead of roughly 1x, and this gate would have been unaffordable
> rather than merely slow.

The original estimate, kept because the per-symbol figure is still the right unit to reason in:
**300 ms per symbol** for a full 10.6y backtest including snapshots (snapshots are 2% of that;
the cost is the simulation loop).

```
491 symbols, one candidate, one fold       ~2.5 min
3 candidates x 3 folds                     ~22 min
ladder sweep, 8 options, TRAIN fold only   ~20 min per candidate
```

Three walk-forward splits multiplies that again — a full round lands in the **1-2 hour** range.
Fine for a nightly job, wrong for anything interactive.

Two mitigations, in payoff order:

- **Separate entry from exit in the sweep.** The 8 ladder options share one entry signal, so entry
  indices can be computed once per symbol and only the exit simulation re-run. That is most of the
  20 minutes. **Shipped** — see the note above.
- **Sweep the ladder on a 100-symbol subsample**, then confirm the winner on the full panel. The
  ladder choice is not a knife-edge decision. **Not shipped, and not needed** at 8-10 min/round.

Also drop the research schedule from daily to **weekly**.

> **Shipped, but the reason changed.** At 8-10 minutes a round, cost is no longer an argument for
> weekly — the machine could easily run it nightly. The argument that survives is **multiple
> testing**: 3 candidates a day is ~1,100 blind tests a year against a p95 control bar, which
> expects ~55 false passes a year by construction. 3 a week is ~156, expecting ~8. Neither number
> is comfortable, and the gate does not correct for multiplicity at all (§7) — but an order of
> magnitude fewer draws against a fixed threshold is the cheapest available mitigation.

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
- **Multiple testing.** The p95 control bar is a per-candidate threshold with no correction for
  how many candidates were tried. At 3 a week that is ~156 draws a year and ~8 expected false
  passes; nothing here counts them. The weekly cadence (§5) reduces the draw count and does not
  correct the threshold. A proper fix is a false-discovery-rate adjustment over the round's
  candidates, or a stricter percentile — both are separate work.

## 8. Implementation order

**All seven shipped 2026-08-25.** Where the build deviated from the plan, the deviation is
recorded in the section it belongs to rather than here.

1. ~~`src/lib/research/panel.ts`~~ — **done.** Loads the cache, exposes `FOLDS` (not `SPLITS`;
   §3), `foldSlice(bars, fold, warmup)`, and the `fetchedAt` stamp. Pure, no network,
   memoized, and it never falls back to a live fetch — a missing cache throws with a rebuild
   hint rather than silently validating against different data. `PANEL_WARMUP_BARS = 250` real
   prior bars inform each fold's indicators without ever being tradable, because Wilder
   smoothing carries a long memory and a fold sliced cold misreads its own opening stretch.
2. ~~Entry/exit separation in `backtestCandles`~~ — **done.** This is what took a round from the
   estimated 1-2 hours to 8-10 minutes (§5).
3. ~~`src/lib/research/control.ts`~~ — **done.** Matched random-entry control and monthly block
   bootstrap, both seeded from a constant `PANEL_SEED` rather than a parameter: a caller able to
   choose the seed is a caller able to retry until the control loses.
4. ~~Rewire `runOneCandidate` / `sweepLadder` to FIT, `autoReviewStatus` to SELECT~~ — **done.**
5. ~~Rewrite `runBlindTest` against the TEST folds; delete the 365-day-cutoff path~~ — **done.**
   All three folds must pass, ANDed not averaged.
6. ~~`validation` column; gate desk eligibility on `panel-v1`~~ — **done.** Enforced in one
   place, `getResearchStrategy` in `src/lib/research/adapter.ts`. The 84 legacy rows keep their
   status and their history and stop being eligible. `runBlindTest` additionally **refuses** a
   non-`panel-v1` row rather than measuring it, because comparing a panel fold against a
   single-symbol baseline and calling the ratio "retention" is the §1c fault again.
7. ~~Move the schedule to weekly~~ — **done in code** (`scheduledResearch.ts` rotates per week).
   The Windows Task Scheduler entry is a system change and is the owner's to run.

Scope taken beyond the seven, all in service of the same principle — **a removed parameter
should refuse, not be silently ignored**, because a caller who asks for AAPL and quietly gets a
491-symbol panel is the exact bug class this change exists to end:

- `runResearch`'s `symbol`/`interval`/`range` parameters were **removed** rather than defaulted,
  so a stale caller fails to compile instead of running something else.
- `POST /api/research` returns **400** if any of those three fields is present.
- `ResearchPanel.tsx` lost its symbol box and both dropdowns, replaced by a static
  `S&P 500 panel - 1d - fit 2016-2018` chip.
- Seven historical `scripts/dispatch-*.ts` one-offs were **deleted** — they dispatch GC=F /
  BTC-USD / 15m / 1h / 1wk runs the panel signature cannot express. Git retains them.
- The hardcoded `1.2` refinement yardstick became `REFINEMENT_LADDER = LADDER_OPTIONS[0]`
  (1.5/1.5), so refinement is judged against a ladder the sweep can actually pick.
