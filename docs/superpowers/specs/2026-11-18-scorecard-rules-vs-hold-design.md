# Scorecard: rules vs buy-and-hold chart — design

Approved by the owner 2026-11-18 ("A", then "ok"). Small change.

## Intent

The owner asked for a second chart on `/scorecard` comparing the AI picks against "buy and never sell".
They chose interpretation A: the **same** AI-kept setups, bought at the same fill, held forever with no stop,
no T1, no 10-session cap. The question it answers: do the exit rules (stop / T1 / 10 sessions) add or
remove R compared with simply holding?

## Goals / non-goals / anti-goals

- Goal: one new chart, two lines, same unit (R), daily, on the scorecard page.
- Non-goal: any pass/fail, any change to the 300-row verdict, the random control, the existing
  cumulative chart, or Discord.
- Anti-goal: an unfair comparison. Holding never closes, so a line of closed trades only against a line of
  marked positions would mislead; both lines are marked to market daily.

## Approaches

1. **Compute in the nightly scorer, store in the live snapshot, the page only draws (picked).** Matches how
   every other number on the page is produced; one bounded Alpaca fetch per night.
2. Compute on page load (fetch Alpaca from Vercel at render): slow, and the page fetches no market data
   today. Rejected.
3. Store daily marks per setup in a new table: more schema for an info-only chart. Rejected.

## Design

- **Population (my call):** rows whose AI group is "kept" (the stats groups kept and afterVerdict), with a
  hold-outcome fill (`fill !== null`). Vetoed/stripped/unread and pending rows are excluded.
- **Prices:** Alpaca daily bars (`fetchAlpacaRange(..., "1d")`) for those tickers, from the earliest fill's
  ET date to the scorer's cutoff. A day a ticker has no bar uses its last known close (forward fill); a
  ticker with no daily bar at or after its fill date is left out of both lines until it has one.
- **Calendar:** the ET dates on which SPY has a daily bar in that range (SPY rides along in the fetch);
  first point = the earliest fill date.
- **Per date d, per setup with fill date <= d:**
  - hold R = `rMultiple(fill, close_d, stop)` (same cost model as the scorecard).
  - rules R = the hold-outcome R if the trade closed on or before d (exit ET date <= d), else
    `rMultiple(fill, close_d, stop)`.
  - The fill date's own close is used for the fill date (intraday fills are marked at that day's close).
- **Series:** `rulesVsHold: { date: string; rules: number; hold: number; n: number }[]` on `LiveSnapshot`
  (sums of R over setups filled by d; `n` = how many). Optional in the page guard, so older snapshots render.
- **Failure:** if the daily fetch fails, the scorer logs it and stores `rulesVsHold: []`; the summary,
  outcomes and verdict are unaffected (my call: an info chart must not block the scorer).
- **Page:** a new card "ตามกฎ vs ซื้อแล้วถือ (R)" under the existing cumulative chart: two lines (ตามกฎ,
  ซื้อแล้วถือ), recharts like `cumulative-chart.tsx`, a note that both are marked at each day's close, AI-kept
  only, info only, and n. Empty state when the series is empty.

## Left to the builder

Pure computation in `src/lib/scorecard/` with tests (forward fill, closed-vs-open marking, fill-date marking,
missing ticker); the scorer and page stay thin.
