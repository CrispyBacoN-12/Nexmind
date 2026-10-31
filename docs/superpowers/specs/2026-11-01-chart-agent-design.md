# Chart agent (agent #2): design

**Date:** 2026-11-01 · **Status:** approved in conversation by the owner, awaiting written-spec review
**Owner's words are marked (owner). Everything else is the designer's call and is marked (call).**

## 1. Intent

Agent #1 (`/scan`, shipped 2026-10-31) returns *dozens* of S&P 500 names with something happening
today. The owner narrows a list like that by **looking at the chart first, then volume profile and
liquidity sweeps** (owner). Agent #2 does that reading for them and returns **a full long setup —
entry, stop, targets — for at most a few names** (owner chose "ค", full setup; "long only").

It runs **on the button press**, not on a schedule: press "สแกนตอนนี้", agent #1 scans, agent #2
reads the charts, and **a panel pops up** with the setups (owner chose option 1 over intraday alerts).
The owner then sends one to `/advisor` and places the order by hand on Webull.

Nothing in this project has ever beaten a random entry (docs/STATE.md §3). The sweep rule below has
**never been backtested** on stocks. Its nearest relative — xau-vp-v1's "sweep + VP" entry on gold
H1 (2026-10-30) — lost money in every fold. The panel must say so, and every setup is logged (§8) so that "is the
chart agent any good" becomes a measurement instead of a belief.

## 2. Goals

1. After every scan, the 20 highest-activity rows are read on a **5-minute chart** (owner chose "ก").
2. A panel pops up with **0 to 5 long setups**. "วันนี้ไม่มี setup" is a valid, expected answer (call).
3. Each setup shows a 5-minute chart with every level drawn and the sweep bar marked, the entry, the
   stop, two targets with their R, a Thai chart reading by the AI, and a "→ Advisor" button.
4. `/advisor` accepts the setup's stop and sizes from it instead of 1.5×ATR (owner chose "ก").
5. Every setup the code finds — shown, AI-rejected, or cut by the 5 cap — is written to the database.

## 3. Non-goals

- Shorts (owner: long only). Intraday alerts / background watching (owner: option 1 first).
- Sending the chart image to the AI. v1 sends numbers only (call: §6).
- Scoring logged setups against outcomes. v1 only logs; scoring is a later spec (call).
- Fractional-share sizing in `/advisor` (still the open follow-up from the scan spec).
- Placing orders. The owner places every order.

## 4. Data

- **Bars (call):** Alpaca `fetchAlpacaCandlesBatch(tickers, "5d", "5m")` on the **SIP** feed — the
  consolidated tape, so the volume profile reflects all venues. SIP is served ≥15 minutes delayed on
  the free plan (`endTime()` in `src/lib/alpaca.ts` already clamps for this). Alpaca 5-minute bars
  include pre- and post-market prints; the implementation must verify that once against a live
  response and split by time, never by assuming.
- **Daily ATR14 (call):** from `fetchAlpacaCandlesBatch(tickers, "1mo", "1d")`, reusing
  `src/lib/indicators`. Used only for the stop buffer and level dedupe.
- TradingView is not used here: its screener endpoint serves no bars.
- **Session split (call):** bar times converted to America/New_York. Pre-market 04:00–09:30, regular
  09:30–16:00. "Previous session" = the latest ET date *before today* that has regular-session bars,
  read from the bars themselves — so weekends and holidays need no calendar.
- A ticker with no previous session, or no regular-session bar today, yields no setup and a reason.

## 5. Levels and the setup rule (code, deterministic, unit-tested)

All of this is pure code in `src/lib/chartAgent/`. The AI never measures a level.

**Volume profile (call).** The repo's existing `volumeProfile` in `src/lib/indicators.ts` (the
one xau-vp-v1 used), called over the whole bar set with **50 bins** and a **70%** value area: equal
price bins spanning [min low, max high]; each bar's volume spread evenly across the bins its
[low, high] touches; **POC** = highest-volume bin; the value area grows from POC toward whichever
adjacent bin has more volume (ties go up) until ≥70%. POC, VAH and VAL are **bin midpoints**, as
that function returns them.

**Levels per ticker:**
| name | source |
|---|---|
| `pPOC`, `pVAH`, `pVAL` | profile of the previous session's regular-session bars |
| `PDH`, `PDL` | previous session regular-session high / low |
| `PMH`, `PML` | today's pre-market high / low (absent if no pre-market bars) |
| `dPOC` | developing profile of today's regular-session bars so far (drawn, used as a target) |

**Sweep (owner-approved definition).** A regular-session bar today whose **low trades below** a
sweep level `L ∈ {PDL, PML, pVAL}` and whose **close is back above** `L`, with the **latest close
still above** `L`. If several bars qualify, the most recent one is used; if one bar sweeps several
levels, the setup names all of them.

**Setup (call).**
- **Entry** = latest close (the 15-minute-delayed price; the panel says so).
- **Stop** = sweep bar's low − 0.1 × daily ATR14.
- **Invalid** if any bar after the sweep bar closed below the sweep bar's low (already stopped out).
- **Targets:** candidate levels above entry from {`dPOC`, `pPOC`, `pVAH`, `PDH`, `PMH`}, merged when
  within 0.1 × ATR of each other. **T1** = nearest, **T2** = next. No level above entry → no setup
  ("ไม่มีระดับเหนือราคา").
