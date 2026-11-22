# Short sweep: replay before going live — design

Owner request 2026-11-22: "the market is in a downtrend, longs don't work, so open shorts instead."
Owner chose approach A: test a short rule on history first, and only build it into the live
system if it passes. This doc covers step 1 (the replay) and is its pre-registration. Step 2
(live wiring) gets its own design after the verdict.

## Intent and why

- On 2026-11-20 SPY closed below its SMA200 (703 vs 730). The market gate now allows 0 new longs.
- The owner's hypothesis: in a below-trend market, the mirror of the long sweep (shorting a
  failed push above resistance) should work.
- Prior evidence (memory `nexmind-regime-side-is-beta`):
  - Shorts taken while SPY was above its SMA200 lost money, and so did random shorts.
  - Below-trend shorts were never measured on their own.
  - In 2022-23 the bounces looked shortable.
- The long sweep itself was REJECTED on its 3-year replay (`docs/quant/2026-11-03-sweep-v1-replay.md`).
- So the short rule must clear the same bar before any money rides on it.
- Broker for shorts: Pi Securities (owner, 2026-11-22). Shortable list and borrow fee are unknown and
  are asked before step 2.

## Goals, non-goals and anti-goals

- **Goal:** one pre-registered verdict, PASS or REJECT, for a mirrored short-sweep rule on below-trend
  sessions, judged against random shorts. Results doc in `docs/quant/`.
- **Non-goals:**
  - Any live change. That means no change to the chart agent, `/advisor`, `/scan`, the scorecard
    forward test, Discord, or `sweep-v1`.
  - Any new UI.
- **Anti-goals:**
  - Tuning the rule after seeing results. The parameters below are fixed now, and a rerun with
    changed parameters is a new, separately labelled test.
  - Quoting trade counts as if they were independent evidence. Below-trend periods are a handful of
    episodes.

## Approaches (picked: A)

- **A. Replay first, then live (picked).** The verdict takes hours and puts no money at risk. A pass
  feeds straight into step 2.
- **B. Live first, and let the forward scorecard judge.** It needs months to reach 300 setups, the
  regime may flip first, and an unproven rule meanwhile.
- **C. Replay only.** Same as A, but nothing follows on a pass.

## The rule (`sweep-short-v1`): an exact mirror of `findSetup` in `src/lib/chartAgent/setup.ts`

- **Sweep levels:** PDH, PMH, pVAH.
- **Target levels:** dPOC, pPOC, pVAL, PDL, PML, below the entry.
  - Merged with the same `CHART_LEVEL_MERGE_ATR`.
  - A group is priced at the highest of its members, the nearest to the entry.
- **Steps, in the same order with mirrored conditions:**
  1. There are bars, and the ATR is valid.
  2. Find the most recent bar where all of these hold: `o < L`, `h > L`, `c < L`, and the latest
     close `< L`.
  3. `stop = sweepBar.h + CHART_STOP_BUFFER_ATR × atrDaily` and `entry = last.c`.
  4. No later close is above `sweepBar.h`.
  5. There are targets below the entry.
  6. No later bar's low has reached the first target.
  7. `r = (entry − target) / (stop − entry)`, with the tag "first target under 1.5R" when T1 < `CHART_MIN_T1_R`.
- All constants are the live ones, with no new parameters.
- The long `findSetup` stays byte-identical. The short rule is a new function beside it.

## Regime filter

- A session is replayed only if SPY's previous session close is below SPY's SMA200 as of that
  previous session.
- Same definition as `gateSlots`. Using the previous session keeps today's close out of the decision.

## Replay mechanics: reuse the long replay harness (`src/lib/scorecard/replay*.ts`)

- **Ranking:** the same direction-neutral live-scan stand-in (`replayRank.ts`: absolute gap, rvol,
  floors) and the top `CHART_TOP_N` at 10:30 ET.
- **Universe:** `UNIVERSES.sp500Current` (501 names). It has survivorship bias, which favours longs and
  hurts shorts, so it is conservative for this test. The results doc states this.
