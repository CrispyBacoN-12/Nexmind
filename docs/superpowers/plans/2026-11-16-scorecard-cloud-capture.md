# Scorecard Cloud Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture each day's 10:30 ET chart-agent setups on GitHub Actions with no AI, then have the owner's PC
review the pending setups later from the frozen input. The forward record then no longer depends on the PC being
awake at 21:30–23:29 Thai time.

**Architecture:**
- **Capture.** `scripts/scorecard-capture.mts` runs the existing `runScorecardDaily` flow with a recorder in
  place of the AI review. The recorder keeps each `ReviewItem`. Rows are logged with `aiBackend: "pending"` and
  their `reviewInput`.
- **Review.** A pure `applyPendingReviews` orchestrator runs first inside the existing local scorer task. It reviews
  pending rows per run with the same decide logic `runChartAgent` uses, which is extracted into a shared pure
  function.
- **Scorer.** It keeps pending rows out of every group, and holds the frozen verdict until no earlier row is
  pending.

**Tech Stack:** TypeScript, Next.js 16, Prisma 7 + Neon (HTTPS adapter; schema changes are applied with
`prisma migrate diff --script` + Neon HTTPS, port 5432 is blocked), node:test via `npm test`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-16-scorecard-cloud-capture-design.md`. It amends
`docs/superpowers/specs/2026-11-03-scorecard-agent-design.md`. Read both.

## Global Constraints

**Credentials**
- No paid `ANTHROPIC_API_KEY`, and no Claude token on GitHub. The AI review runs only on the owner's PC through the
  existing CLI path, which is `--safe-mode --tools ""`.
- Never print or log `.env` or secret values.

**Unchanged pieces**
- `sweep-v1`, `REVIEW_SYSTEM`, scoring, costs, the control and the verdict rules are unchanged.
- `CHART_RULE_VERSION` is not bumped.

**The pending marker**
- The marker is `aiBackend === "pending"`. Export it as `PENDING_BACKEND = "pending"` from
  `src/lib/scorecard/types.ts`.
- A pending row is in no group, mean or count until it is reviewed.

**Public logs.** The repo is public, so Actions logs are public. Capture-side logs and Discord messages carry only
tickers, counts, the session date and a short Thai category. They never carry raw error text.

**Database writes**
- No `prisma.$transaction` in scripts. It needs Neon's WebSocket, which times out on this network.
- Schema changes are additive and nullable.
- `npm run db:push` cannot reach Neon. The controller applies the SQL over HTTPS.

**Tests and conventions**
- Tests stub all I/O. Do not run scripts against the live DB unless a step says the controller does.
- `vercel.json` keeps `crons: []`. Thai copy. `scripts/*.cmd` are ASCII-only.
- Never commit `obsidian-vault/`.
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Exact copy**
- Discord pending line: `รอ AI อ่าน {n} setup (ตั้งแต่ {YYYY-MM-DD})`
- Discord stale warning, when the oldest pending row is older than 3 calendar days:
  `⚠️ AI ยังไม่ได้อ่าน — เปิดคอมและเช็ก claude login`
- `PENDING_STALE_DAYS = 3` in `src/lib/scorecard/types.ts`.

## Review Focus

1. **The AI is unavailable when the review runs** (CLI logged out: backend `mock`, or a failure note). The rows
   stay pending, are retried on the next trigger, and Discord warns after 3 days. Pinned in Task 3 and Task 4.
2. **A row's `reviewInput` is missing or does not parse.** That row is finalized as unread with
   `aiBackend: "review_input_invalid"`. It never stays pending forever, because that would block the verdict for
   good. Pinned in Task 3.
3. **The AI's answer leaves out one of the run's tickers.** That row becomes reviewed-unread and is not left
   pending. That matches a live run. Pinned in Task 3.
4. **A late review turns an early row kept, before the frozen verdict.** The verdict is not `ready` while any
   pending row has (`createdAt`, `id`) at or before the 300th sample row. Pinned in Task 4.
5. **The capture and the local run both fire on the same session.** The second one is `already_ran` because of
   the existing guard, and nothing is double-logged. Covered by the existing `alreadyRan` tests. Task 2 adds no new
   path around it.

---

### Task 1: Shared decide logic, schema columns

**Files:**
- Create: `src/lib/chartAgent/decide.ts`, `src/lib/chartAgent/decide.test.ts`
- Modify: `src/lib/chartAgent/runChartAgent.ts` (step 5, lines about 184-200), `prisma/schema.prisma`
  (`ChartSetup`), and the regenerated `src/generated/prisma`
- Modify: `src/lib/scorecard/types.ts`. Add `PENDING_BACKEND` and `PENDING_STALE_DAYS`.

**Interfaces:**
- Produces:
  - `decideSetups(setups: Setup[], reviews: Map<string, Review>): { setup: Setup; review: Review; status: LogStatus }[]`.
    It keeps input order.
    - A missing review becomes `{ status: "unread", reading: null, reason: "AI ไม่ได้อ่าน" }`.
    - A `rejected` review gives `ai_rejected`, and a `stripped` one gives `guard_stripped`.
    - Otherwise the first `CHART_MAX_SETUPS` eligible setups are `shown` and the rest are `capped`.
  - `PENDING_BACKEND = "pending"` and `PENDING_STALE_DAYS = 3` in `src/lib/scorecard/types.ts`.
- **Prisma, additive.** On `ChartSetup`:
  - `reviewInput Json?`, documented as "The ReviewItem the AI is shown, frozen at capture, plus its input order;
    only on captured rows."
  - `reviewedAt DateTime?`
- `runChartAgent` keeps its behaviour exactly. Its `shown`, `rejected` and `cappedCount` are built from
  `decideSetups`' output.

- [ ] **Step 1: Write the failing tests in `decide.test.ts`**
  - "keeps input order and caps after 5 eligible". There are 7 setups with all kept reviews: statuses are 5 ×
    `shown` then 2 × `capped`.
  - "rejected and stripped do not use a shown slot". The order is [rejected, kept×5, stripped, kept]: statuses
    are ai_rejected, shown×5, guard_stripped, capped.
  - "a missing review is unread and still eligible". The review is absent, and the result is `shown` with
    `review.reading === null`.
- [ ] **Step 2:** Run `npx tsx --test src/lib/chartAgent/decide.test.ts`. It should FAIL because the module
  does not exist.
- [ ] **Step 3: Implement `decideSetups`.**
  - Replace the loop in `runChartAgent` step 5 with a call to it. Derive `shown` (with `bars`, from the
    matching `split`), `rejected` and `cappedCount` from its output.
  - Add the two schema columns and run `npm run db:generate` (local codegen only).
  - Add the two constants.
- [ ] **Step 4:** Run `npm test` and `npx tsc --noEmit`. Everything should pass, including every existing
  `runChartAgent.test.ts` case unchanged.
- [ ] **Step 5: (controller)** Apply the additive SQL to Neon.
  - Generate it with `npx prisma migrate diff --from-schema <HEAD~ schema> --to-schema prisma/schema.prisma --script`.
  - Apply it with a throwaway Neon-HTTPS script, the same method as 2026-11-03 (STATE §5). Delete the script after.
- [ ] **Step 6:** Commit with message `feat(scorecard): shared decide logic; reviewInput/reviewedAt columns`.

### Task 2: Capture — recorder, script, dry run

**Files:**
- Create: `src/lib/scorecard/capture.ts`, `src/lib/scorecard/capture.test.ts`, `scripts/scorecard-capture.mts`

**Interfaces:**
- Consumes:
  - `reviewSetups`' type and `ReviewItem` (`src/lib/chartAgent/review.ts`)
  - `runScorecardDaily` / `DailyDeps` (`src/lib/scorecard/runDaily.ts`)
  - `PENDING_BACKEND`
- Produces:
  - ```ts
    interface ReviewInput { order: number; item: ReviewItem }
    ```
  - `makeRecorder(): { review: typeof reviewSetups; inputs(): Map<string, ReviewInput> }`.
    - The recorder's `review(items)` returns `{ reviews: new Map(), backend: PENDING_BACKEND, note: null, model: null }`.
    - It keeps one `ReviewInput` per ticker, with `order` = the item's index in that call.
  - `parseReviewInput(json: unknown): ReviewInput | null`. This is a structural check that round-trips what JSON
    storage gives back: `setup.ticker`, `entry`, `stop`, `t1.price`/`r`/`names`, `sweptLevels`, `sweepBar`,
    `levels`, `dataAsOf`, `recent` candles, and a numeric `order`. Task 3 uses it.
- **Script:** `scripts/scorecard-capture.mts` mirrors `scripts/scorecard-run.mts`, with these differences:
  - **The `chart` dependency:**
    - Its `review` is `recorder.review`.
    - Its `log` maps each row to `{ ...row, source: SCORECARD_SOURCE, reviewInput: recorder.inputs().get(row.ticker) }`.
      `aiBackend` is already `"pending"` through `toLogRows`.
  - **`--dry-run` flag:**
    - It skips the window check.
    - It runs only the scan, prints `scorecard-capture dry-run: scan ok, {rows} rows, top {n}: {tickers}`, and
      exits 0.
    - It prints `scorecard-capture dry-run: scan failed ({category})` and exits 1 on failure.
    - It makes no DB writes and sends no Discord message.
  - **Errors:**
    - Log and Discord carry only a short Thai category plus the session date, never `String(e)`. Categories:
      `สแกนไม่สำเร็จ`, `ดึงกราฟไม่สำเร็จ`, `บันทึกลงฐานข้อมูลไม่ได้`, `ไม่ทราบสาเหตุ`.
    - Full error text goes nowhere, because the logs are public.

- [ ] **Step 1: Write the failing tests in `capture.test.ts`**
  - "recorder returns no reviews and the pending backend". Assert `backend === "pending"`, `model === null`,
    `reviews.size === 0`.
  - "recorder keeps each item with its input order". Three items give `inputs().get(ticker).order` = 0, 1, 2.
  - "parseReviewInput round-trips a ReviewItem through JSON". Use `JSON.parse(JSON.stringify(input))` and assert
    deep-equal.
  - "parseReviewInput rejects missing fields". Each of `{}`, `null`, a missing `recent`, and a non-numeric
    `order` returns null.
  - "a capture run through runScorecardDaily logs pending rows". Stub the scan and the bars so one setup is found,
    and use the real `runChartAgent` with the recorder. Assert:
    - the logged row has `aiBackend === "pending"`, `status === "shown"`, `aiReading === null`
    - `reviewInput.order === 0`
- [ ] **Step 2:** Run `npx tsx --test src/lib/scorecard/capture.test.ts`. It should FAIL.
- [ ] **Step 3:** Implement `capture.ts` and the script.
- [ ] **Step 4:** Run `npm test` and `npx tsc --noEmit` (`tsc` covers `scripts/`). Both should pass.
- [ ] **Step 5:** Commit with message `feat(scorecard): capture run with a review recorder (no AI)`.

### Task 3: Local review of pending rows

**Files:**
- Create: `src/lib/scorecard/pendingReview.ts`, `src/lib/scorecard/pendingReview.test.ts`
- Modify: `scripts/scorecard-score.mts`. It runs the review before the summary guard, every trigger.

**Interfaces:**
- Consumes:
  - `decideSetups` (Task 1)
  - `parseReviewInput` and `ReviewInput` (Task 2)
  - `groupOf`, `PENDING_BACKEND`
  - `reviewSetups`' return type
- Produces:
  - ```ts
    interface PendingRow { id: number; runId: string; reviewInput: unknown }
    ```
  - ```ts
    interface ReviewUpdate { id: number; status: LogStatus; aiReading: string | null; aiRejectReason: string | null;
      aiBackend: string; aiModel: string | null; reviewedAt: Date }
    ```
  - ```ts
    interface PendingReviewDeps { now(): number; loadPending(): Promise<PendingRow[]>;
      review: typeof reviewSetups; saveRow(u: ReviewUpdate): Promise<void>;
      saveRunCounts(runId: string, c: { kept: number; vetoed: number; stripped: number; unread: number;
        aiBackend: string; aiModel: string | null }): Promise<void> }
    ```
  - `applyPendingReviews(deps): Promise<{ runs: number; reviewed: number; skipped: number; invalid: number; note: string | null }>`

**Rules:**
- **Grouping.** Group pending rows by `runId`. Inside a run, order them by `reviewInput.order`.
- **Invalid input.** A row whose `reviewInput` fails `parseReviewInput` is saved at once as status unchanged,
  `aiReading: null`, `aiBackend: "review_input_invalid"`, `aiModel: null`, `reviewedAt: now`. It counts as
  `invalid`.
- **One AI call per run.** Call `review(items)` once per run with the parsed items.
- **The AI did not answer.** If the result's `backend === "mock"` or its `note !== null`, save nothing for that
  run. Count it as `skipped`, and the next trigger retries.
- **The AI answered.** Run `decideSetups(items.map(i => i.setup), result.reviews)`.
  - Write each row:
    - `status`
    - `aiReading = review.reading`
    - `aiRejectReason = status === "ai_rejected" ? review.reason : null`
    - `aiBackend = result.backend`, `aiModel = result.model`
    - `reviewedAt`
  - A ticker the answer left out comes back `unread` from `decideSetups`, and it is still finalized.
  - Then write the run counts via `groupOf` over the decided rows.
- **Sequential saves.** No `$transaction`. A run that stops midway leaves the rest pending and retries them.
- **Script.** In the script, `loadPending` reads `ChartSetup` rows with `source = "scheduled"`, the current
  `ruleVersion` and `aiBackend = "pending"`, ordered by id. Log one line per call:
  `scorecard-review: runs {r}, reviewed {n}, skipped {s}, invalid {i}`. The review runs before the
  `summaryDue` early-return.

- [ ] **Step 1: Write the failing tests in `pendingReview.test.ts`**
  - "reviews a run once and writes decided statuses". It covers 2 runs with 3 and 1 rows: the review is called
    twice, and the statuses and readings match `decideSetups`.
  - "AI unavailable leaves rows pending". The result is backend `mock` or a non-null note, so neither `saveRow`
    nor `saveRunCounts` is called and `skipped === 1` (Review Focus 1).
  - "invalid reviewInput is finalized as unread, not left pending". Assert
    `aiBackend === "review_input_invalid"` and `invalid === 1`, and the other rows of that run are still reviewed
    (Review Focus 2).
  - "a ticker missing from the AI answer is finalized as unread" (Review Focus 3).
  - "rows are reviewed in stored input order, not id order". The ids are reversed against `order`, and the
    sixth eligible row by `order` is `capped`.
  - "run counts come from groupOf".
- [ ] **Step 2:** Run `npx tsx --test src/lib/scorecard/pendingReview.test.ts`. It should FAIL.
- [ ] **Step 3:** Implement the module and wire it into the script.
- [ ] **Step 4:** Run `npm test` and `npx tsc --noEmit`. Both should pass.
- [ ] **Step 5:** Commit with message `feat(scorecard): review pending captured setups on the local machine`.

### Task 4: Scorer, verdict gate, page and Discord

**Files:**
- Modify: `src/lib/scorecard/nightly.ts`, `src/lib/scorecard/groups.ts`, `src/lib/scorecard/discord.ts`
  (and their tests), `scripts/scorecard-score.mts` (`loadRows` selects `aiBackend`), `src/app/scorecard/guards.ts`
  and `src/app/scorecard/page.tsx`

**Interfaces:**
- Consumes: `PENDING_BACKEND`, `PENDING_STALE_DAYS`.
- Produces:
  - `NightlyRow` gains `aiBackend: string`.
  - `aiVerdictSample(rows, pending: { id: number; createdAt: Date }[] = [])`. `ready` additionally requires that
    no pending entry sorts at or before the last sample row by (`createdAt`, `id`).
  - `LiveSnapshot` gains `pendingReview: { n: number; oldestDate: string | null }`, where `oldestDate` is the ET
    run date of the oldest pending row.

**Rules:**
- **Pending rows are still scored.** Outcomes are saved as today.
- **But they are excluded everywhere else:**
  - `groupOf` calls
  - stats, counts, `cumulativeR` and `recentTrades`
  - `lastRun` group counts and `aiDown`
- **The verdict sample takes them as its `pending` argument.**
- **Discord, when `pendingReview.n > 0`:**
  - Add the pending line after the run line.
  - Add the stale warning when `now − oldest pending createdAt > PENDING_STALE_DAYS` days.
- **The page.**
  - `guards.ts` accepts `pendingReview` as optional, so older snapshots still render.
  - The page shows the same pending line under the AI card when n > 0.

- [ ] **Step 1: Write the failing tests**
  - nightly: "pending rows are scored but in no group". One pending row and one kept row give `counts.kept.total`
    of 1, the pending row out of `recentTrades`, its outcome still in `saveOutcomes`, and `pendingReview.n` of 1.
  - groups: "verdict not ready while an earlier row is pending". There are 300 closed, elapsed kept rows and one
    pending row with createdAt before the last one, so `ready === false`. With the pending row after the last
    one, `ready === true` (Review Focus 4).
  - discord: "shows the pending line and the stale warning". With n = 2 and the oldest 4 days old, both lines
    appear. With the oldest 1 day old, only the pending line appears. `isChartPrediction(message) === false`.
- [ ] **Step 2:** Run the three test files. They should FAIL.
- [ ] **Step 3:** Implement. On the page side, run `npx tsc --noEmit` and eslint on the touched `src/app` files.
- [ ] **Step 4:** Run `npm test` and `npx tsc --noEmit`. Both should pass.
- [ ] **Step 5: (controller)** Preview `/scorecard` on `nexmind-dev-web` and confirm it renders with no errors.
- [ ] **Step 6:** Commit with message `feat(scorecard): pending rows wait for review; verdict waits for them`.

### Task 5: GitHub Actions workflow and docs

**Files:**
- Create: `.github/workflows/scorecard-capture.yml`
- Modify: `docs/STATE.md`

**Workflow (exact values):**
- **Triggers:**
  - `schedule: - cron: "*/15 14-16 * * 1-5"`
  - `workflow_dispatch` with input `dry_run` (boolean, default false)
