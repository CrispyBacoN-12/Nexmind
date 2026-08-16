# Cross-Sectional Momentum (US Stocks) — Decile Study Design

**Date:** 2026-08-16
**Status:** DESIGN — approved for planning, nothing implemented yet
**Scope:** a new pure module `src/lib/backtest/crossMomentum/` plus one runner script and one results
document. Adds only; changes nothing that currently runs.

## What this is, and what it is not

This builds a **diagnostic**, not a strategy. Its single output is an answer to one question:

> Does ranking US equities by 12-1 momentum contain information about their next month's return?

If the answer is no, the work stops there and the mechanism is rejected — the same way
cross-sectional mean reversion was rejected on 2026-08-15. If the answer is yes, a **separate**
follow-up project asks the tradability question: what survives when the portfolio is 5 whole-share
slots at $2–3k with no short leg.

This split is deliberate. The previous research round conflated "does the edge exist?" with "can I
trade it on my account?", and the two questions have different right answers and different failure
modes. Stage 1 removes every constraint so that a negative result is conclusive: if nothing shows up
with shorting allowed, fractional sizing assumed, and costs excluded, no amount of capital
engineering rescues it.

**Nothing here is deployed.** No Webull connection, no strategy activation, no change to the
walk-forward harness.

## The sample, and what it can and cannot prove

The measurement below has to be stated before any result is, because it governs how the result may
be read.

The 12-1 definition needs 273 trading days of history (252 for the lookback window, 21 for the
skip). Measured against the cached bars:

| | warm-up 200 (previous work) | warm-up 273 (this work) |
|---|---|---|
| first tradable day | 2021-05-11 | **2021-08-24** |
| tradable union days | 1,341 | **1,258** |
| span to 2026-08-14 | 5.26 years | **4.97 years** |
| symbols that ever qualify | 491 / 491 | **491 / 491** |
| union days to ≥200 symbols eligible | 2 | **2** |

The longer warm-up costs 83 tradable days and roughly four monthly rebalances. It costs no breadth:
every symbol still qualifies, and the cross-section is over 200 names deep within two days of the
first tradable day.

That leaves **59 monthly observations**. For a mean return, `t ≈ Sharpe_monthly × √N`, so `t = 2` at
`N = 59` requires a monthly Sharpe of 0.26 — an **annual Sharpe of about 0.90**. Published momentum
decile spreads run at roughly Sharpe 0.5–0.6 over 90 years of data. So:

> If momentum works exactly as the literature describes, this sample still cannot confirm it at
> `t = 2`.

That is not a reason to abandon the test. It is the reason the gate battery in Section 4 does not
rest on a single t-statistic, and the reason the strongest possible outcome of this work is
**"not rejected"** rather than "proven". Any writeup that claims more than that is wrong.

## Section 1 — Signal definitions

Two definitions are **pre-registered together**. Both are declared here, before any result is seen,
and each is judged against its own copy of the full gate battery. Running both and reporting the
better one as "the strategy passed" would be selecting on noise; two variants are two lottery
tickets, not one test with two chances.

Let `i` be a symbol's own bar index at a rebalance date, and `close[]` its close series.

**Leg A — classic 12-1 raw return**

```
scoreA(i) = close[i - 21] / close[i - 273] - 1
```

**Leg B — volatility-adjusted**

```
r[k]      = close[k] / close[k - 1] - 1        for k in [i - 272, i - 21]   (252 returns)
sigma(i)  = sample standard deviation of r     (n - 1 denominator)
scoreB(i) = scoreA(i) / sigma(i)
```

`sigma` uses the same window as the numerator. The score is left unannualized: ranking is invariant
to any positive constant, so `√252` would change the printed number and not the deciles. Guard
`sigma > 0`; a symbol with zero variance over 252 days is ineligible.

Both scores require `i >= 273`.

## Section 2 — Universe, eligibility, and survivorship bias

### The bias, stated plainly

`SP500` in `src/lib/trading/universe.ts:27` is a hardcoded list of **current** constituents — the
file's own comment concedes `membership drifts over time`. `scripts/cache-daily-bars.mts` fetches
history backwards from that list. Every one of the 491 symbols in the 2021 cross-section is therefore
a name we already know was in the S&P 500 in 2026.

For momentum this bias is not incidental, it is **adversarial**:

