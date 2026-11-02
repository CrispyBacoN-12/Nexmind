# Scorecard Agent (Agent #4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score the chart agent's long-sweep setups as if every one were bought. There are two parts:
- a one-off 3-year replay of the code rule
- a forward record built by a daily scheduled run plus a nightly scorer

Both are judged against random entries, and the results appear on `/scorecard` and in a morning Discord
message.

**Architecture:**
- **`src/lib/scorecard/`** holds pure modules: scoring one setup, the random-entry control, groups and
  verdicts, replay ranking, and the Discord text.
- **Orchestrators.** Three of them, one per job: the daily run, the nightly scorer and the replay. All I/O
  is injected, in the same shape as `runChartAgent` / `runRiskSentry`.
- **Entry points.** Thin scripts under `scripts/` (run by Task Scheduler through ASCII `.cmd` wrappers)
  wire in Alpaca, Prisma, the Claude CLI and Discord.
- **Page.** A read-only `/scorecard` page renders stored snapshots. It never fetches bars or calls the AI.

**Tech Stack:** TypeScript, Next.js 16 (app router; read `node_modules/next/dist/docs/` before app code),
Prisma 7 + Neon (`prisma db push`, no migrations folder), node:test via `npm test` (`tsx --test
"src/**/*.test.ts"`), recharts, Alpaca SIP bars.

**Spec:** `docs/superpowers/specs/2026-11-03-scorecard-agent-design.md`. It is approved and is the
authority. Read §5 to §9 before any task.

## Global Constraints

- **No edge claim, anywhere.** Page copy and Discord text never say the picks work, until a verdict passes
  (spec §3).
- **Frozen while counting.** `sweep-v1` and `REVIEW_SYSTEM` stay frozen. Never pool rows across
  `ruleVersion`.
- **Only scheduled rows count.** Only `ChartSetup.source = "scheduled"` rows of the current
  `CHART_RULE_VERSION` are scored. Button rows (`"button"`, the column default) are ignored.
- **Costs.** Use `RESEARCH_COST_MODEL` from `src/lib/research/runResearch.ts`: 5 bps slippage on every fill
  and 1 bp round-turn commission on entry notional.
- **Control.** Use `CONTROL_RUNS` (200) and `PANEL_SEED` from `src/lib/research/panelRun.ts`, and
  `mulberry32`, `summarizeControl` and `percentile` from `src/lib/research/control.ts`.
- **Never read a forming bar.** `cutoffSec = floor((now - SIP_DELAY_MS)/1000)`, and a bar is finished when
  `t + CHART_BAR_SECONDS <= cutoffSec`.
- **Regular session.** ET minutes in [570, 960) per `etClock`.
- **Prisma changes are additive only.** `npm run db:push` hits the LIVE Neon DB, so the controller runs it
  once (Task 1), never a subagent.
- **Tests stub all I/O.** No test touches Prisma, Alpaca, the CLI or Discord.
- **`vercel.json` keeps `crons: []`.** Do not re-enable the desk's Task Scheduler jobs. Never commit
  `obsidian-vault/`.
- **`scripts/*.cmd` are ASCII-only.** They start with `node --env-file=.env --import tsx`, as
  `scripts/risk-sentry.cmd` does.
- **Thai UI copy.** Never echo `.env` values.
- **Spec constants**, in `src/lib/scorecard/types.ts`:
  - `SCORECARD_RUN_ET_MINUTES = 630` (10:30 ET)
  - `SCORECARD_RUN_WINDOW_MINUTES = 60`
  - `SCORECARD_MAX_HOLD_SESSIONS = 10`
  - `SCORECARD_VERDICT_N = 300`
  - `SCORECARD_MIN_N = 30`
  - `SCORECARD_CONTROL_LAST_ENTRY_ET_MINUTES = 930` (15:30 ET)
  - `SCORECARD_NO_DATA_DAYS = 15`

## Review Focus

1. **US holiday on a weekday.** Job 1 records `no_session` (not `failed`, not missed). The scorer's
   10-session count skips the holiday because it counts sessions that have regular bars, not weekdays.
   *Pinned in Task 2 and Task 5.*
2. **Job 1 fires twice, or outside 10:30-11:29 ET** (the 21:30 and 22:30 ICT triggers across DST).
   - Outside the window it does nothing and writes no run row.
   - A second firing in the window, after a `ran`/`no_session`, does nothing.
   - The scorer re-run upserts, so there are no duplicate outcomes. *Pinned in Task 5 and Task 6.*
3. **The AI was down for the run.** Rows have a null `aiReading` and are grouped `unread`, never `kept`,
   so they never count toward 300. Discord says the AI was down. *Pinned in Task 3 and Task 6.*
4. **A setup whose ticker returns no bars after the run** (halt, symbol change). It stays `open`, never
   gets a fabricated exit, and becomes `no_data` once its run date is `SCORECARD_NO_DATA_DAYS` calendar
   days old. *Pinned in Task 6.*
