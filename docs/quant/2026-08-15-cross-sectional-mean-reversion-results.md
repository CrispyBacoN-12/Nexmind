# Cross-Sectional Mean Reversion on US Stocks — Results and Verdict

**Date:** 2026-08-15
**Spec:** `docs/superpowers/specs/2026-08-15-cross-sectional-mean-reversion-design.md`
**Plan:** `docs/superpowers/plans/2026-08-15-cross-sectional-mean-reversion.md`
**Code:** `src/lib/backtest/crossSectional/`, `scripts/sweep-cross-sectional.mts`, `scripts/walkforward-cross-sectional.mts`

## TL;DR

**REJECTED.** The mechanism produces a small, genuine-looking edge — 2,131 trades, 54.5% win rate,
PF 1.15, +61.7% over 5.3 tradable years — and it fails anyway, for two independent reasons:

1. **It loses to buying SPY at the same risk.** +61.7% against SPY's +87.4% over the same span,
   on a 24.0% max drawdown against SPY's 25.4%. Roughly 29% less return for the same pain — and
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
  Median depth **1,518 bars ≈ 6.0 years**, running **2020-07-27 … 2026-08-14**. This sits in the
  spec's "4–8y: proceed but flag" band — flagged here.

  An earlier version of this document reported SPY as spanning "2018-11-01 … 2026-08-14". That was
  wrong, and the way it was wrong is worth recording. **22 of the 491 cached symbols carry a single
  orphan bar** dated 2017–2018, followed by a multi-year hole, followed by the real dense series
  starting 2020-07-27. SPY is one of them: one bar on 2018-11-01, a **634-day gap**, then daily bars
  from 2020-07-27. ANSS has one bar on 2018-07-26 and a 732-day gap. Reading `candles[0].t` as "when
  the data starts" turns one stray bar into 1.7 fictitious years of history.

  The orphans do **not** corrupt the signals. SMA200 at index *i* averages bars *i−199…i*, so from
  index 200 on it never touches index 0; the 20-bar windows clear it even sooner; and Wilder's ATR,
  though recursive from bar 0, has decayed the orphan's contribution by a factor of ~(13/14)^186 ≈
  2×10⁻⁶ by the time any bar is eligible. What the orphans corrupt is the **calendar**, and that is
  the next bullet.
- **Costs:** `DEFAULT_COST_MODEL` = 0.5 bps slippage charged on each side + a 1 bps round-turn
  commission charged once against entry notional, i.e. **~2 bps round trip**.
- **Benchmark span:** the strategy cannot open a position until its SMA200 exists, so it is
  structurally flat at the start of the file. SPY is therefore measured over the **tradable** span
  and not from 2020-07-27. Crediting the benchmark with what it gained while the strategy was
  forced flat would compare a buy-and-hold that started early against a strategy that could not —
  a limitation of this cache's depth, not of the strategy, since live those 200 bars of history
  would already exist.

  **The tradable span starts 2021-05-11, not 2021-01-05.** `scripts/walkforward-cross-sectional.mts`
  takes `times[200]` from the *union* calendar of all symbols. Because the 22 orphan bars above sit
  in that union, its first 200 entries are a mix of ~22 stray 2017–2018 dates and the real early
  2020-07-27 days, and `times[200]` lands on **2021-01-05**. On that date no symbol has 200 bars of
  *its own* behind it. The earliest any symbol reaches its own index 200 is ANSS on **2021-05-11**
  (the median symbol on 2021-05-13), leaving **100 union days after `times[200]` on which the engine
  can select nothing at all**, by construction.

  Measuring the benchmark from 2021-01-05 therefore hands SPY 100 free days of the 2021 rally that
  the strategy could never have participated in. All benchmark figures in this document have been
  recomputed from the first genuinely tradable day, 2021-05-11:
  **SPY +87.4%, 25.4% max DD, return/DD 3.44** (from 2021-01-05 it reads +109.0% / 4.30).
  The script itself still uses `times[200]`; see "Reproducing these numbers" below.
- **Point-in-time discipline:** every filter and score reads bars at index ≤ t; the signal comes
  from bar t and the fill happens at the **open of t+1**. This is pinned by tests that rewrite bar
  P and everything after it **in place** and assert that nothing dated before P moves — the only
  perturbation shape that can catch an interior `[i + 1]` read. (Appending bars past the end of the
  file, which an earlier version of the test did, proves nothing: a day loop structurally cannot
  read past its own last index.) The suite is mutation-tested — see "Test verification" below.