- S&P adds companies **because they have grown**. Names added between 2021 and 2026 sit in our 2021
  basket even though they were not members then, and we already know they did well.
- Momentum buys past winners. In a survivorship-filtered sample, past winners are
  disproportionately the future winners we selectively retained.

This is a lookahead the existing test suite structurally cannot catch. It does not live in the day
loop; it lives in the choice of ticker list. And it points toward **manufacturing a momentum edge
that is not there**.

Historical index membership was checked and is unavailable: FMP's `indexes / historical-sp-500`
endpoint returns `ACCESS DENIED` on the current plan.

### Why we accept it rather than rebuild the universe

Building an index-independent universe from Alpaca's active-asset list would remove the
index-addition bias but not survivorship itself — delisted companies are absent either way — at the
cost of a multi-thousand-symbol data-engineering effort with its own quality problems. The chosen
path converts the bias from a hidden defect into a **testable hypothesis**, which captures most of
the value at a fraction of the cost.

Three mitigations, all of which fall out of the design at near-zero marginal cost:

1. **The bias has a known direction, so it can be used as a check.** Survivorship **inflates the top
   decile** (winners that later collapsed out of the index are missing) and **deflates the bottom
   decile** (a loser still in the index today is a loser that recovered). An edge concentrated in
   the top decile is exactly the shape survivorship fabricates. An edge in the bottom decile is
   evidence the bias cannot explain. This becomes Gate 4.
2. **A mega-cap subset** (Gate 5), where index-addition bias mostly vanishes because those names
   were already members throughout.
3. **The decile-spread measurement itself** partially cancels the two directions, where a long-only
   measurement would compound them.

### Eligibility

A symbol is eligible at rebalance date `d` if and only if, using data no later than `d`:

- it has a bar on `d`, and at least 274 bars up to and including `d` (so `i >= 273`);
- both scores are finite (`sigma > 0`, no zero or non-positive prices in the window).

Eligibility deliberately says nothing about the fill bar at `d+1` or the exit bar, because neither is
knowable at `d`. Missing bars on either are handled after selection, below.

**No liquidity floor, no price floor, no news filter, no regime filter.** Every filter is a
parameter, and at 59 observations there are effectively no degrees of freedom to spend. The S&P 500
is uniformly liquid; a threshold here would buy nothing and cost a tuning knob.

### Handling missing fill and exit bars

Eligibility must not depend on data after `d`, so both cases are resolved after selection:

- **No bar on the fill day `d+1`:** fill at the open of the symbol's next available bar at or after
  `d+1`.
- **Bars stop before the exit day:** **exit at the open of the symbol's last available bar.**

Both are recorded in the run's diagnostics. A selected symbol must never be silently dropped from
its decile, because dropping it retroactively is precisely the survivorship mechanism this section
is about.

## Section 3 — Mechanics

**Calendar.** The union of all symbols' bar timestamps, ascending. A union day `d` is a **rebalance
date** if it is the last union day within its UTC calendar month.

**Ranking.** At each rebalance date, score every eligible symbol and sort **ascending**. With `N`
eligible symbols, decile `k` (1..10) holds ranks `floor((k-1)·N/10) .. floor(k·N/10) - 1`.

> **Decile 1 is the lowest score (losers); decile 10 is the highest (winners).** This orientation is
> fixed so that a working signal produces a *positive* slope across the decile index, which keeps
> every sign in Section 4 positive.

**Holding.** Equal weight within each decile. Fill at the **open of `d+1`**. Exit at the **open of
`d'+1`**, where `d'` is the next rebalance date. A symbol's monthly return is
`open[d'+1] / open[d+1] - 1`; a decile's monthly return is the equal-weight mean over its members.

**Spread.** `spread_t = D10_t - D1_t`.

**Window.** First rebalance is the first month-end union day with at least 100 eligible symbols
(**2021-08-31** on the current cache). Last rebalance is the latest month-end for which a complete
next-month holding period exists (**2026-06-30**, realized 2026-07-31). The partial period after
2026-07-31 is discarded. **59 observations.**

**Costs.** Gates are evaluated on **gross** returns, because Stage 1 asks whether the ranking carries
information, and that question is about the signal rather than the account. A **net** series is
computed and reported alongside: 5 bps per side applied to each name entering or leaving a decile
portfolio, with per-rebalance turnover reported. Whether the edge survives realistic execution is
Stage 2's question, and it is a real one — monthly decile rebalancing has high turnover.

