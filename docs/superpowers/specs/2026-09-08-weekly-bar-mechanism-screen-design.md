# Weekly-Bar Mechanism Screen — Design

## Goal

Re-run the existing six-mechanism library on **weekly** bars, at the only entry
fill the owner can actually trade, and find out whether the entry axis is truly
closed or was only closed on daily bars.

Nothing else changes. No new rule is invented, no parameter is tuned, no ladder
is swept. Exactly one variable moves: the bar class.

## Why this exists

The stock half of NEXMIND is being redesigned as an advisory tool: it names
entry and exit points, the owner places the orders by hand. Three measurements
in the last two sessions closed off the only mechanism that had ever passed a
hold-out here.

| Run | Result |
|---|---|
| `scripts/deep-holdout.log` | mr-down3 PASSES 3/3 deep folds — filled at the bar's **close** |
| `scripts/mr-down3-open-fill.log` | next-open fill REJECTED; the edge is the overnight gap |
| `scripts/mr-down3-limit-fill.log` | limit-at-previous-close REJECTED; absolute 0/3, retention −157% |

The close fill is a market-on-close order priced off a print at 16:00 ET, which
is **03:00 Thai time**. The owner has stated that a 03:00 routine is not
acceptable. Both fills that removed the wake-up are now measured and dead, and
`mr-down3-limit-fill.mts` pre-registered the consequence before it ran:

> A FAIL does not license a search for a third fill: it says mr-down3 is not
> deployable under this project's constraints, and the design must change
> MECHANISM rather than fill.

This spec is that mechanism change.

## What the diagnostic established

`scripts/holding-period.mts` (a diagnostic; no control, no pre-registered
criterion) measured, on FIT and SELECT only, the avgR each mechanism loses when
its fill moves from the bar's close to the next bar's open.

```
mechanism        fit      select    median hold
mr-down3        0.054     0.023        5 d
turn-of-month   0.055     0.026        6 d
range-expand    0.013     0.005        5 d
nr7            -0.013     0.019        6 d
gap-fade        0.007     0.012        6 d
vol-dryup       0.002    -0.002        7 d
```

Two findings shape this design.

**The gap tax is mechanism-specific, not universal.** mr-down3 and
turn-of-month shed an order of magnitude more than the rest. Everything else
loses ~0.01R, which is ordinary friction. So a mechanism whose profit survives a
livable fill is not a contradiction in terms — the library simply has no
candidate that is *both* gap-immune *and* better than its control. vol-dryup is
gap-immune and loses to the control median in 3 of 5 folds
(`mechanism-screen-control.log`: select −0.103, test2 −0.050, test3 −0.070); it
only buys above SMA50, so it is exposure, not alpha, exactly as
`regime-by-side.log` found for the trend half.

**A short holding period was not the cause.** mr-down3 holds a median of five
days and still concentrates two-thirds of its FIT avgR in the first overnight
gap. Note that FIT and SELECT disagree on the fraction (67% vs 17%); the
absolute drops (0.054 vs 0.023) are the comparable quantity and are read that
way throughout.

The close-fill rows of that run reproduce `mechanism-screen-control.log` exactly
(vol-dryup 0.108/0.083, turn-of-month 0.093/0.051), so the harness is measuring
what it did before.

## Decision 1 — the livable fill becomes the only fill

Every screen in this repo has reported a number priced at a bar's close. That
is a price the owner cannot trade. Three separate runs were spent discovering
this about one mechanism.

From here on:

> **Signal is decided at the close of bar `i`; the fill is at the open of bar
> `i+1`.** The close-fill number is not printed at all — not merely excluded
> from the verdict.

