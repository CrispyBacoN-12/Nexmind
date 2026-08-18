# Cross-Sectional Mean Reversion on US Stocks — Point-in-Time Membership Re-Run

**Date:** 2026-08-18
**Spec:** `docs/superpowers/specs/2026-08-15-cross-sectional-mean-reversion-design.md`
**Plan:** `docs/superpowers/plans/2026-08-18-point-in-time-membership.md`
**Code:** `src/lib/backtest/crossSectional/`, `src/lib/backtest/crossSectional/membership.ts`,
`scripts/sweep-cross-sectional.mts`, `scripts/walkforward-cross-sectional.mts`

## What changed from the 2026-08-15 run

The membership gate — plus one thing this task's plan text didn't anticipate: this run's bar
cache (`.cache/bars/sp500-1d.json`, fetched 2026-08-16) is also different from the one behind
the 2026-08-15 doc, and covers a longer, more recent span (~10 years vs ~5.3 years; see "How
this was measured" below). That cache difference wasn't part of this task's design — it was
already sitting in this worktree when this task started.

Because of that, this doc's numbers are not a clean A/B against the 2026-08-15 figures. The
actual controlled comparison lives entirely inside this document: the same "best" config run
twice on the *same* cache, once with the point-in-time membership gate on (`pit=y`, the main
scorecard below) and once with it off (`pit=n`, the "For comparison" block below). That pair is
what isolates the gate's effect. The 2026-08-15 numbers should be read only for shape (REJECTED
then, REJECTED now) rather than compared value-for-value — and that doc's own 2026-08-17
addendum already flags its specific figures (profit factor, return, drawdown, rank correlation)
as unreliable measurements in the first place, for reasons unrelated to this task.

Every gate, threshold, config value, train/test split fraction, and cost model is otherwise
identical to the original run — this is a data-correctness re-run, not a re-cut of the
hypothesis. Candidate selection is now gated on real point-in-time S&P 500 membership
(`src/lib/backtest/crossSectional/membership.ts`), instead of applying today's S&P 500 list
uniformly across the entire backtest history.

This fixes look-ahead inclusion (a symbol traded as a candidate before it actually joined
the index) and stale inclusion (a symbol kept trading as a candidate after it actually left).
It does **not** fix omission bias for names that left the S&P 500 before
`.cache/bars/sp500-1d.json` was ever built — those tickers have no cached price history and
cannot appear as candidates regardless of what the membership table says. Every number below
remains an upper bound for that reason.

## TL;DR

**REJECTED.** Adding the point-in-time membership gate does not change the verdict, and it
makes one gate strictly worse. On the "best" config identified in the 2026-08-15 sweep
(atrReturn, k=3, sma200=y, regime=off, slots=10, holdDays=5, stop=off), the walk-forward
gate scorecard now fails **three** gates instead of two:

- **Gate 2 (positive in both halves) newly fails.** Under today's static membership list the
  train/test split was +6981 / +549. Under the point-in-time gate it is +6269 / **−47** — the
  out-of-sample half flips from a small profit to a small loss. Excluding candidate-days where
  a symbol was traded as an S&P 500 member before it actually joined (or after it actually left)
  removed enough of the edge to erase the out-of-sample profit entirely.
- **Gate 4 (parameter plateau) still fails**, on the same evidence as before: the sweep's
  Spearman(trainPF, testPF) across 419 surviving combos is **0.0244** — indistinguishable from
  zero, same finding as the original **−0.016**. In-sample ranking still carries no information
  about out-of-sample ranking.
- **Gate 7 (beats SPY return/maxDD) still fails**, essentially unchanged from the pit=n control
  run on this same cache (strat 3.51 → 3.58, still far short of SPY's 9.54, over the
  2016-10-18…2026-08-14 span). The ratio moved marginally in the strategy's favor — return fell
  (139.9% → 126.9%) but drawdown fell more (39.9% → 35.4%) — see the pit=n comparison later in
  this doc.

The mechanism was already rejected on 2026-08-15. Point-in-time membership does not rescue it —
if anything, it tightens the rejection by turning a previously-passing gate (positive in both
halves) into a failing one.

## How this was measured

