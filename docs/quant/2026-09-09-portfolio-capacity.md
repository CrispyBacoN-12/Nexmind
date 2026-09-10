# Portfolio capacity, selection ranking, and what survivorship still hides

**Script (pre-registered, already run — never edit):** `scripts/portfolio-capacity.mts`
**Log:** `scripts/portfolio-capacity.log`
**Follow-up measurements (this document, 2026-09-09):** §2, §3 and §4 were run after the
log, to answer the two open items the spec
`docs/superpowers/specs/2026-09-08-weekly-bar-mechanism-screen-design.md` carried forward.

## 0. What this measures, and on which rule

Every number this project had produced before this script — the hold-out included — is a
per-trade average under **infinite capital and infinite slots**. `simulateFold` runs each
symbol independently and pools the trades; there is no slot limit, no capital and no
concurrency anywhere in `src/lib/backtest` or `src/lib/research`. This script adds that
missing layer: at most 5 open positions, `shares = floor(budget / entry)` with whole shares
only (Webull, no fractional), and no compounding.

The rule under test is **mr-down3 on DAILY bars**, the version that passed the daily deep
hold-out on 2026-09-05 (`docs/quant/2026-09-05-deep-holdout.md`). The weekly version of
mr-down3 was rejected separately (`docs/quant/2026-09-08-weekly-mechanism-results.md`);
that is a different rule on a different bar and does not overturn what is here, but it does
mean **everything below describes the daily rule only.**

## 1. The pre-registered result — PASS, with a caveat added in §2

Headline configuration: $2,500 capital, 5 slots, ≥1 whole share, median of 50 orderings,
200-run control, `seed=20260825`.

| fold | ann. return | control median | margin | realised maxDD |
|---|---|---|---|---|
| fit | 11.8% | 9.4% | +2.3 | 18.8% |
| select | 28.8% | 26.0% | +2.9 | 15.2% |
| test1 | 36.3% | 26.4% | **+9.9** | 38.1% |
| test2 | 9.4% | 1.9% | **+7.5** | 19.0% |
| test3 | 14.6% | 10.6% | +4.0 | 13.4% |
| deep1 | 30.0% | 10.5% | **+19.4** | **51.7%** |
| deep2 | 14.0% | 5.6% | **+8.4** | **70.8%** |
| deep3 | 16.1% | 14.1% | +2.0 | 26.8% |

Three conditions, all fixed before the run: beats the control median (5/5 post-2016, 3/3
deep), positive there (5/5, 3/3), and ordering p5 > 0 (5/5). → **PASS**

**The drawdowns are the part to read twice.** 70.8% in deep2 and 51.7% in deep1 are
realised on the actual 5-slot walk, not a per-trade statistic. A rule that returns 30%/yr
through a 52% drawdown is not tradable by a person unless they already know the drawdown is
coming, which they do not.

The slot constraint dominates everything: **16,943 of 17,659 fit signals are dropped
because all five slots are busy.** Only ~4% of what the rule sees is ever taken. Which 4%
is the whole question, which is what §3 is about.

## 2. The median-of-50 is itself seed-unstable — this weakens the PASS above

Re-running the same headline configuration across **10 independent RNG streams** moves the
median by **0.9 pp (deep3) to 5.1 pp (select)**.

That spread is the estimator's own noise, and three of the eight margins are the same size
as it or smaller: **fit +2.3, select +2.9, deep3 +2.0**. Select's own re-run spread
(5.1 pp) exceeds its margin outright. The five larger margins — deep1 +19.4, test1 +9.9,
deep2 +8.4, test2 +7.5, test3 +4.0 — are not threatened by this.

**Cite the log as "clear in five folds, fragile in fit, select and deep3." Never as 5/5.**

