# Scorecard: cloud capture, local AI review — design amendment

Status: draft, 2026-11-16. This amends `2026-11-03-scorecard-agent-design.md` §8 (Job 1). The owner chose this in
chat ("ทาง 2"). Items marked *(designer's call)* can be changed.

## 1. Why

**The owner cannot be at the machine every night.** The daily run needs the PC awake at 10:30–11:29 ET, which is
21:30–23:29 Thai time, and the owner is often away then.

**Waking the PC is not reliable.** Wake-from-sleep is on (2026-11-05), but it still failed:
- 2026-11-12: the machine woke on time and the network was down, so both runs failed.
- 2026-11-13: it never woke, probably because it was on battery.

**The owner turned down the alternatives:**
- A paid `ANTHROPIC_API_KEY`: no.
- The subscription token on GitHub: no. A token that can use the owner's Claude account should not leave their
  machine, and the CLI on the GitHub runner once produced `mock` for reasons never explained.

## 2. The change in one paragraph

**Split Job 1 into two halves.**
- **Capture, on GitHub Actions.** At 10:30 ET it runs the scan and the chart agent's code on a GitHub runner,
  with no AI. It logs every setup it finds, together with the exact input the AI would have been shown: the
  setup and its 24 most recent finished 5-minute bars.
- **Review, on the owner's PC.** Whenever the PC is on, the AI reads the pending setups from that stored input.
  It then writes its decisions onto the same rows.

Nothing the AI sees depends on when it reads them, and nothing it can learn changes in the meantime:
- **The CLI has no tools.** It already runs with `--safe-mode --tools ""` (`src/lib/anthropic.ts`), so it
  cannot browse the web.
- **The input is frozen.** It holds only bars that ended before 10:30 − 16 min.
- **The fill does not move.** The fill (spec §5) stays the first bar at or after the capture time, so a late
  review never changes a price.

## 3. Goals

- **No missed nights.** A night's capture no longer depends on the PC.
- **Same measurement.** The AI verdict means the same thing: the AI's keep or veto, given exactly the inputs it
  would have had at 10:30.
- **The owner's Claude login never leaves their machine.**
- **The local Job 1 stays as a fallback.** Whichever run gets the session first wins. The existing
  `alreadyRan` guard already makes a second run do nothing.

## 4. Non-goals

- No paid API key. No Claude token on GitHub.
- No change to `sweep-v1`, `REVIEW_SYSTEM`, scoring, costs, the control or verdict rules.
- `CHART_RULE_VERSION` is not bumped. The rule and prompt are unchanged, and the AI sees the same input.
- No Vercel cron. `vercel.json` stays `crons: []`.

## 5. Capture (GitHub Actions)

**Schedule and environment**
- New workflow `.github/workflows/scorecard-capture.yml`.
  - Weekdays, cron `*/15 14-16 * * 1-5` (UTC). That covers the 10:30–11:29 ET window in both EST and EDT.
  - Before `npm ci`, a cheap shell step checks the New York clock. It ends the job unless the time is
    10:30–11:29 ET, so most firings cost seconds. *(designer's call)*
  - Plus `workflow_dispatch` with a `dry_run` input (see Testing).
- Secrets, which the owner sets and Claude never reads or prints: `DATABASE_URL` (already present), `ALPACA_KEY`,
  `ALPACA_SECRET`, `DISCORD_WEBHOOK_URL`. Optional: `FINNHUB_API_KEY` (headlines; the scan degrades without it)
  and `SEC_USER_AGENT`.
- **The repo is public, so Actions logs are public.** The capture logs only tickers, counts and the session date.
  Errors go to Discord and the log as a short category, never raw error text (Prisma errors can include the DB
  host).

**What one capture does**
- `scripts/scorecard-capture.mts` runs the same `runScorecardDaily` flow as `scorecard-run.mts`, with two
  differences:
  - **The review dependency is a recorder.** It returns no reviews, backend `"pending"` and model `null`. It keeps
    each `ReviewItem` it was handed (the setup plus its 24 recent bars), in input order.
  - **The `log` dependency stores the input.** It writes each row with `source: "scheduled"`,
    `aiBackend: "pending"`, and a new nullable column `reviewInput` (Json) holding that row's `ReviewItem` and its
    position in the run's input order.
- `runChartAgent` already treats a missing review as "unread". So a captured row's status is `shown` for the first
  5 setups and `capped` after, with a null `aiReading`. That status is provisional: the review rewrites it.
- The `ScorecardRun` row is `ran`, with `aiBackend: "pending"` and its counts.

## 6. Review (owner's PC)

**Where it runs**
- It is a step inside the existing `NEXMIND Scorecard Score` task: wake, logon and hourly triggers, and it never
  wakes the PC.
- `scorecard-score.mts` runs review first, then the summary-if-due logic as today. *(designer's call: one task, so
  a summary is never sent before a review that was possible at the same moment.)*

**Per run**
- Load that run's pending rows (`aiBackend = "pending"`) in stored input order.
- Call `reviewSetups` once with the stored `ReviewItem`s.
- If the call did not reach the AI (backend `mock`, or a failure note), change nothing. The rows stay pending and
  the next trigger retries.
- If it did, re-derive each row's status with the same logic `runChartAgent` uses today:
  - a rejection becomes `ai_rejected`, and a stripped reading becomes `guard_stripped`
  - otherwise the first 5 in input order are `shown` and the rest are `capped`
  - a ticker the AI's answer left out stays unread (null reading), exactly as in a live run

  Extract that logic into one pure function and call it from both places, so the two can never drift apart.
- Write `status`, `aiReading`, `aiRejectReason`, `aiBackend`, `aiModel`, and a new nullable `reviewedAt`.
- Update the run row's `kept` / `vetoed` / `stripped` / `unread` and its backend and model.

## 7. Scorer and verdict changes

- **Pending rows are not grouped.** `groupOf` is never called on a row whose `aiBackend` is `"pending"`. Pending
  rows can still be scored (fills and exits do not depend on the review), but they appear in no group, mean or
  count until they are reviewed.
- **The verdict waits for reviews.** `aiVerdictSample` is `ready` only when no pending row has a
  (`createdAt`, `id`) at or before the 300th sample row. A late review could otherwise move a row into the first
  300 after the verdict froze.
- **Show what is pending.**
  - The live snapshot carries `pendingReview: number` and the oldest pending session.
  - The page and Discord show "รอ AI อ่าน n setup (ตั้งแต่ <date>)" when n > 0.
  - A pending row older than 3 days adds a warning to Discord ("AI ยังไม่ได้อ่าน — เปิดคอมและเช็ก claude login").
    *(designer's call)*

## 8. Testing (before the schedule is trusted)

- Unit tests, pure, as in the original spec:
  - the extracted decide function, run against the current `runChartAgent` tests
  - the recorder review dependency
  - review application, including the "AI did not answer" case leaving rows pending
  - grouping that skips pending rows
  - verdict readiness blocked by an earlier pending row
- A `workflow_dispatch` run with `dry_run=true` on GitHub. It runs the scan only and prints the number of rows,
  with no DB writes and no window check. That proves TradingView, Alpaca and Neon all answer from a GitHub
  runner before any night depends on it.
- The first real night: check the Actions run, the pending rows, the local review on the next PC wake, and the
  morning summary.

## 9. Left to the builder

- The exact shape of `reviewInput` (it must round-trip `Setup`, including `Candle`s and `LevelName[]`).
- How the workflow caches `node_modules`.
- The dry-run output format.