## Section 4 — Gate battery

**All six gates must pass. This is an AND, not a scorecard.** Each leg (A and B) is evaluated
against its own copy of the battery.

| # | Gate | Criterion |
|---|---|---|
| 1 | **Monotonicity** | Spearman ρ between decile index (1..10) and that decile's mean monthly return **≥ 0.60** |
| 2 | **Permutation** | `p ≤ 0.05` against a shuffled-ranking null, 1,000 iterations |
| 3 | **Cross-definition direction** | the *other* leg's mean spread is **> 0** |
| 4 | **Not top-decile-only** | mean of `universeMean_t − D1_t` is **> 0** |
| 5 | **Mega-cap subset** | mean spread **> 0** on the top-200 subset |
| 6 | **Sub-period consistency** | mean spread **> 0** in **≥ 4 of 6** contiguous blocks |

**Gate 1 — monotonicity.** The highest-power test available here, and nearly free. Noise routinely
produces a large gap between the two extreme buckets; it very rarely produces a monotone staircase
across all ten. It also uses the whole cross-section rather than the two tails. With `n = 10` and no
ties in the decile index, `ρ = 1 - 6Σd² / 990`. A threshold of 0.60 corresponds to a one-sided
`p ≈ 0.07` — stated here rather than discovered later, and moderate on purpose because it is one
conjunct of six.

**Gate 2 — permutation.** The statistically correct instrument when the parametric assumptions
behind a t-statistic are not trusted, which at `N = 59` with unknown return distributions they are
not. For each of `B = 1000` iterations, permute the *assignment of eligible symbols to scores* at
each rebalance date — preserving the set of eligible symbols, their realized returns, and the
time-series structure, while destroying only the score↔return link — then recompute the mean spread.

```
p = (1 + #{ perm_mean >= real_mean }) / (B + 1)
```

The `+1` on both sides is the standard correction that keeps `p` from ever being exactly zero.
Randomness comes from a **seeded PRNG inside the module** (the seed is a config field); `Math.random`
is forbidden, as is any other non-determinism, so a run is exactly reproducible.

**Gate 3 — cross-definition direction.** Deliberately weak: it asks only that the other definition
point the same way, not that it also pass. Requiring both legs to pass would collapse the
pre-registration into a single test and forfeit the reason for declaring two legs.

**Gate 4 — not top-decile-only.** `universeExTopMean_t` is the equal-weight mean return of all
eligible symbols at `t` **except those in the top decile**. The gate asks whether the bottom decile
**underperforms that mean**. Per Section 2, an edge living entirely in the top decile is
indistinguishable from the survivorship artifact, and is rejected regardless of headline numbers.

> **Amendment, 2026-08-16 — before the study was run on any real data.** As first written, this gate
> compared the bottom decile against the mean of the *whole* universe, top decile included. That
> statistic cannot fail for the shape it exists to reject. A top-only edge lifts the universe mean
> above the flat bottom decile, so `universeMean − bottomMean` is positive **by construction**, and
> the stronger the artifact the more comfortably the gate passes. Verified numerically on the
> study's own top-only fixture: universe mean `+0.004992`, bottom decile `−0.000016`, difference
> `+0.005009` → **pass**, where the gate exists to fail. Excluding the top decile from the
> comparison mean removes the contamination and leaves the gate's stated intent untouched — the
> sign of the excess is now governed entirely by whether the bottom decile underperforms the
> non-top universe. This is recorded here, rather than changed silently, because it alters a
> pre-registered statistic. It was decided before any real-data result existed, and no result
> informed it.

**Gate 5 — mega-cap subset.** Dollar volume is proxied by `close × volume`. For each symbol take the
**median** over the 63 union days immediately **preceding** the first rebalance date — a window that
closes before the first ranking, so it introduces no lookahead — and keep the top 200. The whole
study re-runs restricted to those 200, in deciles of 20.

**Gate 6 — sub-period consistency.** The 59 monthly spread observations split into 6 contiguous
blocks of sizes 10, 10, 10, 10, 10, 9.

