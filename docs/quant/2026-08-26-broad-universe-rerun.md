# Broad-universe re-run — the same six mechanisms on a disjoint set of stocks

**Date:** 2026-08-26 · **Harness:** `scripts/mechanism-screen.mts --panel=.cache/bars/broad-1d.json --control=200`
· **Raw output:** `scripts/mechanism-screen-broad-control.log` (S&P 500 comparison:
`scripts/mechanism-screen-control.log`) · **Panel:** `scripts/cache-broad-universe.mts`,
1,172 liquid US common stocks **disjoint from the S&P 500**, 2016-01-04..2026-08-25 —
the identical span to `sp500-1d.json`, so `FOLDS`, `PANEL_WARMUP_BARS`, the `flat` ladder
and `PANEL_SEED` are unchanged. Only the universe differs.

Read against the pre-registration written before the run
(`docs/quant/2026-08-26-mechanism-screen-results.md`, final section).

## The question, and the answer

> Was the null result about the mechanisms, or about the universe?

**About the mechanisms.** Moving from the 491 most heavily arbitraged securities on earth to
1,172 smaller names that share not one ticker with them changed essentially nothing.

## Item 1 — the baseline. Pre-registered as the headline, and it is

Margin over the control's 95th percentile, by fold:

| fold | S&P 500 | broad | |
|---|---|---|---|
| fit | −0.019 | −0.024 | both LOSE-to-median |
| select | −0.112 | −0.119 | both LOSE-to-median |
| test1 | −0.030 | −0.016 | both LOSE-to-median |
| test2 | −0.033 | −0.011 | both LOSE-to-median |
| test3 | −0.034 | −0.042 | both LOSE-to-median |

**Ten fold-cells across two disjoint universes, and `decideSetup()` is below the control
MEDIAN in every one of them.** The pre-registered reading was: *"If it loses there too, the
rule is dead independently of universe and no further work belongs on it."* It lost there
too, and the two screening-fold margins agree to within 0.007R on stock sets with zero
overlap. The trend-pullback entry is finished as a research subject.

## Item 2 — survivors need positive margin on BOTH screening folds

| mechanism | S&P 500 fit / select | broad fit / select | verdict |
|---|---|---|---|
| `mr-down3` | −0.005 / −0.026 | +0.007 / −0.014 | fails on both panels |
| `nr7` | −0.027 / −0.068 | −0.032 / −0.089 | fails on both panels |
| **`gap-fade`** | **+0.012 / +0.021** | **+0.012 / +0.001** | **passes on both panels** |
| `turn-of-month` | −0.002 / −0.125 | −0.020 / −0.058 | fails on both panels |
| `vol-dryup` | +0.005 / −0.103 | −0.010 / −0.090 | fails on both panels |
| `range-expand` | −0.005 / −0.005 | −0.035 / −0.049 | fails on both panels |

Every mechanism landed on the same side of the bar on both universes. Not one verdict
flipped. That consistency is itself the finding: these rules are not universe-sensitive, they
are simply not edges.

## Item 3 — is `gap-fade` a universe artifact? No

The pre-registration said a broad-panel survivor is only interesting if the baseline did NOT
move the same way. The baseline did not move at all — it is equally dead on both panels — and
`gap-fade` did not improve on the broad panel either; it **replicated at nearly the same
magnitude**. So this is neither "everything got better together" nor a universe finding. It
is a mechanism reproducing on independent stocks.

`gap-fade` margin, both panels, all folds:

| | fit | select | test1 | test2 | test3 |
|---|---|---|---|---|---|
| S&P 500 | +0.012 | +0.021 | +0.019 | +0.005 | +0.004 |
| broad | +0.012 | +0.001 | +0.013 | +0.005 | +0.016 |

**Positive in 10 of 10 cells across two disjoint universes.** Nothing else this project has
produced comes close to that. It is the only mechanism of the ten screened to date with
replicated evidence of information content.

### Four things that keep it from being a strategy

1. **It still loses money.** Raw avgR is negative in 4/5 folds on both panels. Its matched
   control is also negative, because the rule is short-heavy and the tape rises. The margin
   is real; the P&L is not.
2. **The broad `select` margin is +0.001.** avgR −0.031 against a p95 of −0.032. That is a
   pass by a hair, not a result, and it is the weakest of the ten cells.
3. **Ten cells are not ten independent observations.** The universes are disjoint, which is
   genuine cross-sectional independence, but both panels run over the SAME calendar — the
   same five regimes. The honest count is closer to five regimes each observed on two
   independent stock sets, not ten trials.
4. **The magnitude is ~+0.010R**, the same order as the market gate, on a rule that fires
   63,276 times on the broad fit fold alone. A small margin over a huge N is measurable, not
   large.

## The `turn-of-month` trap replicated exactly

Worth recording because it is the clearest warning this harness produces. On the broad panel
`turn-of-month` shows **test1 avgR +0.268 at 70.6% win, margin +0.193** — against −0.020 and
−0.058 on the two folds anyone is allowed to screen on. On the S&P 500 the same rule showed
test1 +0.355 at 75.5% win, margin +0.231.

Same artifact, two disjoint universes, from a rule that **reads no price at all.** Whatever
2020–2021 is doing to a long-only calendar rule, it does it to any set of US stocks. Anyone
quoting a test-fold number without its screening folds would have "found" a 0.27R edge twice.

## What this closes

- **Changing the universe.** Two disjoint equity universes, ten mechanisms, one calendar,
  same verdicts throughout. Another universe is not where the answer is, and further
  universe-swapping on daily OHLCV should not be funded.
- **The trend-pullback entry**, definitively — see Item 1.
- The five rejected mechanisms, now rejected twice each. Do not re-tune them.

## What this opens

`gap-fade` is the only live thread, and the blocker is no longer statistical. The rule detects
a gap that happened at the OPEN and `simulateExits` fills it at the signal bar's CLOSE — six
and a half hours late, under a 1.2/1.5 ATR ladder that was never designed for a fade. Testing
the mechanism as intended requires intraday bars or an intrabar fill in the engine. That is a
data and engine decision, and it must be made before any parameter is swept; a sweep on the
current implementation would be tuning a deliberately mistimed entry.
