# Deep hold-out — `mr-down3` on 2000–2016, data the panel had never seen

**Date:** 2026-09-05 · **Harness:** `scripts/deep-holdout.mts --control=200`
· **Raw output:** `scripts/deep-holdout.log`
· **Panel:** `scripts/cache-deep-history.mts` → `.cache/bars/sp500-1d-deep.json`,
453 of the 491 S&P 500 names + SPY, Yahoo daily, **1998-01-02 .. 2016-01-04**
· **Folds:** `DEEP_FOLDS` — deep1 2000-05, deep2 2005-10, deep3 2010-16, all of which
end **before** `FOLDS.fit` begins
· **Ladder:** `flat` (1.2 TP / 1.5 SL, single target, `DEFAULT_COST_MODEL`) — the screen's
default, not chosen for this rule · **Seed:** `PANEL_SEED = 20260825`

**This is the first pre-registered hold-out in the project that a mechanism has passed.**

## Why this run existed

`mr-down3` — long after three consecutive lower closes, **zero fitted parameters** — beat the
matched random-entry control's median in **9 of 10 cells** across two ticker-disjoint universes
(S&P 500 and the 1,172-name broad panel). It failed one fold, SELECT (2019), and
`docs/STATE.md` summarised the whole screen as "all failed on the screening folds", which is
where the result sat unread for ten days.

The problem with acting on that was structural, not statistical: **three of the four winning
cells were TEST folds that had already been read.** Choosing `mr-down3` because of them would
have spent the hold-out. So the question had to be put to data the panel had never touched.

That data existed and was free. The 2016-01-04 floor on every symbol in `sp500-1d.json` is
**Alpaca's equity inception, not the end of history**: `providerOrder()` reaches Yahoo only when
a provider *errors*, and Alpaca does not error. Yahoo serves the same names back to the 1990s
and had never been asked.

## The pre-registration (written into the script header before the first run)

> **HYPOTHESIS (one, not nine):** `mr-down3` has a real time-series mean-reversion edge in US
> large caps.
>
> **PASS:** beats the control MEDIAN in ≥ 2 of 3 deep folds **AND** beats the control P95 in
> ≥ 1 of 3. **ANYTHING LESS IS REJECTION**, and mean reversion closes as a family.

and, separately, for the survivorship objection:

> **REJECT, whatever the aggregate said:** margin over the control median is positive ONLY in
> the top quartile and ≤ 0 in the bottom.
> **WINNER-DRIFT OBJECTION FALLS:** margin positive in the bottom quartile as well as the top.
> Scope: this covers survivors that did badly, not companies that left the index. Membership
> survivorship is not testable on this universe and is not claimed.
> Anything else is reported as MIXED and read as neither.

## Result — the hypothesis

| fold | trades | symbols | avgR | win% | ctrl med | ctrl p95 | **margin vs p95** | vs median |
|---|---|---|---|---|---|---|---|---|
| deep1 2000-05 | 27,521 | 373 | **+0.070** | 59.6% | 0.045 | 0.051 | **+0.019** | beats |
| deep2 2005-10 | 30,268 | 407 | **+0.074** | 59.9% | 0.039 | 0.044 | **+0.030** | beats |
| deep3 2010-16 | 38,195 | 452 | **+0.132** | 63.2% | 0.076 | 0.081 | **+0.051** | beats |

**beats median 3/3 · beats p95 3/3 → PASS**, on the stricter of the two conditions in every
fold rather than in the one fold required.

deep1 and deep2 each contain a full bear market (dot-com bust, GFC) and its bottom. The margin
does not depend on a regime the post-2016 panel could not show.

## Result — the survivorship diagnostic

Every symbol bucketed by **its own** annualised return over its deep history, 112/112/112/113 per quartile.
If the edge were "survivors always bounce", the margin would live in Q4 and vanish in Q1.

| quartile | annualised return | deep1 | deep2 | deep3 | **mean margin vs ctrl median** |
|---|---|---|---|---|---|
| Q1 worst | −27.8% .. +7.3% | +0.013 | +0.033 | +0.032 | **+0.037** |
| Q2 | +7.3% .. +10.7% | +0.012 | +0.031 | +0.045 | **+0.040** |
| Q3 | +10.7% .. +15.7% | +0.015 | +0.016 | +0.043 | **+0.036** |
| Q4 best | +15.7% .. +99.9% | +0.016 | +0.011 | +0.060 | **+0.042** |