- **Job `capture`** on `ubuntu-latest`, `timeout-minutes: 15`, `concurrency: { group: scorecard-capture,
  cancel-in-progress: false }`.
- **Step 1 (shell, before anything else).** If this is not a dry run, compute `TZ=America/New_York date +%u%H%M`.
  If the weekday is not 1-5, or the time is outside `1030`..`1129`, echo `outside window` and set an output that
  skips every later step. Cost: seconds.
- **Steps:** `actions/checkout@v4`, `actions/setup-node@v4` (node 22, `cache: npm`), `npm ci`, then
  `node --import tsx scripts/scorecard-capture.mts` with `--dry-run` when `inputs.dry_run`.
- **Env from secrets:** `DATABASE_URL`, `ALPACA_KEY`, `ALPACA_SECRET`, `DISCORD_WEBHOOK_URL`, `FINNHUB_API_KEY`,
  `SEC_USER_AGENT`.
  - `DATABASE_URL` must be set on the job, because `npm ci` runs `prisma generate` and `prisma.config.ts`
    requires it.
  - No Claude token, and no CLI install.

**Docs (`STATE.md`):**
- §1 / §3: describe the capture-and-review split.
- §2: add the workflow row and the secrets list, giving names only.
- §5: add a trap. Capture rows are `aiBackend "pending"` until the PC reviews them, and the CLI must stay logged
  in on the PC.

- [ ] **Step 1:** Write the workflow.
- [ ] **Step 2:** Validate it.
  - Run `npx --yes @action-validator/cli .github/workflows/scorecard-capture.yml` if it is available. Otherwise
    parse it with `node -e` and the `yaml` package, if it is present in `node_modules`.
  - Report which validation you ran.
- [ ] **Step 3:** Update STATE.md.
- [ ] **Step 4:** Commit with message `ci(scorecard): scheduled capture on GitHub Actions`.

### After the plan (controller, needs the owner)

1. **Owner adds the secrets.** The owner adds `ALPACA_KEY`, `ALPACA_SECRET` and `DISCORD_WEBHOOK_URL` (plus
   `SEC_USER_AGENT`/`FINNHUB_API_KEY` if wanted) under repo Settings → Secrets → Actions. `DATABASE_URL` already
   exists, and the owner confirms it is current. Claude never handles the values.
2. **Merge and push** with owner approval. GitHub runs the workflow only from the default branch.
3. **Dry run.** Run `gh workflow run scorecard-capture.yml -f dry_run=true` and read the run log. TradingView,
   Alpaca and Neon must all answer.
4. **First real night.** Check the Actions run, the pending rows, the local review on the next PC wake, and the
   morning summary.
