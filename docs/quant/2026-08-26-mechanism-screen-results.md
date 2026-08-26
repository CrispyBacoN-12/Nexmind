# Mechanism screen — six entry families vs. the matched random control

**Date:** 2026-08-26 · **Harness:** `scripts/mechanism-screen.mts` · **Raw output:**
`scripts/mechanism-screen.log` (no control) and `scripts/mechanism-screen-control.log`
(200-run control, both medians and p95). Panel `.cache/bars/sp500-1d.json`,
`fetchedAt 2026-08-16T20:39:45.212Z`, 491 symbols, ladder `flat` (tp1 1.2 / sl 1.5,
`DEFAULT_COST_MODEL`), `PANEL_SEED` 20260825.

## Why it was run

Four families were already closed as rejected — trend-pullback continuation,
Donchian/breakout, the 13 confluence vetoes, and cross-sectional mean reversion +
momentum. The remaining plan was "run more research rounds and wait for a survivor",
which searches the same drawer harder. This screened six mechanisms from **outside**
that drawer, pre-registered at six tests before the first run.

## The headline, and it is about the old rule, not the new ones

**The baseline loses to the MEDIAN matched random entry in all five folds.**

| fold | baseline avgR | control median | control p95 | margin vs p95 |
|---|---|---|---|---|
| fit | −0.003 | +0.010 | +0.017 | −0.019 |
| select | −0.034 | +0.067 | +0.078 | −0.112 |
| test1 | +0.010 | +0.032 | +0.040 | −0.030 |
| test2 | −0.024 | +0.001 | +0.009 | −0.033 |
| test3 | −0.014 | +0.014 | +0.020 | −0.034 |

The control holds everything fixed except entry timing: same symbols, same trade count,
same long/short mix, same exits, same costs. So this is not "the baseline is roughly
zero" (the previous statement of it) but the stronger and more useful claim: **on this
panel, `decideSetup()`'s entry timing is worse than coin-flip timing with identical
directional exposure, in every fold, including the two it was developed on.**

That is the result that should govern what happens next. It says the problem was never
the exit ladder, the confluence filters, or the regime gate — all of which were tuned
around an entry rule that subtracts value from random.

## The six mechanisms

Screening folds are **fit** and **select** only. TEST columns are recorded for the audit
trail and were not used to choose anything.

| mechanism | FIT margin | SELECT margin | folds beating p95 | verdict |
|---|---|---|---|---|
| `mr-down3` — long after 3 lower closes | −0.005 | −0.026 | 3/5 | **rejected** |
| `nr7` — narrowest range of 7, SMA50 direction | −0.027 | −0.068 | 0/5 | **rejected** |
| `gap-fade` — fade an open outside yesterday's range | **+0.012** | **+0.021** | **5/5** | **survives stage one** |
| `turn-of-month` — long the last weekday of the month | −0.002 | −0.125 | 2/5 | **rejected** |
| `vol-dryup` — lowest volume of 20 above own SMA50 | +0.005 | −0.103 | 2/5 | **rejected** |
| `range-expand` — largest TR of 20, close in top/bottom quarter | −0.005 | −0.005 | 1/5 | **rejected** |

### The trap this run demonstrates, with numbers

Before the control, the ranking was the exact inverse. Raw avgR made `mr-down3`
(+0.080 / +0.133), `vol-dryup` (+0.108 / +0.083) and `turn-of-month` (+0.093 / +0.051)
look like three discoveries, and `gap-fade` (−0.013 / −0.031) look like the worst idea
in the batch.

All three of the apparent winners are **long-only**. All three of the long/short rules
sat at or below zero. On a universe where 69–87% of names rose in every window, that
ordering is the beta of today's S&P 500 membership being read as a mechanism.

The cleanest single demonstration is `turn-of-month` on test1: **avgR +0.355, win rate
75.5%** — and a control p95 of **+0.124**, because 2020–2021 is the COVID recovery, where
random long entries also made +0.11 on the median. A row that would have been quoted as a
0.35R edge is a 0.23R margin in the one fold that happens to be a violent up-move, and
**−0.125 on the screening fold nobody would have shown.**

