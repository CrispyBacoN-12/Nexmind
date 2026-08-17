# Point-in-Time S&P 500 Membership + Re-run — Design

**Date:** 2026-08-18
**Status:** DESIGN — approved for planning, nothing implemented yet
**Scope:** a new membership module consumed by both cross-sectional engines, plus a re-run of the two
already-rejected mechanisms against the corrected universe. No new price data is acquired.

## Why this exists

Both cross-sectional mechanisms tested on US stocks so far were **rejected**:

- Mean reversion (`docs/quant/2026-08-15-cross-sectional-mean-reversion-results.md`) — no OOS
  parameter signal, loses to buying SPY at the same risk.
- Momentum, both legs (`docs/quant/2026-08-16-cross-sectional-momentum-results.md`) — fails
  monotonicity, permutation, and bottom-bucket-vs-universe gates; the apparent spread is a
  "volatility smile," not real momentum.

Both results documents name the same universe defect as the first thing worth fixing before
concluding anything further: `src/lib/trading/universe.ts`'s `SP500` list is a **current** snapshot of
membership, hardcoded and applied uniformly across the entire backtest history. This causes two
distinct look-ahead problems:

1. A stock that joined the index after the backtest start (e.g. Tesla, added 2020-12-21) is treated as
   an eligible candidate on every day of the backtest, including years before it actually joined.
2. A stock that left the index mid-backtest (acquired, delisted, demoted) keeps being treated as
   eligible for the rest of the window, because the "current" list has no notion of when it left.

Fixing this cannot, by itself, restore names that left the S&P 500 **before** `.cache/bars/sp500-1d.json`
was ever built — those were never fetched, so there is no price series to gate. That half of
survivorship bias (see the earlier Webull investigation) requires a paid delisted-price vendor and is
explicitly **out of scope** here. What this piece of work fixes is look-ahead bias on the symbols we
already have data for.

## Section 1 — Membership data source

**fja05680/sp500** (`github.com/fja05680/sp500`), a free, community-maintained CSV of S&P 500
membership snapshots since 1996-01-02. Each row is `date,"TICK1,TICK2,...TICKn"` — the exact
membership list as of that date. Some tickers carry a `TICKER-YYYYMM` suffix; the practical effect
(base-ticker vs. annotated-variant) is not yet nailed down from inspection alone and will be resolved
by spot-check tests in the implementation plan (verify Tesla is absent before 2020-12, ATVI absent
after 2023-10-13, and the already-known "left the list mid-window" names — ANSS, HES, DFS, DAY,
JNPR — drop out at the right date, not on day one and not never).

**Why this source, not FMP:** the connected FMP-style vendor's `historical-sp-500` endpoint (the one
built for exactly this) is Premium-gated and returned an access-denied error when tried. This CSV is
free, has the right shape, and needs no ongoing subscription. NEXMIND is not adding a new paid
dependency for what is fundamentally a static reference table.

**Vendoring, not live-fetching:** a one-off script (`scripts/fetch-sp500-membership.mts`) downloads the
CSV to `.cache/sp500-membership.csv`, alongside the existing `.cache/bars/*.json` files — same "fetch
once, read from disk during every backtest run" discipline, so backtests never make a network call
mid-run. Re-running the fetch script is a manual, deliberate refresh, not something the backtest
triggers.

**Dow 30 is out of scope for this fix.** Dow 30 turnover is a handful of changes per decade; the prior
studies used it as a survivorship-narrowing diagnostic (a separate run, not pooled with S&P 500), and
that diagnostic's whole point is comparing against a *more* contaminated list, so leaving it uncorrected
doesn't undermine it. Building a Dow 30 point-in-time table would be effort spent on the universe that
already shows the least bias.

## Section 2 — Membership index and engine integration

A new shared module, `src/lib/backtest/crossSectional/membership.ts` (alongside `calendar.ts`, which
both engines already import from), exposes:

```ts
export function parseMembershipCsv(csv: string): MembershipSnapshot[];
export function buildMembershipIndex(snapshots: MembershipSnapshot[]): (symbol: string, day: number) => boolean;
```

`day` is the same epoch-day key (`dayKey` in `calendar.ts`) both engines already use, so the lookup
plugs into either without a format conversion. `buildMembershipIndex` finds the latest snapshot on or
before `day` and checks whether `symbol` is a member as of that snapshot — binary search over the
sorted snapshot list, not a linear scan, since this runs once per candidate per day across a 113-month
study.