5. **No fill bar.** If the run happened after the last regular bar of its day, or the first open at or
   after the run is already ≤ stop or ≥ T1, the setup is `not_filled`. It is excluded from every mean and
   counted on the page. *Pinned in Task 2.*

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `prisma/schema.prisma` | `ChartSetup.source`, `ChartSetup.aiModel`; new `ScorecardRun`, `ScorecardOutcome`, `ScorecardSnapshot` | 1 |
| `src/lib/anthropic.ts` | `AgentResult.resolvedModel` from the CLI's `modelUsage` / API `model` | 1 |
| `src/lib/chartAgent/review.ts`, `logRows.ts`, `runChartAgent.ts` | carry `model` through to `ChartSetupRow.aiModel`; export `dailyAtr` | 1 |
| `src/lib/scorecard/types.ts` | constants + shared types | 2 |
| `src/lib/scorecard/score.ts` | `scoreSetup` (one setup, one exit variant) | 2 |
| `src/lib/scorecard/control.ts` | `controlDistribution` (random entries) | 3 |
| `src/lib/scorecard/groups.ts` | `groupOf`, `summarize`, `aiVerdictSample`, `beatsControl` | 3 |
| `src/lib/scorecard/replayRank.ts` | `replayRow`, `pickTopN` (historical scan ranking) | 4 |
| `src/lib/scorecard/replay.ts` | `runReplay` orchestrator (3 passes, injected bar loaders) | 4 |
| `src/lib/alpaca.ts` | `fetchAlpacaRange(symbols, startIso, endIso, interval)` | 4 |
| `scripts/scorecard-replay.mts` | one-off replay runner with the `.cache/scorecard/` disk cache | 4 |
| `src/lib/scorecard/runDaily.ts` | `runScorecardDaily` (job 1) | 5 |
| `scripts/scorecard-run.mts`, `.cmd` | job 1 entry | 5 |
| `src/lib/scorecard/nightly.ts`, `discord.ts` | `runScorecardNightly`, `buildDiscordMessage` (job 2) | 6 |
| `scripts/scorecard-score.mts`, `.cmd` | job 2 entry | 6 |
| `src/app/scorecard/*`, `src/components/sidebar.tsx` | page, layout A | 7 |
| `docs/quant/…-sweep-v1-replay.md`, `docs/STATE.md`, Task Scheduler | run the replay, register tasks, docs | 8 |

---

### Task 1: Plumbing — schema, model id, source tag

**Files:**
- Modify: `prisma/schema.prisma` (model `ChartSetup` at about line 401, plus three new models)
- Modify: `src/lib/anthropic.ts` (`AgentResult`, the CLI return at about line 336, the API return)
- Modify: `src/lib/chartAgent/review.ts` (`reviewSetups` return)
- Modify: `src/lib/chartAgent/logRows.ts` (`ChartSetupRow`, `toLogRows`)
- Modify: `src/lib/chartAgent/runChartAgent.ts` (pass the model to `toLogRows`; export `dailyAtr`)
- Test: `src/lib/chartAgent/logRows.test.ts`, `src/lib/chartAgent/runChartAgent.test.ts`, and an existing or
  new anthropic parse test

**Interfaces:**
- Produces:
  - `AgentResult.resolvedModel: string | null`
  - `reviewSetups(...) → { reviews, backend, note, model: string | null }`
  - `toLogRows(runId, decided, backend, model: string | null): ChartSetupRow[]`, where `ChartSetupRow` gains
    `aiModel: string | null`
  - `export function dailyAtr(daily: Candle[] | undefined, today: string): number`
  - `ChartAgentResult`'s ok branch gains `model: string | null` (the review's resolved model, or `null`
    when no AI call happened)
  - Prisma models (below).
- `ChartDeps.review` keeps type `typeof reviewSetups`.
- The `/api/chart-agent` route is NOT edited. Its rows take `source` from the DB default `"button"`.

Prisma, additive:
```prisma
// on ChartSetup:
  /// "button" (POST /api/chart-agent) or "scheduled" (scripts/scorecard-run.mts). Only scheduled rows are scored.
  source         String   @default("button")
  /// Resolved model id behind the review call (e.g. claude-sonnet-…); null when unknown or no AI call.
  aiModel        String?
  @@index([source, ruleVersion])

model ScorecardRun {
  id          Int      @id @default(autoincrement())
  sessionDate String   /// ET date the run was for
  runId       String?  /// ChartSetup.runId of this run's rows
  ranAt       DateTime @default(now())
  status      String   /// ran | no_session | failed
  setups      Int      @default(0)
  kept        Int      @default(0)
  vetoed      Int      @default(0)
  stripped    Int      @default(0)
  unread      Int      @default(0)
  aiBackend   String?
  aiModel     String?
  error       String?
  @@index([sessionDate])
}

model ScorecardOutcome {
  id           Int      @id @default(autoincrement())
  chartSetupId Int
  variant      String   /// hold | sameDay
  status       String   /// open | closed | not_filled | no_data
  fillAt       DateTime?
  fill         Float?
  exitAt       DateTime?
  exitPrice    Float?
  exitReason   String?  /// stop | t1 | time
  r            Float?
  sessionsHeld Int      @default(0)
  updatedAt    DateTime @updatedAt
  @@unique([chartSetupId, variant])
}

model ScorecardSnapshot {
  id          Int      @id @default(autoincrement())
  kind        String   /// replay | live | ai-verdict
  ruleVersion String
  computedAt  DateTime @default(now())
  data        Json
  @@unique([kind, ruleVersion])
}
```

