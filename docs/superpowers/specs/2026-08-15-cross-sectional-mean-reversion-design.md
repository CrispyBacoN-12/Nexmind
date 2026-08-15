# Cross-Sectional Mean Reversion (US Stocks) — Design

**Date:** 2026-08-15
**Status:** DESIGN — approved for planning, nothing implemented yet
**Scope:** a new strategy family + a new portfolio-level backtester. Adds only; changes nothing that currently runs.

## Why this exists

The broker the user is moving to trades **US stocks only — no gold**. Every validated edge in this
project so far lives on `GC=F` 1h (24-hour futures bars): `macd-trend-sma50-regime`, BOS+trend, the
DI-Dominance family. We already measured that the same mechanisms weaken on `GLD` — the gappy
regular-trading-hours ETF proxy — so they cannot simply be re-pointed at equities.

Gold gave us one instrument, so the only available edge was time-series. A stock universe gives us
hundreds, which opens **cross-sectional** ranking: score every stock each day and trade the extremes.
That matters less because it is likely more profitable and more because of sample size. The single
biggest killer of past candidates was trade starvation — combo-gold's headline "PF 3.25 / 72% win"
rested on ~18 trades over five years. A cross-sectional strategy on 500 names produces thousands of
trades over the same window, which is the first time this project will be able to validate anything
with real statistical weight.

It is also a genuinely different mechanism. Everything validated to date is trend-following, and the
two independent trend edges we found fail in the *same* block (2024-11). Mean reversion is not
correlated with them by construction.

## Constraints

| Constraint | Value | Consequence |
|---|---|---|
| Market | US equities | Alpaca deep daily history + existing `sp500`/`nasdaq100`/`dow30` universes apply |
| Capital | under $2–3k | 5 slots at ~$500 each; **fractional shares required** |
| PDT | will bind when live (account under $25k) | every position holds at least one night, by construction |
| Shorting | not confirmed available | **long-only**, with a market regime filter standing in for the short leg |
| Stage | paper | Webull PaperTrade shadow execution (merged 2026-08-14) is the deployment target |

## Section 1 — Data foundation and survivorship bias

### The bias, stated plainly

`SP500` in `src/lib/trading/universe.ts` is a hardcoded list of 491 **current** constituents. Stocks
that were removed, delisted, or went bankrupt are absent. Backtesting "buy the biggest losers" against
a survivors-only list means systematically buying dips in companies we already know recovered. Mean
reversion is the strategy family most inflated by this bias, because its entire return comes from the
bounce that a delisted company never delivers.

We have no point-in-time constituent database and no free source for one. We therefore **accept the
bias and design so the result must survive a discount**, rather than pretend it is absent.

### Mitigations

1. **Every filter is computed point-in-time** from the bars themselves — price, dollar volume, moving
   averages all use bars at index ≤ t. The universe membership is biased; the filters are not.
2. **Run the same config on Dow 30, Nasdaq 100, and S&P 500.** Narrower lists are more survivorship-
   contaminated. If results *improve* as the universe narrows, that is evidence the profit is bias,
   not edge. This is a diagnostic, not a tuning knob.
3. **A higher acceptance bar than the gold work used.** A PF near 1.05 was arguably acceptable on
   `GC=F` where survivorship does not apply. It is not acceptable here — bias could account for all of
   it. See Section 4 for the concrete gates.
4. **Every reported number is an upper bound**, and will be labelled that way in the results write-up.

### Fetching and caching

Daily bars via `fetchCandlesBatch` (`src/lib/marketData.ts:94`), which already chunks at 100 symbols
and falls back to Yahoo per-symbol on Alpaca 4xx. `range: "max"` maps to ~20 years
(`src/lib/alpaca.ts` `rangeToLookbackMs`); actual depth on the free IEX feed will be shorter and is
measured, not assumed, on first fetch.

Bars are **cached to disk** after the first fetch. Sweeps re-run dozens of times and re-pulling 491
symbols per run is both slow and rate-limit hostile. Cache location and format are an implementation
detail for the plan; the requirement is that a sweep run performs zero network calls after warm-up.

`SPY` is fetched alongside the universe — it is the regime input, not a tradable symbol here.

## Section 2 — The mechanism

### Signal

Rank eligible stocks each day by how far they have fallen recently, normalized by their own
volatility so a $400 stock and a $20 stock are comparable.

### Parameter grid

| Component | Default | Sweep range |
|---|---|---|
| Fall measure | K-day return ÷ ATR | K ∈ {2, 3, 5}; alternative measure: RSI(2) |
| Liquidity filter | price > $5 and 20-day average dollar volume > $10M | volume threshold ∈ {5, 10, 25}M |
| Quality filter | price above its own SMA200 | on / off |
| Market regime | SPY above SMA200 | off / SPY>SMA200 / SPY 10-day slope positive |
| News filter | drop symbols with any single-day move > 15% | 10 / 15 / 20% / off |
| Slots | 5 concurrent positions | 3, 5, 10 |
| Exit | hold H days, then sell | H ∈ {3, 5, 10}; alternative: sell when close > SMA5 |
| Stop | ATR stop at 3× | off / 2× / 3× |

### Two deliberate departures from existing project conventions

**Stops are optional, not assumed.** Mean reversion earns its return by buying overshoot. A tight
stop exits at the bottom — precisely where the edge lives. Every existing strategy in this repo is
built around ATR stop/target, so this is a real break. The stop is a swept parameter that can be
turned fully off, and the data decides.

