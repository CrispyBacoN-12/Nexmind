# PRE-REGISTRATION — Test B: residual momentum as the slot queue for daily mr-down3

**Written 2026-09-27, committed BEFORE the simulator exists.** Nothing below may be edited after
the commit that adds this file. The simulator (`scripts/test-b-residual-momentum-queue.mts`) is
written afterwards to this text. It is run **once**, and its log and verdict are recorded as they
come out. If the code and this document disagree, this document wins, the run is void, and the
disagreement is reported. The number is not reported.

## 1. The question

mr-down3 fires about 40 times a day across the panel. The book holds 5 slots. On most days more
signals arrive than there are empty slots, so *which* signals get the slots is a rule of its own.
No ranking has ever been tested here. `scripts/portfolio-capacity.mts` broke ties with a seeded
shuffle precisely to avoid inventing one.

**Hypothesis.** Ranking the day's candidates by 12-month residual momentum (a single-index model
against SPY, with the most recent month skipped) selects better trades than a random queue. It
does so under the exact portfolio rule the owner trades under (`src/lib/portfolio/`,
`strictMode: true`), after realistic costs and overnight gap-through on stops.

The queue only matters on days when candidates exceed empty slots. On every other day the
treatment and the control take the same trades.

## 2. Data and folds (fixed)

- **Panel:** `.cache/bars/sp500-1d-deep.json` (`DEEP_PANEL_CACHE_PATH`), 453 names, Yahoo,
  split-adjusted, 1998-01-02..2016-01-04. **SPY is not traded.** It is the market series R_m and
  the regime input only.
- **Folds:** `DEEP_FOLD_LIST`: deep1 2000-01-01→2005-01-01, deep2 2005→2010, deep3 2010→2016.
  - Each fold is a separate account walk, starting fresh with NAV = starting capital.
  - Results are pooled across the three folds for the verdict.
- **Not used:** any post-2016 fold (FIT/SELECT/TEST1-3). The deep folds are also not fresh for
  mr-down3 (see §8). Only the *ranking* is new here.

## 3. Candidates (the trade set the queue chooses from)

- **Signal:** `mechanismByKey("mr-down3").rule` at the close of bar t, via
  `computeEntrySignals(candles, undefined, rule)`. It is long only.
- **Fill:** the open of bar t+1. The signals are moved one bar later with `shift1`, exactly as in
  `scripts/mr-down3-open-fill.mts`, and run with `entryAt: "open"`. The stop is sized off ATR at
  t (never t+1), and the fill session is managed.
- **Exit:** `LADDERS.flat` (single target, tp1 1.2 × ATR, stop 1.5 × ATR), the ladder deep-holdout
  and the open-fill run both used.
- **Trade list:** `simulateFold` over the fold slice with those signals.
  - Each symbol is simulated independently, one position at a time per symbol, as the harness
    always has. The candidate set on a day is the trades whose `openedAt` falls on that day.
  - Trades still open at the fold's end are not in the list, the same as every prior panel run.
- **Costs:** the verdict uses **5 bps slippage + 1 bp commission per side** (`EQUITY_COST_MODEL`).
  0.5 + 1 is printed as context only.
- **Gap slippage on stops (applied by the simulator, not the engine).** The engine books a stop
  at `t.sl` even when the bar opens below it (`positionRules.ts` returns `exit: t.sl`). For every
  trade with outcome `loss` whose exit bar is later than its entry bar, the simulator checks that
  exit bar's open:
  - If the open is below the pre-slippage stop, the fill is re-priced to that open, minus the same
    slippage.
  - The adjusted value is `r_adj = r − (exit_engine − open × (1 − slip)) / |entry − sl|`. This is
    exact, because r = net pnl / (risk × lot) and the cost model is linear in lot.
  - Targets that gap *through* stay booked at the target. This is conservative, and deliberately
    left asymmetric.
  - Every number in the verdict is gap-adjusted. The unadjusted figure is printed beside it.

**Reproduction check (aborts the run on mismatch).** Before any queue is walked, the unadjusted
open-fill trade list at 5 + 1 must reproduce `scripts/mr-down3-open-fill.log`:

| fold | trades | avgR |
|---|---|---|
| deep1 | 30,168 | 0.011 |
| deep2 | 33,196 | 0.012 |
| deep3 | 41,468 | 0.055 |

The avgR must match to three decimals. Any difference means the candidate set is not the one
already measured, and the run stops with no verdict.

## 4. The score (treatment)

All inputs are read from the full deep panel, point-in-time, using only bars dated ≤ t (the
signal bar). They are never read from the fold slice, whose 250-bar warm-up is too short.

- **Calendar:** SPY's trading dates. R_i,k and R_m,k are close-to-close daily returns on the
  symbol's and SPY's own consecutive bars, keyed by the date of the later bar. Returns are paired
  by date.
- **β_i:** the OLS slope of R_i on R_m over the 252 returns k ∈ [t−273, t−22].
- **Score:** `Σ_{k = t−147 … t−22} (R_i,k − β_i · R_m,k)`, which covers 126 returns.
  - No intercept and no volatility scaling, exactly as specified.
  - t−21..t is skipped, to remove short-term reversal.
- **Insufficient history:** if fewer than 90% of either window's dates have a paired return, the
  score is null. A null score ranks **below every scored candidate**, and nulls are ordered by
  ticker.
- **Ranking:** the day's candidates are ordered by score descending, with ticker as the
  tie-break. This is `allocateSlots`' own `byScoreDesc`.

## 5. The portfolio walk (identical for the treatment and every control walk)

**Rule.** Each fill day D (bar t+1), in date order:

1. Positions whose exit bar is before D have closed. A slot frees only if its position closed on
   an **earlier** day. A position that closes on D still occupies its slot at D's open.
2. The day's candidates go through `allocateSlots` in queue order.
   - `evaluatePortfolio` runs with `strictMode: true` and `DEFAULT_PORTFOLIO_CONFIG`.
   - There are no overrides and nothing is tuned.
   - Candidates may be fed in chunks, stopping once the book is at its slot cap. That is
     equivalent, because CAPACITY blocks every later candidate.
3. Accepted candidates take `suggestedShares`. Rejected candidates are dropped, not queued.

**Gate inputs, as of the close of t (the evening before the fill):**

- **Sector:**
  - Finnhub `finnhubIndustry` for every panel name, fetched once through `fetchFundamentals` into
    `.cache/sectors/sp500-deep-finnhub-industry.json` before the walk, and mapped with
    `resolveGicsSector`.
  - This is **today's** classification (a limitation, see §8).
  - A name resolving to "Other" is an unknown sector, so the SECTOR gate fails closed and blocks
    it. That is the rule as built. The count is reported.
- **Correlation:** the 60-session date-aligned correlation of candidate returns with each held
  name.
  - The semantics are those of `dateAlignedCorrelation`: the last 60 shared return dates, null
    when fewer than 40 are shared.
  - The simulator may use a faster equivalent. That equivalence is checked against
    `dateAlignedCorrelation` on 200 random (pair, date) samples, to 1e-9, and **aborts** on any
    mismatch.
- **Regime:** `regimeFromBenchmark(SPY bars ≤ t)`.
- **worstLossR:** `gapRisk(bars in (t−504, t])` with the ladder's slMult of 1.5. Its
  `worstLossR`, or null (<60 sessions).
- **Candidate:**
  - entry = the engine's actual fill (open of t+1, slippage included).
  - stop = the trade's `sl`.
  - `baseShares = min(floor(C × 1% / (entry − sl)), floor(C / 5 / entry))`, from **starting**
    capital C, with no compounding.
- **NAV:**
  - C at the session before the fold's first date. After that, one log point per trading day at
    that day's close.
  - The value logged is C + realised net P&L + open shares × (close − entry).
  - The history fed to `readNav` ends at the close of t. `today` is D.
  - DRAWDOWN applies exactly as coded: −3% day stop, 8% half size, 15% safe mode.
  - If safe mode never clears, the account stops taking trades for the rest of the fold. That is
    reported and not intervened on.
- **Realised P&L of a taken trade:** shares × r_adj × |entry − sl|.

**Capital:**

- The verdict uses **C = $100,000**, so that whole-share rounding does not decide which names are
  buyable. A $2,500 restatement is printed as context only.