Built with `shift1` + `entryAt: "open"`, the technique already documented in
`scripts/mr-down3-open-fill.mts`. `engine.ts` then sizes the stop off
`atrs[i-1]` (the signal bar's ATR, known when the decision was made) and manages
the entry bar. **No engine change.** `runControl` re-simulates through the same
`PanelExit`, so the matched random control fills at the open too.

Cost: zero. Benefit: an entire class of unreachable results stops being
generated.

## Decision 2 — the bar class moves to weekly; nothing else moves

Run the same six `MECHANISMS` entries, unmodified, on weekly bars.

**Why not new rules.** Changing the rule set and the bar class together makes
any survivor uninterpretable, and invites the undisciplined search that produced
`research-29` (approved on 8 trades, lost −3.46R live). One variable moves, so
the result attributes.

### Timing — the point of the whole exercise

```
weekly bar closes    Friday 16:00 ET   = Saturday 03:00 Thai
owner decides        any time over the weekend
fill                 Monday's open     = Monday 20:30 Thai
```

One decision per week, taken on a day off, executed in the evening. This is the
livable fill of Decision 1 with no exception carved for it.

### Data — resampled, not refetched

Weekly bars are aggregated from the daily caches already on disk.

```
.cache/bars/sp500-1d-deep.json   1998-01-02 → 2016-01-04   453 symbols
.cache/bars/sp500-1d.json        2016-01-04 → 2026-08-14   491 symbols
```

The two abut exactly. No network call, no new provider, no new survivorship
bias. Fetching `1wk` from a provider instead would import a second set of
split/dividend adjustment conventions and put that seam inside the tradable
data, where it would be invisible.

### Cost arithmetic — the quantified bonus

1R = `slMult × ATR`, slMult = 1.5. Weekly ATR ≈ √5 × daily ATR, and daily 1R is
a measured 3.70% of price (`scripts/r-size-vs-costs.log`).

| bars | 1R (% of price) | cost @ 0.5bps+1bp | cost @ 5bps+1bp |
|---|---|---|---|
| daily | 3.70% | 0.0054R | 0.0297R |
| weekly | ≈8.3% | 0.0024R | 0.0133R |

`nexmind-cost-model-dominates-effect-size` records that the 0.5-vs-5bps spread
is wider than any edge measured in this project. Weekly bars halve it, for free,
because the road is longer while the toll is the same. This is a projection from
√-of-time scaling, not a measurement, and the run prints the realised weekly R
so the projection is falsifiable.

## Constraints accepted, stated before the run

**FIT loses its first 60 weeks.** `sp500-1d.json` begins 2016-01-04, the same
day FIT begins, so FIT has no warm-up prefix. `engine.ts`'s `WARMUP = 60` bars
is three months on daily bars and **fourteen months** on weekly ones, out of a
three-year fold. Roughly 96 tradable weeks × ~474 symbols ≈ 45,000 bar
opportunities remain — far above `MIN_PANEL_TRADES = 200` — but FIT is weaker
than it was. SELECT, TEST1-3 and DEEP1-3 all have full prefixes and are
unaffected.

*Rejected alternative:* splicing the deep cache in front of FIT as warm-up. It
works, but places a provider seam at FIT's first tradable bar. A shorter FIT is
the cheaper error.

**SELECT is 52 weekly bars.** The SELECT fold is calendar 2019 alone. Trade
counts still clear the floor, but the window is much thinner than its daily
equivalent and its number is read with correspondingly less weight.

**A weekly fold-warm-up constant is needed.** `PANEL_WARMUP_BARS = 250` means
one year of daily bars and five years of weekly ones. The deep cache starts
1998-01-01 and DEEP1 starts 2000-01-01, so it can supply exactly 104 weekly
bars. Weekly warm-up is therefore **104 bars (2 years)** — above `WARMUP = 60`
with margin, and exactly what the deep cache can pay. `foldSlice()` already
accepts warm-up as a parameter, so this is a new constant, not a structural
change.

## Pre-registration

Written into the script header before the first run, and not edited afterwards.

**HYPOTHESIS.** At least one mechanism in the existing library, on weekly bars,
at the livable fill, beats its matched random-entry control.

**SCREENING FOLDS.** `fit` and `select` only. TEST1-3 are printed for the audit
trail and choosing from them spends data. DEEP1-3 are **not read** — they are
the only untouched window left for a mechanism that does not yet exist, and
descriptive statistics count as reading them.

**FILL.** Decided at the close of weekly bar `i`, filled at the open of weekly
bar `i+1`. No close-fill number is printed.

**COST MODEL.** `DEFAULT_COST_MODEL` (0.5bps + 1bp) for the verdict, with a
5bps block as a separate pre-registered statement, matching every prior run.

**PROMOTION BAR.** A mechanism advances only if it beats the control **median in
both** `fit` and `select`. Advancing means: read its TEST rows, then — if those
hold — write a *separate* pre-registration and spend the deep hold-out once.

**VOIDING CHECK.** The run first prints the fraction of weekly bars where
`open != close`. Resampling that silently collapses a week to one print would
make `entryAt: "open"` identical to `"close"`. If that fraction is not
overwhelmingly high, the whole measurement is VOID.

**RESAMPLER CHECK.** Before any mechanism runs, the weekly series is asserted
against its daily source per symbol: each weekly bar's open is its week's first
daily open, its close the last daily close, its high the week's max, its low the
week's min, its volume the week's sum, and no week spans a boundary. A failed
assertion aborts the run.

**HARNESS CHECK.** The daily panel is re-run at the close fill and asserted —
not printed — to still reproduce `mechanism-screen-control.log` to within 0.002R.
Only "match"/"mismatch" reaches the log, so Decision 1 holds: no close-fill
number is reported as a result. A resampler that corrupts the panel must not be
able to look like a finding.

**CONSEQUENCE OF A FAIL.** If no mechanism clears the bar: do not sweep the
ladder, do not move the threshold, do not add a rule and re-run. It means the
"price shape from daily OHLCV" axis is closed, as
`nexmind-entry-is-late` already warned, and the design moves to one of:

- **New data class.** Earnings dates, short interest, index membership, breadth
  — inputs no rule in this repo has ever been given. Costs a data pipeline.
- **Change what the product is.** Build only the half already measured and
  passing: position tracking, sizing, exit signalling, and an honest record of
  every recommendation's outcome — with the entry idea supplied by the owner.
  `portfolio-capacity.log` PASSED all three of its pre-registered conditions;
  design decision #4 already assumes manual fill logging. This is a choice
  available now, not a consolation prize discovered by exhaustion.

This clause is written now precisely so that a bad result cannot be talked into
a re-run later. The same clause in `mr-down3-limit-fill.mts` did its job.

## Scope

**In:** a weekly resampler over the existing daily caches; a weekly fold
warm-up constant; one screen script with the header above; its log.

**Out:** engine changes; new mechanisms; ladder or parameter sweeps; the deep
hold-out; the selection/ranking experiment owed by `portfolio-capacity.mts`
(still open, and worth running against whatever mechanism survives, not before);
anything in `src/` that serves the live desk; the gold/MT5 half of the split.

## Open items carried forward

- Design decision #5 (pre-placed orders at the next open) is dead and is
  replaced by Decision 1 above.
- The ranking-vs-random-selection experiment remains owed by
  `portfolio-capacity.mts`'s own header. Its ordering spreads were wide
  (test1 19.5%–49.9%), so selection may be the whole game — but it is only
  worth measuring once a mechanism exists to select from.
- `portfolio-capacity.log` contains one unexplained audit row: $2,500/5 slots
  beats $5,000/5 slots in percentage terms in several folds, contradicting the
  whole-share rounding logic. Labelled unexplained, not used for any decision.
