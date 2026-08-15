# Cross-Sectional Mean Reversion on US Stocks — Results and Verdict

**Date:** 2026-08-15
**Spec:** `docs/superpowers/specs/2026-08-15-cross-sectional-mean-reversion-design.md`
**Plan:** `docs/superpowers/plans/2026-08-15-cross-sectional-mean-reversion.md`
**Code:** `src/lib/backtest/crossSectional/`, `scripts/sweep-cross-sectional.mts`, `scripts/walkforward-cross-sectional.mts`

## TL;DR

**REJECTED.** The mechanism produces a small, genuine-looking edge — 2,131 trades, 54.5% win rate,
PF 1.15, +61.7% over 5.7 tradable years — and it fails anyway, for two independent reasons:

1. **It loses to buying SPY at the same risk.** +61.7% against SPY's +109.0% over the same span,
   on a 24.0% max drawdown against SPY's 25.4%. Roughly 40% less return for the same pain — and
   that is before adjusting for the survivorship bias that inflates the strategy but not the
   benchmark.
2. **Parameter choice is indistinguishable from noise.** Across the 150 configs that cleared the
   in-sample bar, the rank correlation between train profit factor and test profit factor is
   **−0.016**. In-sample ranking carries no information about out-of-sample ranking. Picking the
   "best" config from the sweep is picking a lottery ticket.

Do not re-tune this. Do not re-explore this mechanism on this universe with this data depth.
The gates exist to stop exactly the loop that a 1.15 profit factor invites.

## How this was measured

- **Data:** Alpaca daily bars, 491 S&P 500 symbols + 31 Dow 30, cached at `.cache/bars/`.
  Median depth **1,518 bars ≈ 6.0 years**; SPY spans 2018-11-01 … 2026-08-14 (1,522 bars).
  This sits in the spec's "4–8y: proceed but flag" band — flagged here.
- **Costs:** `DEFAULT_COST_MODEL` = 0.5 bps slippage charged on each side + a 1 bps round-turn
  commission charged once against entry notional, i.e. **~2 bps round trip**.
- **Benchmark span:** the strategy cannot open a position until its SMA200 exists, so it is
  structurally flat for the first 200 bars of the file. SPY is therefore measured over the
  **tradable** span (2021-01-05 …) and not from 2018-11-01. Crediting the benchmark with the
  36.7% it gained while the strategy was forced flat would compare a buy-and-hold that started
  early against a strategy that could not — a limitation of this cache's depth, not of the
  strategy, since live those 200 bars of history would already exist.
- **Point-in-time discipline:** every filter and score reads bars at index ≤ t; the signal comes
  from bar t and the fill happens at the **open of t+1**. The engine has a direct regression test
  that future bars cannot change a past result.
- **Warm-up:** `isEligible` refuses any index below 200 (the SMA200 warm-up), so every train/test
  and walk-forward window carries a 200-bar warm-up prefix drawn from before its start, and trades
  and equity points from the prefix are filtered out before summarising. Without this, each window
  would silently kill its own first 200 trading days.

## The sweep

648 combos over 7 axes (measure, lookback, SMA200 filter, regime, slots, hold, stop), chronological
65/35 split at 2024-05-14, train window from 2021-01-05.

**150 of 648 cleared the train bar** (≥500 train trades and train PF ≥ 1.1). Of those 150, 104 had
test PF above 1.00 and 48 above 1.10.

Top rows by test profit factor:

| params | trainPF | testPF | testTrades | testDD% |
|---|---|---|---|---|
| atrReturn k=2, sma200=n, regime=spySma200, slots=10, hold=10, stop=off | 1.20 | 1.47 | 490 | 18.5 |
| atrReturn k=5, sma200=y, regime=off, slots=5, hold=5, stop=off | 1.18 | 1.45 | 470 | 16.6 |
| atrReturn k=3, sma200=y, regime=off, slots=10, hold=5, stop=off | 1.22 | 1.40 | 940 | 12.3 |
| atrReturn k=5, sma200=y, regime=off, slots=10, hold=5, stop=off | 1.22 | 1.37 | 912 | 13.5 |
| atrReturn k=3, sma200=y, regime=spySma200, slots=10, hold=5, stop=off | 1.21 | 1.35 | 860 | 14.4 |
| rsi2, sma200=n, regime=off, slots=3, hold=3, stop=3 | 1.33 | 1.26 | 420 | 17.0 |