**Reported but not gated:** the t-statistic on the spread (`mean / stderr`, `N = 59`, no
autocorrelation correction needed since the periods do not overlap), annualized mean and volatility,
max drawdown of the compounded spread, per-decile mean returns, turnover, and the net-of-cost
series. The t-statistic is reported because it is the number a reader will look for, and excluded
from the gates because "The sample, and what it can and cannot prove" above already established that
the bar is unfair to this sample size.

## Section 5 — File structure

New pure module `src/lib/backtest/crossMomentum/`. The existing `crossSectional/` engine is
slot-based with ATR stops and per-position exits; decile portfolios have no slots, no stops, and no
per-position exit logic, so there is nothing to reuse in it. Shared: the bar cache on disk, and
`crossSectional/summary.ts` for equity-curve statistics.

| File | Responsibility |
|---|---|
| `types.ts` | `MomentumConfig`, `DecileMonth`, `LegResult`, `StudyResult`, `GateReport` |
| `calendar.ts` | union trading calendar; month-end detection; index alignment per symbol |
| `series.ts` | per-symbol `scoreA` / `scoreB` and eligibility at a given bar index |
| `deciles.ts` | rank an eligible set into 10 buckets |
| `study.ts` | the rebalance loop; returns per-decile monthly return series and diagnostics |
| `rng.ts` | seeded PRNG (mulberry32) and Fisher-Yates shuffle |
| `permutation.ts` | the shuffled-ranking null and its p-value |
| `gates.ts` | the six gates, computed from a `StudyResult` |

**Purity rules, unchanged from `crossSectional/`:** no `process.env`, no database access, no
`node:fs`, no `fetch`, no `Math.random`, no `Date.now()`. The module takes bars in and returns
results out. No runtime import from `src/lib/backtest/engine.ts`.

Runner: `scripts/decile-momentum-study.mts`, which loads `.cache/bars/sp500-1d.json`, runs both legs
plus the mega-cap subset, prints the gate report, and writes results to
`docs/quant/2026-08-16-cross-sectional-momentum-results.md`.

## Section 6 — Test discipline

The verification work merged in PR #2 established that a green suite is not evidence unless each
test has been shown to fail against a specific injected defect. That standard carries forward as a
hard requirement, not a suggestion. Two rules earned the hard way:

**The no-lookahead test must perturb bar `i+1` in place.** Appending bars past the end of a series
proves nothing: a day loop structurally cannot read past its own last index, and the previous
version of that test killed **0 of 32** injected lookahead mutations. Prefix and truncation tests
share the hole — for `i < M-1`, a value at `i+1` is identical in the truncated and the full run.
Only rewriting bar `i+1` **in place** and asserting that the score at `i` is unchanged detects an
interior lookahead. This applies to `scoreA`, `scoreB`, eligibility, and the rebalance loop.

**Every perturbation test carries a vacuity guard** asserting that the perturbation *does* move
something it is legitimately allowed to move — otherwise a green result may mean the fixture is
inert rather than that the code is correct.

Additional fixtures required, each to be verified against a named mutation:

- warm-up boundary pinned at exactly 273, tested at `i = 272` (ineligible) and `i = 273` (eligible)
- fills at the **open**, with fixtures where `o !== c`, so a fill-at-close defect is visible
- decile bucketing when `N` is not a multiple of 10 (no symbol dropped, no symbol double-counted)
- decile orientation: a fixture with a known winner must land in decile 10
- `sigma = 0` yields ineligible rather than `Infinity` or `NaN`
- the seeded PRNG reproduces an identical shuffle for an identical seed
- the permutation null recovers `p ≈ 0.5` on a signal known to be pure noise
- a symbol whose bars stop mid-holding-period exits at its last open and is **not** dropped

## Out of scope

- Any change to `scripts/walkforward-cross-sectional.mts` or the `crossSectional/` module
- Regime filters, momentum-crash protection, stop losses, position sizing
- Whole-share rounding, slot limits, PDT handling, shorting availability — all Stage 2
- Webull connection, strategy activation, live or paper routing
- Rebuilding the universe from a non-index source

## Deliverables

1. `src/lib/backtest/crossMomentum/` with tests, mutation-verified
2. `scripts/decile-momentum-study.mts`
3. `docs/quant/2026-08-16-cross-sectional-momentum-results.md` — the gate report for both legs, and
   a verdict that is either REJECTED or NOT REJECTED. Never "validated".
