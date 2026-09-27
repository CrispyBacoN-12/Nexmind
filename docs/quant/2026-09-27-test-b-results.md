# Test B — residual momentum as the mr-down3 slot queue: **FAIL**

**Run once, 2026-09-27**, exactly as pre-registered in `docs/quant/PRE_REGISTRATION_TEST_B.md`
(committed `df0f51a` before the simulator existed). Script
`scripts/test-b-residual-momentum-queue.mts`, full log `scripts/test-b-residual-momentum-queue.log`.
Per §7 this verdict is final for the test: no rescue search on these folds.

## Verdict (§7 conjunct)

| | value |
|---|---|
| S_treatment (pooled deep1-3, gap-adjusted, 5+1 bps, C = $100k) | **+0.0125** over 2,473 trades |
| control, 500 random-queue walks | median −0.0016, **p95 +0.0314**, max +0.0491 |
| (1) SELECTION: S > p95 | 0.0125 > 0.0314 → **NO** |
| (2) USABLE: S > 0 | 0.0125 > 0 → YES |
| **TEST B** | **FAIL** |

The ranking beats the control **median** but lands well inside the random-queue distribution. It
does not select.

## Harness checks (all passed before any queue was walked)

- **Trade-set reproduction (§3).** All six fold × cost cells matched `scripts/mr-down3-open-fill.log`
  exactly, both trade count and avgR to three decimals. The log was built with SPY in the panel, so
  the script reproduces on the full panel, then drops SPY's 87 / 82 / 95 trades from the candidate
  set (§2).
- **Correlation equivalence (§5).** 200 random (pair, date) samples against `dateAlignedCorrelation`:
  max |diff| 0, and 16 samples null in both.
- **Compact-NAV equivalence.** Checked against the full history on every candidate day of the
  treatment walk.
- **No-lookahead assertions.** Hold throughout.
- **Sectors.** 452/452 names cached, 0 resolve to "Other".
- **One pre-run change to the script.** Smoke mode (a walk count other than 500) was changed to
  withhold S, the control distribution and the verdict. A smoke run would otherwise have read the
  treatment result before the real run. No rule changed.

## Context (never part of the verdict)

| fold | taken | S_treat | ctrl med | ctrl p95 | S_raw | bottleneck days | maxDD% | final NAV |
|---|---|---|---|---|---|---|---|---|
| deep1 2000-05 | 785 | +0.0028 | −0.0329 | +0.0616 | +0.0089 | 1190 / 1245 | 16.1 | 93,882 |
| deep2 2005-10 | 402 | −0.0654 | −0.0130 | +0.0338 | −0.0402 | 1052 / 1211 | 17.2 | 84,058 |
| deep3 2010-16 | 1,286 | +0.0427 | +0.0029 | +0.0501 | +0.0579 | 1342 / 1439 | 13.9 | 112,104 |

- **Gap-through on stops is large.** 4.1-4.5% of candidates' stops opened through the stop level
  (1,245 / 1,452 / 1,865), costing a mean 0.34-0.40R extra each (49 / 41 / 62 gaps unmeasurable). The unranked candidate pool goes from raw avgR
  +0.011 / +0.012 / +0.056 to gap-adjusted **−0.005 / −0.002 / +0.038**. Condition (2) was always
  going to be close. The pooled S for the treatment is +0.0264 unadjusted and +0.0125 adjusted.
- **Bottlenecks are the norm, not the exception.** Candidates exceeded empty slots on 3,584 of 3,895
  candidate days. The queue did have work to do. It just did not do it better than chance.
- **Gate blocks (treatment, candidates evaluated before the cap filled):**

  | gate | blocks |
  |---|---|
  | GAP_HEAT | 4,066 |
  | DRAWDOWN | 932 |
  | SECTOR | 508 |
  | CORRELATION | 207 |
  | CAPACITY | 115 |
  | REGIME | 0 |

  GAP_HEAT (worst-gap tail heat vs NAV) is by far the binding constraint on the book. REGIME never
  fired; that was not investigated, per the no-rescue rule.
- **Other context figures:**
  - At 0.5 + 1 bps, the treatment S is +0.0319 (2,798 trades).
  - The $2,500 restatement gives S +0.0084 over 2,094 trades, 32 zero-share rejects, and final NAV
    2,177 / 2,403 / 2,544.

## A finding about the portfolio layer itself: safe mode is absorbing

The treatment account was in safe mode on **935 of 3,895 candidate days**. The control walks averaged
**1,642**. deep1 and deep2 both breached the 15% drawdown line (16.1%, 17.2%).

Safe mode clears only when NAV climbs back within 15% of its high-water mark. Under
`strictMode: true`, a flat account in safe mode takes no trades, so its NAV cannot move, so it
**never leaves safe mode**. The rest of that fold is dead.

§5 named this in advance ("reported and not intervened on"). It is also a real property of the gate
as built for `/advisor`. There, the non-strict override with a written reason is the only way out,
and that is the intended behaviour. But it means the drawdown gate is a **one-way door**, not a
cool-down, and the owner should know that before relying on it.

This is a statement about the gate, not about the ranking. The control walks hit the same wall more
often, and the verdict compares like with like.

## What this closes

Residual momentum (12-1 month, single-index vs SPY) as the same-day selection rule for mr-down3's
~40 signals/day, on 2000-2016, under the owner's portfolio rules. Per §7, no other lookback, skip,
β window, volatility scaling, ladder, cost model, fold subset or capital figure is to be tried on
these folds.

§8 says a FAIL on a survivor-biased panel is conclusive in the direction that matters.