- **Warm-up:** `isEligible` refuses any index below 200 (the SMA200 warm-up), so every train/test
  and walk-forward window carries a 200-bar warm-up prefix drawn from before its start, and trades
  and equity points from the prefix are filtered out before summarising. Without this, each window
  would silently kill its own first 200 trading days.

## The sweep

648 combos over 7 axes (measure, lookback, SMA200 filter, regime, slots, hold, stop), chronological
65/35 split at 2024-05-14, train window from 2021-01-05 — of which the first 100 days are the dead
ones described under "Benchmark span", so the train half is shorter than it looks.

**This is 1/16 of the grid the spec specified.** Three of the spec's axes were pinned at their
defaults and never varied:

| spec axis | spec range | what actually ran |
|---|---|---|
| liquidity filter | 20-day dollar volume ∈ {5, 10, 25}M | pinned at **$10M** |
| news filter | max single-day move ∈ {10, 15, 20%, off} | pinned at **15%** |
| exit | H ∈ {3, 5, 10} **or** sell when close > SMA5 | H swept; the **SMA5 exit was never tried** |

That is 1/3 × 1/4 × 3/4 = **6.25%** of the specified grid. This does not weaken the verdict — it
strengthens it. The rejection rests on gate 4 (no plateau) and on a train→test rank correlation of
−0.016, and both are properties of the *surface*, measured across 150 surviving configs. A wider
grid gives a noise-selection procedure more lottery tickets, not more signal. But the unswept axes
should be stated rather than left for a reader to infer from the combo count.

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

Run over 2021-01-05 … 2026-08-14, six walk-forward blocks of ~240 days each. Gate 7's SPY
comparison is recomputed from the genuinely tradable 2021-05-11 start (see "Benchmark span").

| Gate | Best (k=3, sma200=y, off, s=10, h=5, no stop) | Top-by-testPF (k=2, sma200=n, spySma200, s=10, h=10) | Runner-up (k=5, sma200=y, off, s=5, h=5) |
|---|---|---|---|
| 1. ≥500 trades per half | **PASS** 1378 / 820 | FAIL 580 / 420 | FAIL 690 / 410 |
| 2. positive in both halves | **PASS** +4925 / +3707 | **PASS** +3398 / +2219 | **PASS** +3687 / +2762 |
| 3. ≥5/6 blocks positive | **PASS** 5/6 | **PASS** 5/6 | FAIL 4/6 |
| 4. parameter plateau | **FAIL** (see above) | **FAIL** | **FAIL** |
| 5. survives 3× costs | **PASS** +4856 | **PASS** +7853 | **PASS** +4366 |
| 6. no gain as universe narrows | **PASS** dow30 1.07 ≤ sp500 1.15 | **PASS** 1.20 ≤ 1.35 | **PASS** 1.13 ≤ 1.14 |
| 7. beats SPY return/maxDD | **FAIL** 2.58 vs 3.44 | **PASS** 3.71 vs 3.44 | **FAIL** 2.74 vs 3.44 |

**No config passes.** Gate 4 fails on all three. Gate 7 fails on two of three, and gates 1 and 3
fail on two of three.

The middle column is worth stating precisely, because the corrected benchmark flipped it. On the
honest 2021-05-11 span, the top-by-testPF config **does** clear gate 7 — 3.71 against SPY's 3.44.
It is still rejected, and by a wide margin: it fails gate 1 (580 / 420 trades against a 500
minimum), fails gate 4 like every other config, and its edge is not distributed — block 4 alone
contributed roughly 80% of its total profit. A config that beats the index on one 5.7-year sample,
on a ratio it clears by 8%, while flunking the sample-size and stability gates designed to catch
exactly that, is a config that got lucky in one window. The gates are an AND, not a scorecard to
total up.

Walk-forward blocks for the best config:

| block | trades | PF | pnl | DD |
|---|---|---|---|---|
| 2021-01-05 … 2021-12-12 | 250 | 1.43 | +1235 | 6.9% |¹
| 2021-12-12 … 2022-11-18 | 390 | 0.77 | **−1645** | 26.7% |
| 2022-11-18 … 2023-10-26 | 389 | 1.16 | +849 | 10.0% |
| 2023-10-26 … 2024-10-01 | 390 | 1.87 | +4157 | 7.5% |
| 2024-10-01 … 2025-09-07 | 390 | 1.28 | +1518 | 19.2% |
| 2025-09-07 … 2026-08-14 | 400 | 1.22 | +1402 | 8.2% |