`turn-of-month` reads no price at all. It is in the batch as a control on the batch, and
it did its job: it proves the screen can manufacture a spectacular-looking result from a
calendar, which is what every raw-avgR row here is worth.

## What `gap-fade` actually earned, stated narrowly

It beats the control **median in 5/5 folds and the p95 bar in 5/5 folds**. Nothing else in
the batch does either. Under the panel's own pass criterion (`CONTROL_PERCENTILE` 0.95)
that is the only row that passes.

Three limits, all load-bearing:

1. **It loses money.** Absolute avgR is negative in four folds (−0.013, −0.031, −0.004,
   +0.001, −0.014). Its control is *also* negative (−0.031, −0.063, −0.032, −0.012,
   −0.024) because the rule is short-heavy and the universe rises. So the margin is
   real and the P&L is not. This is an information result, not a tradeable one.
2. **The implementation is known to be wrong for the mechanism.** `simulateExits` fills at
   the CLOSE of the signal bar, so the rule detects a gap that happened at the open and
   then enters six and a half hours later. Fixing that needs either intraday bars or an
   engine that can fill intrabar — it is not a parameter to sweep.
3. **The margins are small and the trade count is huge** — 42,474 trades on FIT, ~2.4× the
   baseline. At +0.012R with costs already applied, this is the regime-gate order of
   magnitude, and the same caution applies: a small margin over a large N is not a big
   effect, it is a measurable one.

## What is closed by this

- `mr-down3`, `nr7`, `turn-of-month`, `vol-dryup`, `range-expand` — **do not re-tune.**
  Five of six failed on the screening folds and the failure mode was identical in every
  case: raw avgR carried by long bias, margin over matched control at or below zero.
- The general lesson, now demonstrated twice (regime features, then these): **a raw avgR
  number computed on this panel carries no information on its own.** Only the margin over
  the matched random control does. Any future result quoted without its control row should
  be treated as unmeasured.

## What is open

Whether to pursue `gap-fade` under an implementation that can act on the gap, which needs
a data or engine decision first, or to conclude that price-only mechanisms on daily S&P
500 bars are exhausted and change the input rather than the rule. That decision is not
made by this document.

---

## Pre-registration for the broad-universe re-run

**Written before the run, deliberately.** The decision taken on 2026-08-26 was to change the
input rather than the rule, so `.cache/bars/broad-1d.json` holds ~1,165 liquid US common
stocks disjoint from the S&P 500 over the identical 2016-01-04..2026-08-25 span
(`scripts/cache-broad-universe.mts`). The re-run uses the **same six mechanisms, same
baseline row, same folds, same `flat` ladder, same `PANEL_SEED`, same `--control=200`** via
`--panel=`. Only the universe differs. It is the same six tests on a second dataset, not a
seventh test.

What each outcome would mean, fixed now so it cannot be chosen afterwards:

1. **The `baseline` row is the headline, not the mechanisms.** On the S&P 500 it loses to the
   control median in 5/5 folds. If it clears the control on the broad panel, the eleven
   failures to date were a statement about *where* we looked, and the entry-rule family is
   not dead. If it loses there too, the rule is dead independently of universe and no further
   work belongs on it.
2. **A mechanism counts as surviving only on positive margin in BOTH fit and select.** Not
   one of them, not an average of five, not "best in test1". The TEST columns are audit trail.
3. **A survivor on the broad panel that failed on the S&P 500 is a universe finding, not a
   discovery** — and is only interesting if the `baseline` row did *not* move the same way.
   If everything improves together, that is the broad panel's heavier survivorship bias
   showing up in the levels, and the margins must be re-examined before anything is claimed.
4. **Absolute avgR off the broad panel is not reportable at all.** Margins only. The universe
   is more survivorship-biased than the S&P 500 cache, not less.