- [ ] **Step 1: Write failing tests**
  - `logRows.test.ts` "carries the review model into aiModel": `toLogRows("r1", [decided], "cli", "claude-sonnet-x")[0].aiModel === "claude-sonnet-x"`, and `toLogRows(..., null)[0].aiModel === null`.
  - `runChartAgent.test.ts` "logs the review's model on every row": a stub `review` returns `model: "m-1"`, and every row passed to `log` has `aiModel === "m-1"`.
  - anthropic: "resolvedModel reads the first key of the CLI result's modelUsage". Parse a CLI JSON body
    `{ result:"x", is_error:false, modelUsage:{ "claude-sonnet-4-x":{…} } }` and get
    `"claude-sonnet-4-x"`. A body without `modelUsage` gives `null`. Extract the parse into an exported pure
    helper `cliResolvedModel(parsed: unknown): string | null`.
- [ ] **Step 2:** Run `npm test`. The new tests should FAIL.
- [ ] **Step 3: Implement.**
  - The API path sets `resolvedModel` from the SDK response's `model` field.
  - `reviewSetups` returns `model: r.resolvedModel ?? null` on success and `null` on mock or failure.
  - `runChartAgent` passes the review's `model` into `toLogRows`.
  - Fix every other `AgentResult` construction site so tsc passes.
- [ ] **Step 4:** Run `npx tsc --noEmit` and `npm test`. Both should be clean or all PASS.
- [ ] **Step 5: (controller, not a subagent)** Run `npm run db:push`. It must report only added
  columns and tables. Then `npm run db:generate`, and restart any running dev server.
- [ ] **Step 6:** Commit with message `feat(scorecard): source/aiModel on ChartSetup, scorecard tables, resolved model id`.

### Task 2: `scoreSetup` — one setup, one exit

**Files:**
- Create: `src/lib/scorecard/types.ts`, `src/lib/scorecard/score.ts`
- Test: `src/lib/scorecard/score.test.ts`

**Interfaces:**
- Produces (types.ts):
  - the constants listed in Global Constraints
  - `export const SCORECARD_SOURCE = "scheduled"`
  - `ExitVariant = "hold" | "sameDay"`
  - `OutcomeStatus = "open" | "closed" | "not_filled" | "no_data"`
  - `ExitReason = "stop" | "t1" | "time"`
  - ```ts
    interface Outcome { status: OutcomeStatus; fillAt: number | null; fill: number | null;
      exitAt: number | null; exitPrice: number | null; exitReason: ExitReason | null;
      r: number | null; sessionsHeld: number }
    ```
  - All times are epoch seconds. `fill` is the raw bar open before slippage.
- Produces (score.ts):
  `scoreSetup(input: { runAtSec: number; stop: number; t1: number; bars: Candle[]; cutoffSec: number; variant: ExitVariant; costs?: CostModel }): Outcome`.
  `bars` may include extended hours and other days; only finished regular bars are read. The default
  `costs` is `RESEARCH_COST_MODEL`.

**Rules (spec §5), with this exact cost formula:**
- `s = slippageBps/1e4`, `c = commissionBps/1e4`
- `entryPx = fill*(1+s)`, `exitPx = exit*(1-s)`, `risk = entryPx - stop`
- `R = (exitPx - entryPx - c*entryPx) / risk`

**How the walk works:**
- **Fill.** The fill bar is the first finished regular bar on the run's ET date whose `t >= runAtSec`.
  - If none exists and that day's session is complete (cutoff ≥ that date's 16:00 ET close), the setup is
    `not_filled`. Use `etSessionCloseMs`.
  - If none exists and the day is not complete, the setup is `open` with nulls.
  - If the fill bar's open is ≤ stop or ≥ t1, the setup is `not_filled`.
- **Walk.** Start at the fill bar itself. Its low and high count.
- **Same bar.** If one bar touches both, that is a stop at the stop price.
- **Session opens.** A session's first regular bar that opens ≤ stop exits at that open. One that opens
  ≥ t1 exits at that open.
- **Sessions.** `sessionsHeld` counts distinct ET dates of regular bars walked, with the entry day = 1.
- **Hold cap.**
  - `hold`: if the 10th session completes with no hit, exit `"time"` at that session's last regular close.
  - Fewer than 10 complete sessions and no hit means `open`.
- **`sameDay`:** the same walk limited to the entry date. It is `"time"` at the entry day's last regular
  close once that day is complete; otherwise `open`.