- Test B is about *which* trades fill the slots. The effect of account size was already measured
  in `docs/quant/2026-09-09-portfolio-capacity.md`.

**No-lookahead assertion (aborts on violation):** every feature input date ≤ t < D.

## 6. Control

- **500 random-queue walks.** Every rule in §3-§5 is identical, including gates, sizing, NAV and
  the candidate set.
- The only change is the score: each candidate gets an independent U(0,1) draw.
- **Seeding:** one generator, `mulberry32(PANEL_SEED)`, drawn in a fixed order (walk, then fold,
  then fill date, then ticker).
- `PANEL_SEED` is the repo constant. It is not a parameter, and neither is the walk count.

## 7. The statistic and the decision rule

**Statistic.** S = the mean gap-adjusted `rMultiple` over **all trades taken**, pooled across
deep1-3, at 5 + 1 bps. Trades whose `rMultiple` is null are excluded, as everywhere in this repo.
The same statistic is computed for each control walk.

**Decision, a conjunction fixed here:**

1. **Selection:** S_treatment > p95(S_random), taking the 95th percentile of the 500 control
   values with `percentile()` from `control.ts`.
2. **Usable:** S_treatment > 0 after costs and gap slippage.

**Verdicts:**

- **PASS:** conditions 1 and 2 both hold. The ranking selects, and the selected book makes money.
- **NOT USABLE IN PRACTICE:** condition 1 holds and condition 2 fails. The ranking selects real
  information, but the book it builds does not pay after costs.
- **FAIL:** condition 1 fails, whatever condition 2 shows.

**Consequences, fixed now:**

- A FAIL or NOT USABLE is final for this test. There is **no rescue search**: no other lookback,
  skip, β window, volatility scaling, ladder, cost model, fold subset or capital figure.
- Any of those would be a new hypothesis on folds this test has spent, and would need data this
  project does not have.
- A PASS is a hypothesis, not a deployment. Every fold is spent (see §8), so a PASS earns a
  forward paper record on the owner's journal, not a live allocation.

**Context only (printed, never part of the verdict):**

- Per-fold S versus that fold's control p95.
- The number of **bottleneck days**, where candidates exceeded empty slots at the open, and S
  restricted to trades taken on those days.
- The unadjusted (engine-booked) S.
- S at 0.5 + 1 bps.
- The $2,500 restatement.
- Per-gate block tallies and unfilled-slot days.
- The "Other"-sector count and safe-mode episodes.

## 8. Known limits, stated before the run

- **Survivorship.** The universe is today's S&P 500 survivors, back-filled to 2000. Names that
  delisted in 2000-2016 are absent, which flatters momentum: the losers that would have ranked low
  and then vanished are not there to be avoided or to hurt.
  - A PASS is therefore an upper bound.
  - A FAIL is conclusive in the direction that matters: if the ranking cannot beat random even on
    a survivor-biased panel, reality would be worse.
- **The folds are spent for mr-down3.** The deep folds were read by the 2026-09-05 hold-out, by
  the open-fill run, and by `portfolio-capacity.mts`.
  - What is new here is only the ranking, and residual momentum was chosen from the literature,
    not from these data.
  - That keeps the test honest about selection, but not fresh.
- **The open-fill mr-down3 was already REJECTED per trade** on these folds. It beat its control's
  median in 1/3 folds, and its mean margin was −0.0023 at the open fill.
  - Unranked, its raw avgR at 5 + 1 is positive but small (0.011 / 0.012 / 0.055), and gap
    slippage can only lower it.
  - **Condition 2 may fail even if the ranking works.** That outcome is named in advance as NOT
    USABLE IN PRACTICE, not as a surprise.
- **The sector classification is current,** not point-in-time. A name that changed sectors
  between 2000 and today is gated on today's label.
- **One position per symbol comes from the harness:** a signal on a name whose previous trade is
  still open in the independent per-symbol simulation is not a candidate, even if the book never
  took that previous trade. This is the same candidate set as every prior panel run on these
  folds.
- **The trade set ignores targets that gap through** (booked at the target) and any fill-size
  limits. At 5 slots of large caps, the second does not bind.