- **Data:** `.cache/bars/sp500-1d.json`, 491 S&P 500 symbols, fetched 2026-08-16T20:39:45.212Z.
  This is a different (larger, more recent) bar cache than the one behind the 2026-08-15 doc —
  it was already present in this worktree, vendored separately from this task, and spans
  **2016-10-18 … 2026-08-14** per the walk-forward script's own tradable-span calculation
  (`times[200]` … last bar). This re-run does not attempt to reproduce the 2026-08-15 cache's
  exact calendar span; the point of this task is isolating the effect of the membership gate,
  not the effect of the cache refresh. Both runs below (sweep and walk-forward) read this same
  cache.
- **Point-in-time membership:** `.cache/sp500-membership.csv`, 2,718 snapshots spanning
  1996-01-02…2026-06-30, vendored from `fja05680/sp500` by `scripts/fetch-sp500-membership.mts`
  (Task 2 of this plan). `buildMembershipIndex` performs a binary search for the latest
  snapshot on or before each candidate day and checks whether the symbol was a member as of
  that snapshot (Task 1). A day before the first snapshot has no members; a day after the last
  snapshot uses the last snapshot (today's list) — the same "current membership" fallback the
  unfixed code always used, so the correction only ever removes candidate-days, never adds them.
- **Universe haircut caveat:** `dow30-1d.json` is present in this worktree's `.cache/bars/` (it
  was added after an earlier draft of this document flagged its absence), so gate 6 (universe
  haircut) below reports a real `dow30 PF=1.07 trades=1964` — not a fallback value. `nasdaq100-1d.json`
  is still not present, so that leg of the haircut comparison (`nasdaq100 (no cache — run
  cache-daily-bars.mts for this universe)`) remains unevaluated; this is a pre-existing limitation
  of this worktree's cache, unrelated to the membership-gate change. With real dow30 evidence,
  gate 6 passes non-trivially: narrowing from sp500 (PF=1.13) to dow30 (PF=1.07) does not improve
  the result, which is the pattern the gate is checking for. Treat gate 6 as **meaningfully
  evaluated for the sp500-vs-dow30 comparison**, with nasdaq100 still an open gap.
- **Costs, warm-up, point-in-time bar discipline, benchmark span:** identical to the
  2026-08-15 run — see that document for the full explanation. Nothing about the engine's
  mechanics changed; only the third `isMember` argument was added, and it defaults to `undefined`
  (gate off) unless the new trailing `pit` CLI flag is passed as `y`.

## The sweep

```bash
node --env-file=.env --import tsx scripts/sweep-cross-sectional.mts sp500 y
```

648 combos over the same 7 axes as 2026-08-15, chronological 65/35 split at **2022-12-02**,
train window from 2016-10-18 (each window warmed by 200 prior bars), point-in-time membership
gate **ON**.

**419 of 648 combos cleared the train bar** (≥500 train trades, train PF ≥ 1.1) — versus 150/648
in the ungated run; the longer cache underlying this run is the reason for the higher raw count,
not the membership gate. Of those 419, 342 had test PF above 1.00 and 213 above 1.10.

Top rows by test profit factor:

| params | trainPF | testPF | testTrades | testDD% |
|---|---|---|---|---|
| atrReturn k=2, sma200=y, regime=spySma200, slots=5, hold=10, stop=off | 1.20 | 1.66 | 400 | 17.3 |
| atrReturn k=2, sma200=n, regime=spySma200, slots=5, hold=10, stop=off | 1.22 | 1.56 | 400 | 22.8 |
| atrReturn k=2, sma200=y, regime=spySma200, slots=10, hold=10, stop=off | 1.12 | 1.47 | 800 | 16.7 |
| atrReturn k=2, sma200=n, regime=spySma200, slots=10, hold=10, stop=off | 1.17 | 1.44 | 800 | 13.6 |
| atrReturn k=2, sma200=y, regime=spySma200, slots=10, hold=10, stop=3 | 1.22 | 1.38 | 846 | 16.2 |
| atrReturn k=3, sma200=n, regime=off, slots=10, hold=10, stop=off | 1.11 | 1.38 | 840 | 18.1 |

The 2026-08-15 "best" config (atrReturn, k=3, sma200=y, regime=off, slots=10, hold=5, stop=off) —
the one carried forward into the walk-forward re-run below — appears at rank **80 of 419** by
test profit factor in this sweep: trainPF 1.11, testPF **1.18**, testTrades 1540, testRet
0.269%, testDD 18.8%, inMkt 93%.

