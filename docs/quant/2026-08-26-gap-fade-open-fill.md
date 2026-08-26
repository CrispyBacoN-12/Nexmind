# `gap-fade` at the open — the last live mechanism, closed

**Date:** 2026-08-26 · **Raw output:** `scripts/gap-fade-open-fit.log`,
`scripts/gap-fade-open-attrib.log` · **Code:** `ExitOptions.entryAt`
(`src/lib/backtest/engine.ts`), threaded through `PanelExit`
(`src/lib/research/panelRun.ts`) so the matched control fills where the rule fills.

## Why

`gap-fade` was the only mechanism of ten to beat its matched control in 10/10 fold-cells
across two disjoint universes (`2026-08-26-broad-universe-rerun.md`) while still losing
money. Its known defect was not statistical: the rule compares bar i's OPEN to bar i-1's
high/low — decidable at 09:30 — and `simulateExits` filled it at the CLOSE, six and a half
hours later. So the measured thing and the described thing were not the same strategy.

## Pre-registered before the first run

Fixed in the header of `scripts/mechanism-screen.mts` before `gap-fade-open` was ever
executed:

1. **FIT only decides.** The other folds are audit trail.
2. The comparison is `gap-fade-open` vs `gap-fade` **in the same run**, each against its own
   control — an open fill changes the control too.
3. **It passes only by exceeding `gap-fade`'s +0.012 FIT margin.** Merely staying positive is
   the null result: it would mean the delay was never what cost the rule, and the thread
   closes.
4. If it passes, next is select then test — not a ladder sweep.

## Result: it did not merely fail to exceed. It went negative.

| panel | row | trades | avgR | ctrl med | ctrl p95 | margin |
|---|---|---|---|---|---|---|
| S&P 500 | `gap-fade` (close fill) | 42,474 | −0.013 | −0.031 | −0.025 | **+0.012** |
| S&P 500 | `gap-fade-open` | 48,730 | −0.068 | −0.029 | −0.023 | **−0.045** LOSES-to-median |
| broad | `gap-fade` (close fill) | 63,276 | −0.004 | −0.021 | −0.016 | **+0.012** |
| broad | `gap-fade-open` | 72,488 | −0.031 | −0.020 | −0.015 | **−0.017** LOSES-to-median |

Both `gap-fade` rows reproduce +0.012 exactly, in the same runs, confirming that adding
`entryAt` changed nothing on the default path (387/387 tests also pass).

## What this actually says about the mechanism

Buying the gapped-down OPEN is 0.055R worse than buying the CLOSE of that same session. So
on gap days price tends to keep going **with** the gap intraday, and reverts only afterwards.

The edge the close-fill version measured was never "fade the gap." It was **"let the gap
session finish, then take the reversion."** The close fill was not a mistimed version of a
better idea — it was the idea. The comment in `mechanism-screen.mts` calling it "a strictly
weaker and strictly implementable version" was wrong: it is the stronger one.

And it is still a losing strategy. +0.012R over a control that sits at −0.021 means the rule
loses less than random does. That was true before this test and is unchanged by it.

## The confound, and why it is not the explanation

`gap-fade-open` changed two things at once: the fill price, **and** it began managing the
entry session under `stepPosition`'s pessimistic adverse-before-favorable rule. Gap bars are
wide-range by construction while the control's entries land on ordinary bars, so the matched
control cannot subtract that second effect — visible in how little the control moved
(−0.031 → −0.029 on the S&P 500).

`gap-fade-open-nomanage` isolates it. **DIAGNOSTIC ONLY — not implementable, not quotable as
a result**: a real stop sitting through that session either fires or does not.

| panel | row | avgR | ctrl med | margin |
|---|---|---|---|---|
| S&P 500 | `gap-fade-open` | −0.068 | −0.029 | −0.045 |
| S&P 500 | `gap-fade-open-nomanage` | **−0.068** | −0.036 | −0.038 |
| broad | `gap-fade-open` | −0.031 | −0.020 | −0.017 |
| broad | `gap-fade-open-nomanage` | **−0.030** | −0.026 | −0.009 |

Removing same-session management entirely moves avgR by 0.000 and 0.001. **The whole loss is
the fill price.** The intrabar ambiguity that daily bars cannot resolve is worth ~0.001R here.

## What this closes

- **`gap-fade`.** The one row that survived twenty fold-cells fails the moment it is given
  the price it actually describes. Nothing in the mechanism screen remains open.
- **Intraday bars, as a response to this.** They were justified by one argument: that
  same-session sequencing was being modelled rather than measured. The diagnostic prices that
  ambiguity at ~0.001R against a −0.045 effect. Building a 5m/15m pipeline would resolve a
  rounding error and cannot recover a negative fill-price result. If intraday data is ever
  built, it must be justified by a NEW mechanism that needs it, not by this one.
- With it, the last thread from the daily-OHLCV mechanism programme. Ten mechanisms, five
  families, two disjoint universes, and one corrected fill: nothing tradeable.