- **R** = (T − entry) / (entry − stop), for T1 and T2. **T1 < 1.5R** → tag "เป้าแรกไม่ถึง 1.5R".
- **Already at T1** (latest high today ≥ T1 after the sweep) → no setup ("ถึงเป้าแรกไปแล้ว").

**Order and cap (call).** Setups keep the scan's activity order (it ranks activity, not odds, and
re-ranking by setup quality would imply an edge we have not measured). The AI's survivors are shown,
at most 5; the rest are logged as `capped`.

**Market phase (call).** Setups are produced only while the regular session is open
(`marketPhase` in `src/lib/scanAgent/session.ts`) and at least one delayed regular-session bar exists.
Otherwise the panel shows "ยังไม่มีแท่งในเวลาทำการ" (pre-market) or "ตลาดปิดแล้ว" (after close) and
no setups.

## 6. The AI's job

One call per run (call: sonnet; up to 20 candidate setups is small). Input per setup: ticker, the
level table, the sweep (which level, bar time, bar OHLC), entry/stop/T1/T2/R, and a compact summary
of today's 5-minute bars (call: last 24 bars as OHLCV rows). Output, JSON per ticker:

- `keep`: boolean — the AI may reject a setup whose structure it reads as poor; **every rejection
  carries a Thai reason**.
- `reading`: 2–3 Thai lines describing the structure as a trader would ("sweep PDL 142.10 แล้วกลับ
  ขึ้นมายืนเหนือ VAL ตอนนี้ทดสอบ POC").

The AI **cannot change any number**. Its reply is checked: a reading containing a prediction or a
certainty claim (call: reuse `isDirectional` plus a chart-agent phrase list — "จะขึ้น", "แน่นอน",
"โอกาสสูง", "การันตี", …) is dropped and the setup shows "ตัดออก: มีคำทำนาย". Describing the long
setup itself is allowed — that is the product. Failures follow the scan's rules: model prose and
parse errors are never shown verbatim (`safeFailureReason`).

**No image in v1 (call).** The local backend is the Claude CLI (`callAgentJSON` in
`src/lib/anthropic.ts`), which does not take an image cleanly; and numbers keep the AI from
misreading a level off a picture. Images are a v2 question.

**AI unavailable** (CLI logged out, or Vercel with no backend): every code setup is shown (still ≤5),
each marked "AI ไม่ได้อ่าน", and nothing is AI-rejected.

## 7. Surfaces

- **API (call):** `POST /api/chart-agent`, body `{ tickers: string[] }` (≤20, validated with the
  scan's ticker format), returns `ChartAgentResult`. Called by the scan panel right after a successful
  scan, so the scan's own route and timing are untouched. `maxDuration` 300.
- **Panel (call):** a modal over `/scan` that opens when the chart agent returns. Header: data time
  (Bangkok), phase, "แท่งช้า 15 นาที", the no-backtest line. Body: one card per setup — 5-minute chart
  (recharts, like `advisor-chart.tsx`) with level lines and a sweep-bar marker, the entry/stop/T1/T2
  table with R, tags, the AI reading, "→ Advisor". Footer: collapsed "AI ตัดออก" list with reasons,
  and the per-ticker "ไม่มี setup" reasons. Closable; a button on `/scan` reopens it.
- **`/advisor` (call):** `?ticker=X&entry=Y&stop=Z`. `AdvisorInput` gains `stopOverride`. Valid when
  `0 < stop < entry`: `slDistance = entry − stop`, card shows "stop จากกราฟ (k×ATR)". Base rate is
  computed with `slMult = slDistance / ATR` so its table matches the card. An invalid stop is ignored
  with a warning. No stop given → 1.5×ATR as today.

## 8. Logging

New Prisma model `ChartSetup` (call): `id`, `createdAt`, `runId`, `ticker`, `status`
(`shown` | `ai_rejected` | `guard_stripped` | `capped`), `dataAsOf`, `entry`, `stop`, `t1`, `t2`,
`r1`, `r2`, `sweptLevels` (string[]), `sweepBarAt`, `levels` (Json), `aiReading`, `aiRejectReason`,
`aiBackend`. Written with `npm run db:push`. A logging failure is reported on the panel and never
blocks it. These rows are what a later scoring spec will grade (T1-before-stop rate vs a random-entry
control).

## 9. Failure handling

- Alpaca missing keys / down → panel says "ไม่มีข้อมูลแท่ง 5 นาที", scan results unaffected.
- A ticker missing from the Alpaca response → listed with "ไม่มีแท่งของตัวนี้".
- The chart agent never throws to the page; `ok:false` only when no ticker could be read.

## 10. Testing

Pure modules get node:test unit tests: profile (POC/VA on hand-built bars, ties), session split
(ET conversion, previous-session pick across a weekend), levels, sweep detection (qualifies / wick
only / closed back below / latest below), setup (stop buffer, invalidation, target merge, T1 < 1.5R,
already-at-T1, no level above), AI output normalisation + guard, advisor `stopOverride` (valid,
invalid, base-rate multiple). Route and UI are verified live, per project convention.

## 11. Open questions

None blocking. Recorded for later: scoring spec; v2 image input; whether to show setups after close
as a review view.