That table looks encouraging. The next two sections are why it is not.

### The train ranking predicts nothing

**Spearman(trainPF, testPF) across the 150 survivors = −0.016.**

The fifteen configs with the *highest* train PF (1.33–1.38) landed in test at 1.09, 0.92, 1.20,
1.00, 0.99, 1.01, 0.98, 1.02, 0.96, 0.88, 1.26, 1.20, 1.19, 1.17, 1.08 — a spread centred near
breakeven. Being the best in-sample config conveyed no advantage out-of-sample whatsoever.

This is the finding that matters most, and it is not visible from the top of a sorted table. Any
selection procedure applied to this sweep — "take the best", "take the top five and average" —
is selecting noise.

### There is no parameter plateau

Neighbourhood of the strongest gate-passing config
(atrReturn, k=3, sma200=y, regime=off, slots=10, hold=5, stop=off), varying one axis at a time:

| axis | values → test PF |
|---|---|
| lookback | k=2 → **1.01** · k=3 → **1.40** · k=5 → **1.37** |
| **holdDays** | h=3 → **0.89** · h=5 → **1.40** · h=10 → **0.99** |
| slots | s=3, s=5 did not clear the train bar · s=10 → **1.40** |
| stop | off → **1.40** · 2 → **1.10** · 3 → **1.12** |
| SMA200 filter | y → **1.40** · n → **1.06** |
| regime | off → **1.40** · spySma200 → **1.35** · spySlope → **1.02** |

`holdDays` is a **spike**: both adjacent values sit at or below breakeven while the chosen value
returns 1.40. `lookback` is a partial plateau (k=3/k=5 hold, k=2 collapses). A parameter surface
where the winning value's immediate neighbours lose money is the textbook signature of a curve fit.
**Gate 4 fails.**

## Gate scorecards

Run over the tradable span 2021-01-05 … 2026-08-14, six walk-forward blocks of ~220 days each.

| Gate | Best (k=3, sma200=y, off, s=10, h=5, no stop) | Top-by-testPF (k=2, sma200=n, spySma200, s=10, h=10) | Runner-up (k=5, sma200=y, off, s=5, h=5) |
|---|---|---|---|
| 1. ≥500 trades per half | **PASS** 1378 / 820 | FAIL 580 / 420 | FAIL 690 / 410 |
| 2. positive in both halves | **PASS** +4925 / +3707 | **PASS** +3398 / +2219 | **PASS** +3687 / +2762 |
| 3. ≥5/6 blocks positive | **PASS** 5/6 | **PASS** 5/6 | FAIL 4/6 |
| 4. parameter plateau | **FAIL** (see above) | **FAIL** | **FAIL** |
| 5. survives 3× costs | **PASS** +4856 | **PASS** +7853 | **PASS** +4366 |
| 6. no gain as universe narrows | **PASS** dow30 1.07 ≤ sp500 1.15 | **PASS** 1.20 ≤ 1.35 | **PASS** 1.13 ≤ 1.14 |
| 7. beats SPY return/maxDD | **FAIL** 2.58 vs 4.30 | **FAIL** 3.71 vs 4.30 | **FAIL** 2.74 vs 4.30 |

**No config passes.** Gates 4 and 7 fail on every config tested; gates 1 and 3 fail on two of three.

Walk-forward blocks for the best config:

| block | trades | PF | pnl | DD |
|---|---|---|---|---|
| 2021-01-05 … 2021-12-12 | 250 | 1.43 | +1235 | 6.9% |
| 2021-12-12 … 2022-11-18 | 390 | 0.77 | **−1645** | 26.7% |
| 2022-11-18 … 2023-10-26 | 389 | 1.16 | +849 | 10.0% |
| 2023-10-26 … 2024-10-01 | 390 | 1.87 | +4157 | 7.5% |
| 2024-10-01 … 2025-09-07 | 390 | 1.28 | +1518 | 19.2% |
| 2025-09-07 … 2026-08-14 | 400 | 1.22 | +1402 | 8.2% |

The one losing block is the 2022 bear market, and it is the deepest drawdown by a wide margin. A
long-only "buy the biggest losers" book is a leveraged bet on dip-buying working, and in the one
regime in this sample where dips kept going down, it did what you would expect.

## The failure mode, stated plainly

Not trade starvation — 2,131 trades on the full universe. Not "no edge" either: 54.5% win rate and
+0.258% average net return per trade are real, and the 3× cost stress passes comfortably (costs are
~2 bps round trip against a ~26 bps average edge, so costs are not the binding constraint).

The failure is **a small edge that is not worth harvesting**:

- **It does not beat the alternative.** +61.7% / 24.0% DD versus SPY's +109.0% / 25.4% DD over the
  same tradable span. An investor who did nothing but hold the index earned nearly twice as much
  for the same drawdown, with no turnover, no PDT exposure, and no execution risk.
- **It cannot be tuned reliably.** Train→test rank correlation of −0.016 means the sweep cannot
  tell you which parameters to run. Whatever config you pick, you are picking blind.
- **It concentrates in one window.** For the top-by-testPF config, block 4 alone (2023-10 … 2024-10)
  contributed +4332 of ~+5346 total — roughly 80% of all profit from one sixth of the sample.

Any one of these would be disqualifying on its own.

## Every number here is an upper bound

The universe is a **hardcoded list of current S&P 500 and Dow 30 constituents**. Companies that were
in the index during 2018–2026 and then went bankrupt, were delisted, or were removed for
underperformance are simply absent. Mean reversion is the strategy family most inflated by this,
because the trade it makes — buy the biggest recent loser and wait for a bounce — is precisely the
trade that ends in a total loss for a company on its way out of the index.

The engine handles a symbol that stops producing bars by marking it at its last observed close and
closing the position there, so a delisting inside the sample is not silently erased. But that only
covers survivors of the *list*; it cannot recover names the list never contained.

So the honest reading is: **a strategy that already loses to SPY on a like-for-like span is losing
by more than the measured margin.**
The gate-6 haircut is consistent with this — the narrower, more survivorship-biased Dow 30 does not
score better than the S&P 500, which is the check passing, but it is a weak check against a bias
this structural.

## Verdict

**Stop here.** Per the spec's Section 4 protocol, a failed gate ends the investigation; this
document is the deliverable. Section 5 of the spec (live runner, AI stage, scheduler, Webull
routing) does **not** become plannable.

Do not respond to this result by loosening a filter, widening the grid, adding an axis, or
re-running with a different split until something passes. A −0.016 train/test rank correlation means
that a config which passes after enough retries passed by chance, and the retry count is the only
thing that changed.

## What would change the answer

Not tuning. Only better inputs:

1. **A point-in-time universe** — index membership as it stood on each date, including delisted
   names. Without it, no long-only US-equity result from this repo can be trusted above its error bar.
2. **More history** — 6.0 years contains one bear market. Gate 3 is being asked to judge robustness
   from a single adverse regime.
3. **A different mechanism.** Cross-sectional mean reversion joins the rejected list alongside
   Donchian/breakout on gold. Two mechanisms, two honest rejections, no live capital risked.

## Reproduce

```bash
node --env-file=.env --import tsx scripts/sweep-cross-sectional.mts sp500
```

```bash
node --env-file=.env --import tsx scripts/walkforward-cross-sectional.mts sp500 atrReturn 3 off 10 5 off y
```