- **Period:** every below-trend session from the start of Alpaca 5-minute history (2016) to the last
  complete session before the run.
  - Only the below-trend windows (plus the lookback each one needs) are fetched.
  - Expected episodes: late 2018, 2020, 2022, spring 2025, and Nov 2026.
- **Scoring:** a short mirror of `scoreSetup`. `fill` is the open of the first bar after the run time.
  - Hold variant: the stop is hit when high ≥ stop, and T1 is hit when low ≤ T1.
  - A bar that touches both counts as the stop.
  - A gap through either level fills at the open.
  - There is a 10-session cap with an exit at the last close.
  - A same-day variant is reported as info.
  - Short R with the same cost model, mirrored: the entry is sold lower by slippage, the exit is
    bought higher, and commission applies.
  - No borrow fee is modelled. That is a few bps over 10 sessions for S&P names, and the doc says so.
- **Control:** random short entries drawn the way `controlDistribution` draws long ones, mirrored. Same
  tickers and same sessions, 200 runs, with the median and p95.

## Verdict (pre-registered)

- **PASS** if and only if the hold-variant mean R is above the control's p95 AND at least 100 trades
  closed. Otherwise **REJECT**. "Too few trades" is a REJECT that says so.
- **Also reported, without changing the verdict:**
  - the per-episode mean R and n
  - the same-day variant
  - win %
  - the long sweep (`sweep-v1`) on the same below-trend sessions, which tests the owner's premise
    that longs fail there

## Outputs

- `docs/quant/<run date>-sweep-short-replay.md`, holding the verdict, the numbers above, the biases,
  and the command used.
- Bars are cached under `.cache/scorecard/` as the long replay does. There are no DB writes, or only a
  `ScorecardSnapshot` of kind `"replay-short"` if the builder finds that simpler. No ChartSetup rows.

## Calls settled after the builder check (Claude's calls, owner to check)

1. **Selection vs scoring window:**
   - Setups are taken only on below-trend sessions.
   - Bars are fetched and trades scored over contiguous sessions, so a short opened late in an episode
     runs its 10 sessions into whatever regime follows.
   - The tail exclusion applies only at the global end.
2. **Incomplete trades:**
   - A trade whose 10-session window is not complete by the last complete session is dropped, as in the
     long replay.
   - So the Nov 2026 episode contributes about nothing. The doc says so.
3. **Regime test:**
   - A session counts as below-trend when it is NOT `close > SMA200`, the same comparison `gateSlots`
     uses, taken on adjusted SPY daily bars as of the previous session.
   - A session where the gate would read BLIND (too few bars, or more than 50% from the SMA) is skipped.
   - SPY daily history starts early enough (2015) to give SMA200 on the first 2016 session.
   - The breakdown table is per calendar year, which needs no episode definition.
4. **Control and label:**
   - The control mirrors the long replay's control exactly: one random short per setup on its run
     day, 200 runs.
   - REJECT is REJECT whatever the sign of the mean. The doc reports the mean beside it.
5. **Frictions:**
   - The same slippage and commission model, mirrored.
   - No borrow fee, short-sale restriction, or dividend-owed cost is modelled. That makes the result
     slightly optimistic for shorts, and the results doc says so.
6. **Ranking:**
   - The same direction-neutral live-scan stand-in, with no gap-direction filter. That adds no new
     parameter and matches what the live scan would feed the chart agent.
7. **Label:** the summary carries `ruleVersion: "sweep-short-v1"`. The live `CHART_RULE_VERSION` is not
   bumped.

## Left to the builder

- Where the short mirror lives: a `side` parameter on shared helpers, or separate functions. The long
  path's behaviour and tests must stay unchanged.
- Fetch batching for 2016-2023.
- Tests:
  - each mirrored step, including the edge cases the long tests cover
  - the regime filter's use of the previous session
  - short scoring for stop, T1, gap, both-touched and time
  - control symmetry