- [ ] **Step 1: Write failing tests** in `score.test.ts`. Build bars with a helper `bar(etDate, "HH:MM", o,h,l,c)` → Candle (ET→epoch). Use stop 99, t1 102, runAt = 10:30 ET on 2026-11-02. The cases:
  - "T1 hit": fill bar 10:30 opens 100, a later bar's high is 102.2. Expect `status "closed"`,
    `exitReason "t1"`, `exitPrice 102`, `r ≈ 1.799043` (±1e-6).
  - "stop hit": a later bar's low is 98.9. Expect `exitReason "stop"`, `r ≈ -1.056671`.
  - "same bar touches both counts as stop": one bar with h 102.5 and l 98.5. Expect `exitReason "stop"`.
  - "gap below the stop exits at the open": day 2's first regular bar opens 98. Expect `exitPrice 98`,
    `r ≈ -2.008576`, `sessionsHeld 2`.
  - "not filled when the first open is under the stop": the 10:30 bar opens 98.9. Expect `not_filled`.
  - "not filled when the first open is at or above T1": it opens 102. Expect `not_filled`.
  - "not filled when no regular bar starts after the run on a finished day": runAt is 15:58 and the cutoff
    is the next day. Expect `not_filled`.
  - "open while the run day has no fill bar yet": the cutoff is 10:31 ET. Expect `open`.
  - "hold exits on time at the 10th session's close": 10 sessions with no hit. Expect `exitReason "time"`,
    `sessionsHeld 10`, `exitPrice` = the last regular close of session 10.
  - "holiday is not a session" (Review Focus 1): the dates skip a weekday with no bars, and the 10th
    session is the 11th weekday.
  - "hold stays open with 9 complete sessions": expect `open`, `r null`.
  - "sameDay closes at the entry day's close": expect `exitReason "time"`, `sessionsHeld 1`.
  - "forming bars are ignored": a bar with `t + 300 > cutoffSec` and a low under the stop does not exit.
  - "extended-hours bars are ignored": a 17:00 ET bar under the stop does not exit.
- [ ] **Step 2:** Run `npm test`. The new tests should FAIL.
- [ ] **Step 3:** Implement `types.ts` and `scoreSetup`.
- [ ] **Step 4:** Run `npm test`. All should PASS.
- [ ] **Step 5:** Commit with message `feat(scorecard): score one setup under hold and same-day exits`.

### Task 3: Control, groups, verdicts

**Files:**
- Create: `src/lib/scorecard/control.ts`, `src/lib/scorecard/groups.ts`
- Test: `src/lib/scorecard/control.test.ts`, `src/lib/scorecard/groups.test.ts`

**Interfaces:**
- Consumes: `scoreSetup`, `Outcome`, `ExitVariant` (Task 2).
- Produces:
  - ```ts
    interface ControlTrade { runAtSec: number; fill: number; stop: number; t1: number; bars: Candle[]; cutoffSec: number }
    ```
    One per filled setup.
  - `controlDistribution(trades: ControlTrade[], variant: ExitVariant, runs = CONTROL_RUNS, seed = PANEL_SEED): ControlDistribution | null`
  - `type Group = "kept" | "vetoed" | "stripped" | "unread"`
  - `groupOf(row: { status: string; aiReading: string | null }): Group`
  - ```ts
    interface GroupStats { n: number; meanR: number | null; winPct: number | null; t1Pct: number | null }
    ```
  - `summarize(outcomes: Outcome[]): GroupStats`
  - `aiVerdictSample<T extends { createdAt: Date; group: Group; hold: Outcome; windowElapsed: boolean }>(rows: T[]): { sample: T[]; ready: boolean }`
  - `beatsControl(meanR: number, control: ControlDistribution): boolean`

**Rules:**
- **Control.** Each run, for each trade:
  - Draw a uniformly random finished regular bar on the trade's run date with `t >= runAtSec` and ET minutes
    `< 930`.
  - `dist = fill - stop`; `k = (t1 - fill)/dist`.
  - Score with `scoreSetup({runAtSec: bar.t, stop: e - dist, t1: e + k*dist, …})`, where `e` = that bar's
    open. Use the same variant, bars and cutoff.
  - A trade with no eligible bar, or whose control result is not `closed`, is skipped for that run.
  - A run's value is the mean R of its closed control trades. A run with none is dropped.
  - Use `mulberry32(seed)` once for the whole distribution.
  - Same ticker and day means same ATR, so the price distance equals "the same ATR multiple" (spec §5).
- **Groups.**
  - `ai_rejected` → vetoed. `guard_stripped` → stripped.
  - `shown`/`capped` with `aiReading === null` → unread. Otherwise kept.
- **`summarize`** reads only `closed` outcomes:
  - `winPct = share with r > 0`
  - `t1Pct = share with exitReason "t1"`
  - all are null when n = 0
- **`aiVerdictSample`.**
  - Take kept rows whose hold outcome is not `not_filled` / `no_data`.
  - Sort by `createdAt` ascending and take the first 300.
  - `ready` is true only when there are exactly 300, every one is `closed`, and every one has
    `windowElapsed` (its 10-session window has passed, so no control trade can still be open).
- **`beatsControl`** is strictly `meanR > control.p95`.