### The train ranking still predicts nothing

**Spearman(trainPF, testPF) across the 419 survivors = 0.0244**, computed from the sweep's full
output table exactly as the 2026-08-15 doc computed its −0.016. Both are indistinguishable from
zero. The fifteen configs with the highest train PF (1.32–1.41) landed in test at 0.93, 1.19,
0.97, 1.13, 1.00, 0.91, 1.12, 1.20, 1.17, 1.12, 1.11, 1.06, 1.23, 0.93, 1.23 — again a spread
centred near breakeven, again no advantage from being best in-sample. The point-in-time gate
does not fix this; a data-correctness fix to *which* candidates are eligible has no reason to
touch the sweep's noise-selection problem, and it does not.

## Gate scorecard — the 2026-08-15 "best" config, point-in-time gate ON

```bash
node --env-file=.env --import tsx scripts/walkforward-cross-sectional.mts sp500 atrReturn 3 off 10 5 off y y
```

```
config: {"measure":"atrReturn","maxRankScore":0,"lookback":3,"minPrice":5,"minDollarVol":10000000,"requireAboveSma200":true,"regime":"off","maxSingleDayMovePct":15,"slots":10,"holdDays":5,"exitOnSma5":false,"stopAtrMult":null,"capital":10000,"regimeSymbol":"SPY"}

point-in-time membership gate: ON (.cache/sp500-membership.csv)

--- walk-forward blocks ---
2016-10-18..2018-06-08     trades=  690 PF=1.29 pnl=    2574 DD=16.3% +
2018-06-08..2020-01-27     trades=  682 PF=1.07 pnl=     638 DD=15.3% +
2020-01-27..2021-09-16     trades=  686 PF=1.05 pnl=     465 DD=39.9% +
2021-09-16..2023-05-06     trades=  688 PF=0.92 pnl=    -908 DD=27.3% -
2023-05-06..2024-12-24     trades=  690 PF=1.16 pnl=    1493 DD=9.5% +
2024-12-24..2026-08-14     trades=  680 PF=1.33 pnl=    3755 DD=16.0% +

--- universe haircut (narrower list = more survivorship bias) ---
dow30        PF=1.07 trades=1964
nasdaq100    (no cache — run cache-daily-bars.mts for this universe)
sp500        PF=1.13 trades=4082

--- gate scorecard ---
PASS  1. >=500 trades per half               train=2664 test=1418
FAIL  2. positive in both halves             train=6269 test=-47
PASS  3. >=5/6 walk-forward blocks           5/6
FAIL  4. parameter plateau                   MANUAL — read the Task 6 sweep table
PASS  5. survives 3x costs                   pnl=9281
PASS  6. no improvement as universe narrows  dow30=1.07 sp500=1.13
FAIL  7. beats SPY return/maxDD              strat=3.58 (126.9%/35.4%) spy=9.54 (322.5%/33.8%) over 2016-10-18..2026-08-14

verdict: FAILED — see above
```

### For comparison: the same command with the gate off (`pit=n`)

This is the smoke-check baseline from Step 3, re-run after `dow30-1d.json` was added to this
worktree's cache so the universe-haircut line reads real values on both sides of this
comparison:

```
--- universe haircut (narrower list = more survivorship bias) ---
dow30        PF=1.07 trades=1964
nasdaq100    (no cache — run cache-daily-bars.mts for this universe)
sp500        PF=1.13 trades=4084

--- gate scorecard ---
PASS  1. >=500 trades per half               train=2666 test=1418
PASS  2. positive in both halves             train=6981 test=549
PASS  3. >=5/6 walk-forward blocks           5/6
FAIL  4. parameter plateau                   MANUAL — read the Task 6 sweep table
PASS  5. survives 3x costs                   pnl=10380
PASS  6. no improvement as universe narrows  dow30=1.07 sp500=1.13
FAIL  7. beats SPY return/maxDD              strat=3.51 (139.9%/39.9%) spy=9.54 (322.5%/33.8%) over 2016-10-18..2026-08-14

verdict: FAILED — see above
```

(The sp500 trade count in the universe-haircut line, 4084, differs from the 4082 quoted in the
`pit=y` block above by 2 trades — the two runs gate different candidate-days by construction, so
a small difference here is exactly what the membership gate is supposed to produce, not a
reproducibility problem. Every other gate value in this pit=n block is bit-for-bit identical to
the original Step 3/4 capture.)