**Two call sites, both already identified in the code:**

1. `crossSectionalBacktest` in `src/lib/backtest/crossSectional/engine.ts` — the candidate loop at the
   "rank today's eligible set" step (around line 212) currently does
   `if (open.has(symbol)) continue;` then checks `isEligible`. A membership check is added right there:
   `if (isMember && !isMember(symbol, day)) continue;` before scoring. `crossSectionalBacktest` gains a
   third, optional parameter `isMember?: (symbol: string, day: number) => boolean`; omitting it (every
   existing caller, and any future non-equity caller) preserves today's behavior exactly.

2. `buildSnapshots` in `src/lib/backtest/crossMomentum/study.ts` — the per-rebalance loop over
   `bars` (around line 55) gains the same guard right after resolving `rankIdx`, before scoring:
   `if (isMember && !isMember(symbol, days[rankIdx])) continue;`. Same optional-parameter treatment.

Both engines already do everything else point-in-time (signals read bars ≤ t, entries fill at t+1);
this closes the one remaining lookahead surface — *which* symbols get to compete for a slot at all.

## Section 3 — What this fixes, and what it explicitly does not

Stated plainly, because both results documents already flagged this and any re-run write-up needs the
same clarity:

**Fixes:**
- Look-ahead inclusion — a symbol added to the S&P 500 after the backtest's start date can no longer
  be ranked as a candidate before its real join date.
- Stale inclusion — a symbol removed from the S&P 500 mid-backtest (acquired, demoted, delisted while
  still trading elsewhere) stops being a candidate after its real removal date, instead of remaining
  eligible for the rest of the window.

**Does not fix:**
- Omission bias for names that left the S&P 500 **before** `.cache/bars/sp500-1d.json` was built —
  those tickers have zero cached price history and cannot appear as candidates regardless of what the
  membership table says. This is a data-acquisition gap (paid delisted-price vendor), confirmed
  out of reach through Webull, and is not addressed by this piece of work.
- Mid-hold delisting already has correct handling — `engine.ts`'s force-close-on-last-day step
  (and `study.ts`'s "exit at last available open" fallback) already close a position at its last known
  price instead of erasing the loss. This work only changes *entry eligibility*, not exit handling.

The re-run's results document will restate this caveat in its own words, matching the "every reported
number is an upper bound" framing the mean-reversion doc already uses.

## Section 4 — Re-run plan

Once the membership index is built and its spot-check tests pass, both previously-rejected mechanisms
are re-run with the membership gate wired in and **nothing else changed** — same gates, thresholds,
train/test split fraction, seeds, and cost model as their original runs. This is a data-correctness
re-run, not a re-cut of either hypothesis, using the same reasoning the momentum study itself used when
it redid its first pass after finding unadjusted-split contamination in the cache.

- `scripts/sweep-cross-sectional.mts` + `scripts/walkforward-cross-sectional.mts` (mean reversion) →
  `docs/quant/2026-08-18-cross-sectional-mean-reversion-pointintime-rerun.md`
- `scripts/decile-momentum-study.mts` (momentum, both legs) →
  `docs/quant/2026-08-18-cross-sectional-momentum-pointintime-rerun.md`

Each results doc follows the existing format: full gate table, verdict, and an explicit note that the
only change from the prior run is the membership gate, with the Section 3 caveat repeated. If a verdict
flips to NOT REJECTED, that opens a Stage 2 (tradability under $2–3k whole-share sizing) question —
which is its own future piece of work, not part of this scope.

## Section 5 — Testing

- `membership.ts` unit tests: CSV parsing against a small fixture snapshot set; the known-date spot
  checks (TSLA join, ATVI removal, ANSS/HES/DFS/DAY/JNPR removal dates); a query before the first
  snapshot date (defined behavior: no members, not a crash); a query after the last snapshot date
  (uses the latest snapshot, i.e. "current membership" — the same behavior the code has today).
- Engine-level tests: a fabricated 3-symbol, membership-gated fixture confirming the loop in
  `engine.ts` actually excludes a non-member symbol from candidate selection on a given day and
  includes it once it becomes a member — same style as the existing `crossMomentum/*.test.ts` files.
- No changes to any existing test's expected output — passing `isMember: undefined` must reproduce
  today's results bit-for-bit, since every current test and every non-equity caller omits the parameter.