Twelve of twelve cells beat the control median, and the spread across quartiles is 0.006R —
**flat**. The Q1 bucket contains names compounding at −27.8%/yr and the rule still clears its
own control there. **WINNER-DRIFT OBJECTION FALLS** — and only that one: every name here is a
name that still exists, so delisted 2000-2016 companies are absent from the test entirely and
membership survivorship remains open.

## The audit rows, and why none of them is a result

Eight other mechanisms ran in the same job so the verdict is auditable from one log. They are
**not a menu**: promoting one of them here would be choosing a rule after seeing its numbers on
the last untouched data in the project, which is the exact failure this run was built to avoid.

| mechanism | deep signs | note |
|---|---|---|
| `baseline` (`decideSetup()`) | ++− | below control median in 2 of 3 — consistent with 10/10 post-2016 |
| `turn-of-month` | +++ | beats median 3/3, but margins of +0.005 / +0.001 / +0.010 and p95 0/3 |
| `gap-fade` | −++ | beats median 3/3 on a **negative** raw avgR in deep1 — wins the race, loses money |
| `gap-fade-open` | −−− | the corrected fill is worse in the deep folds too; thread stays closed |
| `nr7`, `vol-dryup`, `range-expand` | mixed | none clears both conditions |

`turn-of-month` is the interesting near-miss and would deserve its own pre-registration later.
It is not promoted from this log.

## What this establishes, and what it does not

**Establishes:** a per-trade edge over matched random entry, sign-consistent across 13 of 14
fold-cells, on two ticker-disjoint universes and two non-overlapping 16-year eras, from a rule
with no fitted constant and an exit ladder that was never tuned to it. That is more evidence
than anything else in this repo has ever accumulated.

**Does not establish, and must not be quoted as:**

1. **A strategy.** 27k–38k trades per fold is a diffuse edge spread across every name every day.
   At $2–3k of capital in whole shares (Webull) the desk holds ~5 slots. *Which* of the ~40
   simultaneous signals to take is an unsolved selection problem, and nothing above validates an
   answer to it. "First five alphabetically" is a new rule needing its own hold-out.
2. **Freedom from membership survivorship.** The universe is **today's** S&P 500. Names delisted
   or bankrupted between 2000 and 2016 are absent from the file entirely. The quartile test kills
   the "winners bounce" form of the objection; it cannot speak for names that left. Closing that
   needs a delisted-inclusive source (Sharadar SEP, ~$50/mo) — a decision for after, not before,
   the sizing question above.
3. **Anything about combining it with the ATR trail.** Both were chosen against folds from the
   same panel; stacking them is two layers of selection and settles neither.
4. **Grounds for tuning "3 days".** That number came from the literature, not from fitting, and
   it is the single property that makes the result credible. A sweep would destroy it.

## Verification of the harness itself

- `npx tsc --noEmit` clean; `npm test` **519/519** (509 prior + 10 new in `bars.test.ts` and
  `panel.test.ts`, covering bar-spacing detection and two-cache `loadPanel` memoisation).
- `LADDERS`/`MECHANISMS` were lifted out of `scripts/mechanism-screen.mts` into
  `src/lib/research/mechanisms.ts` so both harnesses run the same objects. Verified
  number-identical by diffing a full 9-mechanism × 5-fold run of the refactored script against
  one from `git show HEAD:scripts/mechanism-screen.mts` — **no number changed**.
- The cache builder aborts before writing if any series is not daily-resolution. Yahoo answers
  `range=max&interval=1d` with silently downgraded weekly/quarterly bars (AAPL: 169 bars for 42
  years) that `sanitizeSeries` cannot reject; explicit `period1`/`period2` avoids it and
  `isDailySeries` enforces it.
- 38 of 491 symbols returned nothing: ~20 are genuinely post-2016 entities (CARR, OTIS, CTVA,
  GEHC, VLTO, SOLV, GEV, KVUE …) and 6 (MMC, K, BK, HES, EA, AVB) are a deterministic Yahoo
  coverage gap, reproducible at every window on both hosts. 453 is far above
  `MIN_PANEL_SYMBOLS = 100` in all three folds.

## Next step

The next question is **sizing and selection**, not another entry mechanism: how a +0.07R/trade
signal that fires ~40 times a day survives 5 whole-share slots at $2–3k. That is engine work with
its own pre-registration. Nothing above authorises putting `mr-down3` on the live desk.