This is also the resolution of the log's own "unexplained audit row": `$2,500/5 beats
$5,000/5` was an artefact of how the log is read, not a defect in the mechanism. The
headline row is the median of 50 orderings drawn from ONE advancing `mulberry32(PANEL_SEED)`
stream; each audit row is a SINGLE ordering from a freshly re-seeded `mulberry32(PANEL_SEED)`;
and `$2,500/5` is not in `AUDIT_CONFIGS` at all, so the log contains no like-for-like pair
anywhere. Measured **paired** — same ordering key sequence for both configs, 50 orderings
per fold — doubling capital is worth **+0.1 to +1.1 pp/yr, positive in 7 of 8 folds**
(test2 −0.3%). The whole-share constraint does bite on affordability (test3 drops 46
unaffordable signals at $2,500 against 12 at $5,000) but costs almost nothing in return,
because a dropped signal usually just frees the slot for another one.

## 3. Ranking versus random selection — the debt on `runScan.ts`, paid

Since ~96% of signals are dropped for want of a slot, *which* signals get the slots could be
the whole game. Three rankings were measured against the random band at $2,500/5 on all
eight folds, in dollars and again in **R** — mean rMultiple over the trades the walk
actually took, which is risk-normalised, so leverage cancels.

The discriminator was fixed before the run: **an advantage that survives in R is selection;
an advantage that vanishes in R is position sizing.**

| ranking | beats median ($) | beats median (R) | above R-p95 | leverage vs random |
|---|---|---|---|---|
| `cheap` | 4/5 + 3/3 | 4/5 + 3/3 | 2/8 | 1.27x |
| `hi-vol` | 4/5 + 3/3 | 3/5 + 3/3 | 0/8 | 1.81x |
| `hi-adx` | 2/5 + 3/3 | 3/5 + 3/3 | 3/8 | 1.05x |

`walkPortfolio` sizes in **dollars** (`shares = floor(budget / entry)`), so risk per
position is `budget × ATR% × 1.5`. Any ranking correlated with ATR% therefore buys
**leverage**, not selection. `hi-vol` is leverage outright: 1.81x, above the R-p95 in 0 of
8 folds, and it goes backwards in R on select and test1. `cheap` is mostly leverage — its
beats-median result survives into R, but the strong form collapses from 5/8 to 2/8.
`hi-adx` is the only one leverage does not explain (1.05x).

### `hi-adx` is not a proposal — it is what already ships

`src/lib/trading/runScan.ts` already carries `candidates.sort((a, b) => b.adx - a.adx)`,
with its own comment ending *"Untested as a ranking — worth its own sweep before anyone
trusts it."* So this experiment paid a debt on **live code**, not on a proposal. The answer
is that the shipped tie-break is **at worst harmless**.

It is still **not evidence that it helps**, for two reasons:

1. All eight folds are spent. The experiment can only *disconfirm*; a positive is a
   hypothesis with no unspent data left to confirm it.
2. `hi-adx`'s dollar verdict flips with the random band's construction — 4/5 post-2016
   against 10-stream medians, 2/5 against per-ordering medians.

**Operative rules:** keep the ADX tie-break; never write it up as proven; and never add a
new ranking correlated with ATR% — that is raising risk per position, not selecting better.

## 4. Membership survivorship — open, and unmeasurable with this data

`src/lib/trading/universe.ts` hard-codes **today's** S&P 500 (490 unique names). The
shallow cache holds 491 keys (the extra is SPY); the deep cache holds 453 (38 list names
were unfetchable).

Names that left the index between 2000 and 2016 — Lehman, WorldCom, Bear Stearns — are not
in a low quartile. **They are not in the data at all.** The quartile diagnostic, now run
three times, measures winner *drift among survivors* and cannot reach that, exactly as
`scripts/deep-holdout.mts:228` and `scripts/weekly-indicator-deep-holdout.mts:112` already
state in their own headers.

Even among survivors the deep panel does not start together. First-bar year across the 453
deep-cache names:

| year | 1998 | 1999 | 2000 | 2001 | 2002 | 2003 | 2004 | 2005 |
|---|---|---|---|---|---|---|---|---|
| names | 325 | 10 | 10 | 13 | 5 | 3 | 11 | 9 |

| year | 2006 | 2007 | 2008 | 2009 | 2010 | 2011 | 2012 | 2013 | 2014 | 2015 |
|---|---|---|---|---|---|---|---|---|---|---|
| names | 6 | 10 | 4 | 4 | 9 | 6 | 8 | 9 | 6 | 5 |

Only **345 of 453** names have a bar from 2000 or earlier. DEEP1 therefore runs on a
smaller, older and more heavily selected subset than the later folds — and DEEP1 is the
fold with the largest margin of all (+19.4).

**What still protects the work is the matched control.** It re-places random entries within
the SAME symbols, so both sides inherit the same lift:

- **Margins over the control remain readable.**
- **Absolute levels do not.** Every annualised return in §1 is biased upward by an unknown
  amount.

This is what `PANEL_SURVIVORSHIP_CAVEAT` (`src/lib/research/panel.ts:295`) exists to print
beside every panel number, and it must not be dropped from any write-up.

Closing this properly needs two datasets the project does not have, and neither is free:

1. a **point-in-time S&P 500 constituent list** with add/drop dates going back to 2000;
2. **price history for delisted names.**

Until both exist, report the status as **"open, unmeasurable with this data"** — never as
tested, handled, or passed.