**Exits are time-based, not target-based.** Positions close after H days regardless of P/L. This
means `decideAction` and the TP ladder in `src/lib/trading/positionRules.ts` **do not apply** to this
strategy; it needs its own exit handling in the new backtester and in the live runner.

### Execution assumptions

- Signal computed from bars up to and including day t; entry fills at the **open of day t+1**.
  Entering at day-t close would be lookahead and would inflate results.
- Exits fill at the open of the exit day, on the same rule.
- Positions are equal-weight across slots. At $2,500 with 5 slots that is ~$500 per position, which
  requires fractional shares (Webull supports these for US equities).
- Minimum hold is one night by construction, so the strategy is PDT-compliant without a special case.

## Section 3 — The portfolio backtester

`backtestCandles` (`src/lib/backtest/engine.ts:235`) is single-symbol and holds one position at a
time. It cannot express "rank 491 stocks today, hold the top 5." A new module is required.

### Interface

New file `src/lib/backtest/crossSectional.ts` — a pure function, no database and no network access, so
it is unit-testable on synthetic bars exactly like `engine.test.ts`.

```
crossSectionalBacktest(
  bars: Map<symbol, Candle[]>,          // universe plus SPY for the regime input
  cfg: { rank, filters, regime, slots, hold, stop, costs, capital }
) -> { trades, equityCurve, summary }
```

### Day loop

The loop walks a **shared trading-day calendar**, not one symbol at a time. For each day t:

1. Collect symbols with a bar at t and enough history for the indicators. Symbols that had not listed
   yet drop out naturally, so listing dates need no special handling.
2. Apply the point-in-time filters to get the eligible set for that day.
3. Evaluate the regime input. When the regime is off, open no new positions — but existing positions
   continue to their scheduled exit rather than being force-closed.
4. Rank the eligible set and queue the top candidates, up to the number of free slots, for entry at
   the open of t+1.
5. Step open positions: close those that have reached H days held or hit their stop; record the
   R-multiple and P/L.
6. Mark the book to market and append to the equity curve.

### Correctness rules enforced in code

- Indicators for day t read bar indices ≤ t only. This is covered by a unit test that feeds data with
  deliberately favourable *future* bars and asserts the trade list is unchanged.
- Entries fill at t+1 open; exits fill at the exit day's open.
- When more candidates qualify than there are free slots, selection is strictly by rank — never by
  symbol order, which would silently bias toward alphabetically early tickers.
- Costs use `DEFAULT_COST_MODEL` (`src/lib/backtest/engine.ts:63`) so results stay comparable with
  every earlier experiment in this project.

### Outputs beyond the existing summary

The daily equity curve enables **max drawdown**, **CAGR**, and **time-in-market** — the fraction of
days with any position open. Time-in-market matters because a regime filter that keeps the book flat
60% of the time changes what the strategy actually is, and a headline PF hides that.

## Section 4 — Acceptance gates

Written before any results are seen, so the criteria cannot be renegotiated afterward. Each gate
comes from a specific failure already suffered in this project.

| # | Gate | Origin |
|---|---|---|
| 1 | At least 500 trades in each of the train and test windows | combo-gold's "PF 3.25" rested on ~18 trades |
| 2 | Positive in **both** the train and the test half | inverted splits (negative in-sample, positive OOS) are lucky subsets, not edges |
| 3 | Positive in at least 5 of 6 walk-forward blocks | the bar `macd-trend-sma50-regime` cleared |
| 4 | Neighbouring parameter values also work — a plateau, not a spike | the approved DI params sat off the robust region |
| 5 | Still positive with costs multiplied by 3 | thin edges die here, and better to learn it now |
| 6 | Results do **not** improve as the universe narrows | survivorship diagnostic from Section 1 |
| 7 | Higher return-per-unit-of-max-drawdown than SPY buy-and-hold over the same window | if it loses to the index there is no reason to trade it |

Split protocol: chronological 65/35 train/test, matching `scripts/sweep-*.mts`. Walk-forward across
6 sequential blocks, matching `scripts/walkforward-*.mts`.

**On failure at any gate: write down how it died and stop.** No re-tuning until something passes.
The failure note is itself the deliverable — the record of dead mechanisms is what keeps this project
from re-exploring them.

## Section 5 — Deployment (only after all gates pass)

- **New runner `scripts/scan-cross-sectional.mts`.** The existing `scripts/scan.mts` scans symbol by
  symbol; this strategy must rank the whole universe before it can decide anything, so it cannot reuse
  that entry point.
- **AI stage placement:** the ranker selects candidates, and HAWK/SAGE review only the handful about
  to be entered — roughly 5 per day, not 491. AI cost is bounded and small.
- **Schedule:** Windows Task Scheduler after the US close, routed through the Webull PaperTrade shadow
  execution path merged 2026-08-14.
- **Paper first**, following the project's existing rule of at least one month of paper track record
  before any go-live discussion.

## Out of scope

Not touched by this work: the running gold desk, the RL sizer, the AI research loop, the existing
strategy registry entries, `decideAction` / the TP ladder, and the Webull integration itself. This
change is additive.

## Open risks

- **Survivorship bias may be large enough to explain any edge found.** Gate 6 detects the direction of
  the effect but cannot size it. Results stay labelled as upper bounds.
- **Free-tier Alpaca daily depth is unmeasured.** If history turns out shorter than ~8 years, gate 1
  and the 6-block walk-forward may not both be satisfiable, and the validation plan needs revisiting
  before the sweep — not after.
- **Fractional-share support on the live broker is assumed, not verified.** If unavailable, slot count
  drops to what whole shares allow at the account size, which weakens diversification materially.