- [ ] **Step 1: Write failing tests**
  - control: "is deterministic for a seed". Two calls with the same input are deep-equal.
  - control: "uses the same stop distance and R as the setup". On flat bars that never touch either level,
    every control trade exits `"time"` with R equal to the cost drag. Assert the median ≈
    `scoreSetup` of a flat trade's R.
  - control: "skips trades with no eligible bar". `runAtSec` is 15:31 ET, so there is no bar < 15:30.
    Expect `null` for a single such trade.
  - groups: one row per status mapping, including "shown with null aiReading is unread, never kept" (Review
    Focus 3).
  - groups: `summarize` ignores `open`/`not_filled` and computes winPct/t1Pct on a fixed 4-outcome fixture.
  - groups: `aiVerdictSample` takes the earliest 300 by createdAt from 305 kept rows. It is `ready` false
    when one sample row is open or `windowElapsed` is false, and true when all are closed and elapsed. A
    `not_filled` kept row is skipped and does not count.
  - groups: `beatsControl(0.1, {p95: 0.1, …})` is false (strict).
- [ ] **Step 2:** Run `npm test`. The new tests should FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. All should PASS.
- [ ] **Step 5:** Commit with message `feat(scorecard): random-entry control, groups and the frozen AI verdict sample`.

### Task 4: Replay — ranking, orchestrator, range fetch, script

**Files:**
- Create: `src/lib/scorecard/replayRank.ts`, `src/lib/scorecard/replay.ts`,
  `scripts/scorecard-replay.mts`
- Modify: `src/lib/alpaca.ts` (add `fetchAlpacaRange`)
- Test: `src/lib/scorecard/replayRank.test.ts`, `src/lib/scorecard/replay.test.ts`

**Interfaces:**
- Consumes:
  - `passesBase`, `triggersFor`, `volumeFor`, `activityScore` (`src/lib/scanAgent/filter.ts`)
  - `splitSessions`, `computeLevels`, `findSetup`, `dailyAtr` (Task 1), `CHART_TOP_N`
  - `scoreSetup` (Task 2); `controlDistribution`, `summarize`, `beatsControl` (Task 3)
- Produces:
  - `fetchAlpacaRange(symbols: string[], startIso: string, endIso: string, interval: Interval): Promise<Map<string, Candle[]>>`.
    It uses the same feed, adjustment, pagination, chunking and retry as `fetchAlpacaCandlesBatch`, but an
    explicit start/end.
  - `replayRow(ticker: string, daily: Candle[], intraday: Candle[], sessionDate: string, cutoffSec: number): TvRow | null`
  - `pickTopN(rows: TvRow[], n?: number): string[]`
  - ```ts
    interface ReplayDeps { sessions: string[]; universe: string[];
      loadIntraday(ticker: string): Promise<Candle[]>; loadDaily(ticker: string): Promise<Candle[]> }
    ```
  - `runReplay(deps: ReplayDeps): Promise<ReplaySummary>`. `ReplaySummary` is the `data` stored in
    `ScorecardSnapshot` kind `"replay"`: period, sessions, universe size, setups found, filled,
    not_filled, per-variant `GroupStats`, the control median/p95 for the primary, `pass: boolean`, a
    cumulative-R series (per session, primary), and a fixed `biases: string[]` (survivorship; earnings/8-K
    inputs count 0).