Every other gate value shifts slightly (fewer trades, slightly lower PF per block, gate 5's
cost-stress PnL down from 10380 to 9281) as the gate removes a small number of candidate-days
where a symbol was trading before/after its actual index membership window. The one gate that
flips PASS→FAIL is **gate 2**: the out-of-sample half goes from +549 to −47.

## The failure mode, stated plainly

Not trade starvation — 4,082 trades on the full sp500 universe over this cache's ~10-year span.
The failure is the same two-part failure as 2026-08-15, now joined by a third:

- **It does not beat the alternative.** strat return/maxDD ratio 3.58 vs. SPY's 9.54 over the
  same tradable span (126.9% / 35.4% DD vs. 322.5% / 33.8% DD). This is essentially the same
  shortfall as the pit=n control run on the identical cache (ratio 3.51 vs. SPY's 9.54) — the
  membership gate moved the ratio only slightly, and in the strategy's favor, not against it.
  Either way the strategy — structurally flat until its own SMA200 warms up, and long-only
  mean-reversion in a trending market — could not keep pace with SPY's run over this span.
- **It cannot be tuned reliably.** Spearman(trainPF, testPF) = 0.0244 across 419 survivors.
  Whatever config the sweep hands you, you are picking blind.
- **New in this run: it loses money out-of-sample.** Under point-in-time membership, the
  test half of the walk-forward split is slightly net-negative (−$47 on $10,000 capital). The
  ungated run's out-of-sample profit was already thin (+$549, well under 1% of starting
  capital); removing look-ahead-eligible candidate-days was enough to flip its sign.

## Verdict

**Still REJECTED — and not by a narrower margin.** The point-in-time membership fix does not
rehabilitate this mechanism. Of the three gates that fail (2, 4, 7), gate 2 is newly failing
and gates 4 and 7 remain failing for the same reasons documented on 2026-08-15. Per the spec's
Section 4 protocol, a failed gate ends the investigation here; this document is the deliverable.
Section 5 of the spec (live runner, AI stage, scheduler, Webull routing) does **not** become
plannable for cross-sectional mean reversion.

Gate 6 was re-checked once `dow30-1d.json` became available in this worktree: it now reports a
real `dow30 PF=1.07 trades=1964` instead of the earlier no-cache fallback of `0.00`. This does
**not** change gate 6's outcome (still PASS — narrowing to dow30 does not improve on sp500's
1.13) and does **not** change the overall verdict — the same three gates (2, 4, 7) fail either
way. The only thing that changed is that gate 6's PASS is now backed by real evidence instead of
a trivially-true fallback comparison.

Do not respond to this result by loosening a filter, widening the grid, adding an axis, or
re-running with a different split until something passes. A train/test rank correlation of
0.0244 means a config that passes after enough retries passed by chance, and the retry count is
the only thing that changed.

## Reproducing these numbers

```bash
node --env-file=.env --import tsx scripts/sweep-cross-sectional.mts sp500 y
```

```bash
node --env-file=.env --import tsx scripts/walkforward-cross-sectional.mts sp500 atrReturn 3 off 10 5 off y y
```

Both commands require `.cache/bars/sp500-1d.json` and `.cache/sp500-membership.csv` to already
exist (see Task 2 of this plan for the membership fetch script; the bars cache is fetched by
`cache-daily-bars.mts`, not part of this task). Omitting the trailing `y` on either command (or
passing `n`) reproduces the pre-Task-5 behavior bit-for-bit — verified directly: running the
walk-forward command with no `pit` argument at all produces output identical, line for line, to
running it with a trailing `n`.

`dow30-1d.json` is present in the worktree this re-run was executed in, so the universe-haircut
section of the walk-forward output (gate 6) reports a real `dow30 PF=<value>` line rather than a
fallback. `nasdaq100-1d.json` is still not present, so that leg of the haircut section will read
`(no cache — run cache-daily-bars.mts for this universe)` unless that cache is fetched first —
the sp500-vs-nasdaq100 leg of gate 6 remains unevaluated in this document as a result (see "How
this was measured" above); the sp500-vs-dow30 leg is fully evaluated on real data.