¹ **Block 1 is not a real block.** Of its 242 union days, only **150 are tradable** — 92 have no
symbol with 200 bars of its own behind it, so the engine can select nothing on them by
construction. Block 1's 1.43 PF was earned in roughly 62% of the calendar time the other blocks
had, and its 250 trades against ~390 elsewhere is the visible symptom. Block 2 loses 6 days and
block 3 loses 2; blocks 4–6 are clean. Gate 3 counts block 1 as one of its 5/6 positives, so the
gate is passing partly on a short block. This does not change the verdict — gate 3 passes either
way, and the failing gates are 4 and 7 — but the block table should not be read as six comparable
windows.

The one losing block is the 2022 bear market, and it is the deepest drawdown by a wide margin. A
long-only "buy the biggest losers" book is a leveraged bet on dip-buying working, and in the one
regime in this sample where dips kept going down, it did what you would expect.

## The failure mode, stated plainly

Not trade starvation — 2,131 trades on the full universe. Not "no edge" either: 54.5% win rate and
+0.258% average net return per trade are real, and the 3× cost stress passes comfortably (costs are
~2 bps round trip against a ~26 bps average edge, so costs are not the binding constraint).

The failure is **a small edge that is not worth harvesting**:

- **It does not beat the alternative.** +61.7% / 24.0% DD versus SPY's +87.4% / 25.4% DD over the
  same tradable span. An investor who did nothing but hold the index earned about 1.4× as much
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

## Test verification

A rejection is only as trustworthy as the engine that produced it, so the test suite backing these
numbers was itself checked by mutation testing: inject a defect into `engine.ts` or `signals.ts`,
run the suite, and record which **named** test goes red. A test that stays green under an injected
defect is not evidence of anything, however many assertions it contains.

Seventeen defects were injected, covering the mechanisms these results actually depend on: fill
timing (entry and scheduled exit at the open, not the close), both slippage legs, stop trigger
(off the low, `<=` not `<`, sized off the prior bar's ATR), regime logic (`spySlope` vs
`spySma200`), point-in-time sizing, free-slot accounting under a queued exit, the 200-bar warm-up
cutoff, and five separate `[i + 1]` lookahead reads across `rankScore`, `isEligible`,
`dollarVol20` and `maxMovePct20`. **All seventeen were killed by name.**

Two of those defects survived the first pass and are the reason this section exists:

- **The no-lookahead test was inert.** It appended 20 bars to the end of each series and asserted
  the result was unchanged. That test cannot fail: a day loop structurally cannot read past its own
  last index, so it passed even with `[i + 1]` reads injected into every signal. A prefix- or
  truncation-based test has the same hole — for `i < M−1`, `atr[i+1]` is identical in the truncated
  and full runs. Only rewriting bar *i+1* **in place** detects an interior lookahead, and that is
  what the replacement does, at both the `buildSeries` layer and the `rankScore`/`isEligible`
  consumer layer.
- **The free-slot test never exercised the accounting it named.** It used a single symbol, and the
  ranker skips any symbol it already holds — so when the defect freed up a slot, there was no
  candidate to fill it and the bug slipped through. It now uses two declining symbols, one held and
  one standing by.

Every perturbation test also carries a **vacuity guard**: an assertion that the perturbation *does*
move something it is legitimately allowed to move. Without one, a fixture that quietly stopped
producing trades would turn the whole test into a green no-op.

## Reproducing these numbers

```bash
node --env-file=.env --import tsx scripts/sweep-cross-sectional.mts sp500
```

```bash
node --env-file=.env --import tsx scripts/walkforward-cross-sectional.mts sp500 atrReturn 3 off 10 5 off y
```

**The walk-forward script has not been changed, so its gate-7 line will not match this document.**
It still measures SPY from `times[200]` = 2021-01-05 and will print `spy=4.30 (109.0%/25.4%)`; the
corrected figure is `3.44 (87.4%/25.4%)` from 2021-05-11, and the gate-7 row above uses the
corrected one. Everything else the script prints — block table, trade counts, PF, cost stress,
universe haircut — is unaffected, because those come from the engine rather than from the benchmark
slice.

The script was left alone deliberately. Correcting `start` shifts all six block boundaries and the
65/35 mid split, which would change every number in the block table and in gates 1–3 — a re-run
whose only possible outcome is a differently-shaped presentation of a strategy that has already
been rejected on gates 4 and 7. The fix belongs with whoever next runs this harness on a mechanism
that is still alive; it is recorded here so that they do not rediscover it.