**`replayRow` (spec §7).** For `sessionDate` at cutoff = 10:30 ET − `SIP_DELAY_MS`:
- `close` = the last finished regular bar's close.
- `gapPct` = (session's first regular open − previous daily close) / previous daily close × 100.
- `rvolIntraday` = regular volume up to the cutoff ÷ the mean, over the previous 10 sessions, of regular
  volume up to the same ET minute.
- `avgVolume10d` = the mean daily volume of the previous 10 sessions.
- `atr` = `dailyAtr(daily, sessionDate)`.
- `type: "stock"`. Everything else is `null`.
- Return `null` when there is no regular bar before the cutoff or fewer than 10 prior sessions.

**`pickTopN`** filters with `passesBase` and `triggersFor(row, "open", null).length > 0`, sorts by
`activityScore(row.gapPct, volumeFor(row, "open"), null, [])` descending, then takes n.

**`runReplay` runs three passes, one ticker in memory at a time:**
1. For each ticker, for each session, build `replayRow` and keep the small row.
2. For each session, `pickTopN` over that session's rows.
3. For each ticker, for each session it was picked, run `splitSessions(barsUpTo(cutoff), session)` →
   `computeLevels` → `findSetup(ticker, split, levels, dailyAtr(...))`.
   - On a setup, score both variants with `runAtSec` = 10:30 ET that session and `cutoffSec` = the end of
     the period.
   - Collect `ControlTrade`s for filled setups.

After the passes, compute summaries, the control and the verdict.

- [ ] **Step 1: Write failing tests**
  - replayRank: "gap and rvol from bars". Use a hand fixture with 11 sessions where today opens +3% with
    2.5× the usual early volume. Expect `gapPct ≈ 3`, `rvolIntraday ≈ 2.5`, and `passesBase` true with ATR %
    set ≥ 1.5.
  - replayRank: "null with under 10 prior sessions".
  - replayRank: "pickTopN orders by activity and drops no-trigger rows".
  - replay: "end to end on a stub universe". Two tickers × 12 sessions, one with a planted sweep on
    session 12 (copy the shape of an existing `setup.test.ts` fixture). Expect `setupsFound 1`, the hold
    outcome scored, and a `pass` field present.
  - replay: "reads no bar after the cutoff when finding setups". A bar after 10:14 ET that would complete a
    sweep must not create a setup.
- [ ] **Step 2:** Run `npm test`. The new tests should FAIL.
- [ ] **Step 3: Implement** `replayRank.ts`, `replay.ts` and `fetchAlpacaRange`.
- [ ] **Step 4: Write `scripts/scorecard-replay.mts`.** The script:
  - uses the universe `UNIVERSES.sp500.symbols`
  - takes sessions from the 3 years ending at the last finished session, taken from SPY daily bars' dates
  - caches each ticker's 5m and 1d bars as JSON under `.cache/scorecard/` (already gitignored), so a rerun
    never refetches
  - logs progress every 25 tickers
  - writes `ScorecardSnapshot` kind `"replay"`, ruleVersion `CHART_RULE_VERSION`
  - **refuses to overwrite** an existing replay snapshot unless `--force` is passed
  - never writes `ChartSetup`
  - prints the summary
- [ ] **Step 5:** Run `npx tsc --noEmit` and `npm test`. Both should be clean or all PASS. Do NOT run the
  script; Task 8 does that.
- [ ] **Step 6:** Commit with message `feat(scorecard): 3-year replay of sweep-v1 with historical scan ranking`.

### Task 5: Job 1 — the daily run

**Files:**
- Create: `src/lib/scorecard/runDaily.ts`, `scripts/scorecard-run.mts`, `scripts/scorecard-run.cmd`
- Test: `src/lib/scorecard/runDaily.test.ts`

**Interfaces:**
- Consumes: `runScanAgent`/`ScanResult`, `runChartAgent`/`ChartAgentResult` (Task 1 shape), `groupOf`
  (Task 3), `SCORECARD_*` constants.
- Produces:
  - ```ts
    interface DailyDeps { now(): number; alreadyRan(sessionDate: string): Promise<boolean>;
      scan(nowMs: number): Promise<ScanResult>; chart(tickers: string[], runId: string): Promise<ChartAgentResult>;
      record(run: ScorecardRunInput): Promise<void>; newRunId(): string }
    ```
  - `runScorecardDaily(deps): Promise<{ action: "outside_window" | "already_ran" | "ran" | "no_session" | "failed"; sessionDate: string; note: string | null }>`
  - `ScorecardRunInput` mirrors the `ScorecardRun` columns minus id and ranAt.

**Rules:**
- **Window.** ET minutes must be in [630, 690) on a weekday (`etClock`), else `outside_window` with no
  record.
- **Already ran.** If `alreadyRan(session)` is true, return `already_ran` with no record.
  `alreadyRan` = a `ran` or `no_session` row exists for that session.
- **Scan.** If the scan fails, record `failed` with the error.
- **Chart.** Run the chart agent on the scan's first `CHART_TOP_N` tickers.
  - If it returns `ok:false`, record `failed`.
  - If it returns `ok:true` with `dataAsOf === null` (no regular bars today, i.e. a holiday), record
    `no_session`.
  - Otherwise record `ran`, with counts per `groupOf` over the logged rows. The chart result exposes
    `shown`/`rejected`/`cappedCount`; derive kept/unread from the shown/capped reviews' `reading`.
- **AI fields.** `aiBackend` and `aiModel` come from the chart result's `backend` and `model` (Task 1).
- **Script wiring** (`scorecard-run.mts`):
  - `scan` = `runScanAgent` with the same deps as `src/app/api/scan/route.ts`, except `annotateRows`, which
    returns empty notes with a status `{ ok: true, note: "ข้ามโน้ต AI (รอบอัตโนมัติ)" }`. Match the
    `SourceStatus` shape.
  - `chart` = `runChartAgent` with the route's deps, but `runId: () => runId` and `log` mapping rows to
    `{ ...row, source: SCORECARD_SOURCE }` before `prisma.chartSetup.createMany`. There is no abort signal.
  - Log lines go to stdout; the `.cmd` appends to `scripts/scorecard-run.log`.
  - On `failed`, send `sendDiscordNotification(…, "warning")`.
- **`.cmd`:** ASCII-only, a copy of the `risk-sentry.cmd` shape.

- [ ] **Step 1: Write failing tests**
  - "outside the window does nothing". At 09:30 ET and at 11:30 ET, `record` is not called and the action
    is `outside_window` (Review Focus 2).
  - "weekend does nothing".
  - "already ran does nothing". `alreadyRan` → true; `scan` is not called.
  - "holiday records no_session". The chart stub returns `ok:true, dataAsOf:null`, and the recorded status
    is `no_session` (Review Focus 1).
  - "scan failure records failed".
  - "ran records counts". The stub has 2 kept, 1 rejected, 1 unread (reading null); expect `kept 2,
    vetoed 1, unread 1, setups 4`.
  - "passes the same runId to chart and record".
- [ ] **Step 2:** Run `npm test`. The new tests should FAIL.
- [ ] **Step 3:** Implement `runDaily.ts`, the script and the `.cmd`.
- [ ] **Step 4:** Run `npx tsc --noEmit` and `npm test`. Both should PASS. Do not run the script against
  the live DB.
- [ ] **Step 5:** Commit with message `feat(scorecard): daily scheduled scan + chart agent run`.

### Task 6: Job 2 — nightly scorer and Discord

**Files:**
- Create: `src/lib/scorecard/nightly.ts`, `src/lib/scorecard/discord.ts`, `scripts/scorecard-score.mts`,
  `scripts/scorecard-score.cmd`
- Test: `src/lib/scorecard/nightly.test.ts`, `src/lib/scorecard/discord.test.ts`

**Interfaces:**
- Consumes: Tasks 2 and 3 (`scoreSetup`, `controlDistribution`, `groupOf`, `summarize`, `aiVerdictSample`,
  `beatsControl`) and `fetchAlpacaRange` (Task 4).
- Produces:
  - ```ts
    interface NightlyRow { id: number; createdAt: Date; ticker: string; status: string;
      aiReading: string | null; aiModel: string | null; entry: number; stop: number; t1: number;
      outcomes: Partial<Record<ExitVariant, Outcome>> }
    ```
  - ```ts
    interface NightlyDeps { now(): number; loadRows(): Promise<NightlyRow[]>;
      fetchBars(tickers: string[], fromSec: number): Promise<Map<string, Candle[]>>;
      saveOutcomes(rows: { chartSetupId: number; variant: ExitVariant; outcome: Outcome }[]): Promise<void>;
      loadRuns(sinceSession: string): Promise<ScorecardRunInput[]>; loadVerdict(): Promise<unknown | null>;
      saveLive(data: LiveSnapshot): Promise<void>; saveVerdict(data: AiVerdict): Promise<void>; send(message: string): Promise<void> }
    ```
  - `runScorecardNightly(deps): Promise<LiveSnapshot>`
  - `buildDiscordMessage(input: { snapshot: LiveSnapshot; lastRun: ScorecardRunInput | null; sessionDate: string; closedOvernight: …; openNow: … }): string`

**What one night does:**
1. `loadRows` returns scheduled rows of the current ruleVersion.
2. Rescore each row whose variant is missing or `open`, in both variants, using `runAtSec` =
   `createdAt`. Rows already `closed`/`not_filled`/`no_data` are never rescored.
   - Bars come from one `fetchBars` over the earliest unfinished `createdAt`.
   - A ticker with no bars stays `open`, and becomes `no_data` once `now − createdAt ≥ 15` days (Review
     Focus 4).
3. `saveOutcomes` upserts on `(chartSetupId, variant)` (Review Focus 2).
4. Build the `LiveSnapshot` and save it as kind `"live"`, overwritten each night:
   - per-group, per-variant `GroupStats`
   - the control median/p95 for kept (primary)
   - kept n toward 300
   - the model mix of the kept sample
   - the cumulative-R series per group (primary)
   - the missed sessions over the last 30 weekdays: weekdays with no `ran`/`no_session` run
   - `windowElapsed` per row (10 sessions have passed since the fill date, counted on SPY's or the row's
     own bars)
5. If `loadVerdict()` is null and `aiVerdictSample(...).ready`, compute the control on exactly that sample,
   then `saveVerdict` **once**. `saveVerdict` must refuse when one already exists; enforce it in the script
   with a `findUnique`-then-create.
6. `send(buildDiscordMessage(...))`.

**Discord text (Thai, plain, no prediction words), lines in this order:**
- header `NEXMIND Scorecard — {sessionDate}`
- last night's setups, kept against vetoed
- `ปิดแล้ว:` with each ticker, R and reason
- `ยังถือ:` with each ticker and k/10
- `สะสม AI เก็บ: n/300 · เฉลี่ย x.xxR`
- `ซื้อสุ่ม p95: x.xxR → ชนะ/ยังไม่ชนะ`
- status: `ยังตัดสินไม่ได้`, `เชื่อได้` or `เชื่อไม่ได้`
- the run line: `รอบอัตโนมัติเมื่อคืน: รันแล้ว HH:MM`, `ไม่มีตลาด`, `ล้มเหลว: …` or `ไม่ได้รัน (คอมปิด?)`
- if the last run's `unread > 0` and kept = 0: `⚠️ AI ไม่ทำงานเมื่อคืน — setup ไม่นับเข้า 300` (Review Focus 3)

- [ ] **Step 1: Write failing tests**
  - nightly: "scores open rows and never rescans closed ones". `saveOutcomes` receives only the rows that
    were open or missing.
  - nightly: "no bars → open, then no_data after 15 days".
  - nightly: "freezes the AI verdict exactly once". With `loadVerdict` → null and a ready 300-row fixture,
    `saveVerdict` is called once. With `loadVerdict` → existing, it is never called.
  - nightly: "unread rows never count toward 300".
  - nightly: "missed weekday shows in the snapshot".
  - discord: "says the AI was down", "says the run was missed", and "contains no prediction phrase". Run
    `isChartPrediction(message) === false` over the built message for a fixture.
- [ ] **Step 2:** Run `npm test`. The new tests should FAIL.
- [ ] **Step 3:** Implement `nightly.ts`, `discord.ts`, the script (Prisma reads/upserts,
  `fetchAlpacaRange` with `"5m"`, `sendDiscordNotification(msg, "info")`) and the `.cmd`. The log goes to
  `scripts/scorecard-score.log`. A thrown error sends a `"critical"` Discord message, the same as
  risk-sentry.
- [ ] **Step 4:** Run `npx tsc --noEmit` and `npm test`. Both should PASS.
- [ ] **Step 5:** Commit with message `feat(scorecard): nightly scorer, frozen AI verdict, morning Discord summary`.

### Task 7: `/scorecard` page (layout A)

**Files:**
- Create: `src/app/scorecard/page.tsx` plus small client components as needed (e.g.
  `src/app/scorecard/cumulative-chart.tsx`)
- Modify: `src/components/sidebar.tsx`. Add `{ href: "/scorecard", label: "Scorecard", icon: <a lucide icon> }`
  after `/journal`.

**Interfaces:**
- Consumes:
  - `ScorecardSnapshot` kinds `replay` / `live` / `ai-verdict`
  - recent `ScorecardOutcome` joined to `ChartSetup` (scheduled, current ruleVersion)
  - `ScorecardRun`
  - `SCORECARD_*` constants
- Produces: the page only. The page is read-only, makes no AI calls and never fetches bars.

**Layout (spec §9; mockup `.superpowers/brainstorm/122-1793652691/content/scorecard-layout.html`):**
1. **Two verdict cards.**
   - Replay: ผ่าน or ไม่ผ่าน, n, mean R, control p50/p95, period. If there is no snapshot: "ยังไม่ได้รันผลย้อนหลัง".
   - AI: the frozen verdict if present, else `ยังตัดสินไม่ได้ n/300` with a progress bar and the start date.
2. **Table.** Rows: kept / vetoed / unread / guard-stripped / random control. Columns: n, mean R, win %,
   T1-before-stop %.
   - Primary first, with a toggle for same-day.
   - Grey the cell with "ยังน้อยเกินไป" when n < 30.
   - Once the AI verdict is frozen, kept setups after the first 300 get their own row, "หลังคำตัดสิน"
     (information only).
3. **Cumulative R chart** (recharts, like `src/app/scan/setup-chart.tsx`): kept, vetoed, control median.
4. **Recent 30 trades:** date, ticker, AI, fill, stop, T1, and the result (R and reason / `ถืออยู่ วันที่ k/10` / `ไม่ได้เข้า` / `ไม่มีข้อมูลราคา`).
5. **Missed days**, then the disclaimers:
   - survivorship
   - earnings/8-K missing in replay
   - costs included in the means
   - "ไม่ใช่คำแนะนำซื้อ ไม่มี rule ไหนผ่าน hold-out"
   - the model mix

- [ ] **Step 1:** Read the Next 16 docs on server components and dynamic rendering under
  `node_modules/next/dist/docs/`. Match how `src/app/journal/page.tsx` is structured, and keep the page
  dynamic so it never serves stale data.
- [ ] **Step 2:** Implement. Nothing under `src/app/` has tests, by design (STATE §5).
- [ ] **Step 3:** Run `npx tsc --noEmit` and `npm run lint`, judging lint only on the touched files.
- [ ] **Step 4: (controller)** `preview_start nexmind-dev-web` (never `nexmind`), open `/scorecard`,
  `read_page` and screenshot. With empty tables it must render the empty states without errors.
- [ ] **Step 5:** Commit with message `feat(scorecard): /scorecard page`.

### Task 8: Run it for real, register the tasks, document

**Files:** `docs/quant/YYYY-MM-DD-sweep-v1-replay.md` (create), `docs/STATE.md`.

- [ ] **Step 1: (controller)** Run the replay in the background:
  `node --env-file=.env --import tsx scripts/scorecard-replay.mts`. Record the runtime and any Alpaca
  errors.
- [ ] **Step 2:** Write the results doc. It covers:
  - the period, universe and n
  - both variants' `GroupStats`
  - the control median/p95
  - **the verdict**
  - the biases, verbatim from the snapshot
  - the runtime
  - "pre-registered in `docs/superpowers/specs/2026-11-03-scorecard-agent-design.md` §6; not re-cut"
- [ ] **Step 3: (controller, owner-visible)** Register two Task Scheduler tasks with `Register-ScheduledTask`.
  Show the owner the exact commands first.
  - `NEXMIND Scorecard Run`: Mon–Fri at 21:30 and 22:30 ICT → `scripts\scorecard-run.cmd`.
  - `NEXMIND Scorecard Score`: Tue–Sat at 07:00 ICT → `scripts\scorecard-score.cmd`.
  - Both run whether or not the user is logged on, only if the CLI auth works; verify on the first night.
  - Do not touch the other `NEXMIND*` tasks.
- [ ] **Step 4: Update `docs/STATE.md`.**
  - §1: agent #4.
  - §2 rows: tests, the two tasks, the row counts.
  - §3 entry.
  - §4: remove the "stricter sweep rule" item, closed 2026-11-03 by the owner because `sweep-v1` stays.
    Replace the "scoring spec" item with this agent.
  - §5 trap: only `source="scheduled"` rows count; never edit `REVIEW_SYSTEM` or the sweep rule without
    bumping `CHART_RULE_VERSION`.
- [ ] **Step 5:** Commit with message `docs: sweep-v1 replay results; agent #4 state`.
