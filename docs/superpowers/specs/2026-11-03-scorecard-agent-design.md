# Agent #4: scorecard for the chart agent's picks — design

Status: draft, 2026-11-03. The owner designed it in chat. Items marked *(designer's call)* were decided by
the designer and can be changed.

## 1. Intent

Agent #2, the chart agent on `/scan`, picks long-sweep setups. Each one has an entry, a stop, T1 and T2,
and the AI reads it and either keeps it or vetoes it. The owner wants to know **how far they can trust
these picks**: "if I had bought every one, every day, what would I have got?"

Agent #4 answers that with two measurements:

1. **Replay (code rule only, fast).** Run the sweep rule, which is deterministic code, over about 3 years of
   past 5-minute bars, and score every setup it would have produced. This judges the rule. It cannot judge
   the AI, because replaying the AI on old charts is contaminated (the model may know what happened next)
   and costs the owner's quota.
2. **Forward (the AI, slow).** From now on, the machine runs the scan and the chart agent **by itself once
   every trading day**. Every setup is logged, both the ones the AI kept and the ones it vetoed. After each
   session, every setup is scored on real bars.

The owner sees the results on a new page, `/scorecard`, and in a Discord summary every morning.

This follows the project's rule: **code measures, the AI describes, the owner decides.** The scorecard
measures. It never recommends a buy.

## 2. Goals

- The replay of `sweep-v1` gives one verdict, computed once, with a sample in the thousands and its biases
  stated on the page.
- Every trading day the machine logs that day's setups without the owner pressing anything. A missed day
  (machine off, run failed, AI down, holiday) is recorded as missed, with a reason.
- Every logged setup is scored under two exits:
  - **Primary:** hold until the stop or T1 is hit.
  - **Secondary:** close at the end of that same day.
- **The verdict is about beating random entries, not about making money.** Each group's average R is
  compared with the distribution produced by random entries on the same tickers and days, with the same
  stop distance and target.
- **The AI is judged directly.** The page compares kept against vetoed, each against its own random control.

## 3. Non-goals and anti-goals

- **No edge claim.** `ADVISOR_NO_EDGE_CLAIM` and the "sweep rule is a description, not an edge" trap
  (`docs/STATE.md` §5) still hold. The page says what was measured. Until a verdict passes, it never
  says the picks work.
- **No tuning from the results.** While data is being collected, `sweep-v1` and the AI review prompt stay
  frozen. If either changes, `CHART_RULE_VERSION` is bumped and counting starts again. Rows from different
  versions are never pooled.
- **No feedback into what the agents show.** The scorecard does not add a win-rate badge to `/scan` or
  `/advisor`. *(designer's call)*
- **No orders.** Nothing here places or simulates a broker order. It is arithmetic on bars.
- **No cloud schedule.** Keep `vercel.json` `crons: []`. Both jobs run on the owner's machine through Task
  Scheduler, like Risk Sentry. The `/scorecard` page itself may deploy to Vercel. It only reads, so that is
  fine.
- **Anti-goal: a verdict that quietly changes its rules.** The thresholds in §6 are fixed before any row is
  read. A result that misses them is reported as a miss, never re-cut.

## 4. Owner decisions (from chat, 2026-11-03)

1. **Build both:** replay and forward.
2. **The machine runs the chart agent itself every trading day.** The owner accepted the daily quota cost.
3. **Score both exits.** The designer picked **hold until stop/T1** as the primary verdict, because the US
   session ends at 04:00 Thai time and a same-day exit is not something the owner can realistically do.
   The same-day close is reported beside it.
4. **"Trust" means average R per trade beats random entries.** Win rate is shown, but it is not the verdict.
5. **`sweep-v1` stays exactly as it is.**
   - The open "stricter sweep rule" item in `docs/STATE.md` §4 (reject a retest after a gap-down reclaim) is
     **closed: not built**.
   - The builder removes it from §4 and records the decision.
   - The replay and the forward count both measure the rule the owner uses today.
6. **Results go to both a page and Discord.** The page uses **layout A**: verdict cards at the top, then the
   kept / vetoed / random table, the cumulative-R chart, recent trades, and missed days.

## 5. Scoring one setup *(designer's calls unless noted)*

**Fill**
- Fill = the open of the **first regular 5-minute bar that starts at or after the moment the run happened**
  (forward: the row's `createdAt`; replay: the simulated run time).
- `dataAsOf` is not the fill time. The 16-minute SIP delay is real, and the owner pays it.
- If that open is already **at or below the stop**, or **at or above T1**, the setup is **not filled**. It is
  counted and shown, never scored. The owner would not buy a broken setup.

**R**
- R = (exit − fill) / (fill − stop). Use the fill, not the setup's `entry`.
- Apply `RESEARCH_COST_MODEL` (= `EQUITY_COST_MODEL`, `src/lib/research/runResearch.ts`) exactly as the research
  code does: 5 bps slippage on every fill, including gap exits at the open, plus its 1 bp round-turn commission.
  Webull charges no commission, so this is slightly conservative, and it matches every earlier study.
  *(designer's call)*
- **The control applies the same costs.** Costs therefore mostly cancel out of the verdict margin, but not out of
  the reported mean R. The page says so.

**Primary exit: hold until stop or T1**
- Walk regular-session 5-minute bars from the fill bar onward. The setup exits at the first hit:
  - **Stop:** a bar's low is at or below the stop.
  - **T1:** a bar's high is at or above T1.
- **Same bar:** if one bar touches both, it counts as the stop.
- **Gaps:** if a session opens below the stop, exit at that open, which can cost more than 1R. If it opens
  above T1, exit at that open.
- **Cap:** 10 trading sessions, counting the entry day as 1. If neither level is hit, exit at the 10th
  session's last regular close.
- A setup still inside its 10 sessions is **open**. Open setups are listed on the page but excluded from
  every average.

**Secondary exit: close the same day**
- Same rules, but if neither level is hit, exit at the entry day's last regular close.

**Which rows count (forward)** *(designer's call)*
- `POST /api/chart-agent` already logs rows whenever anyone presses the `/scan` button, including on the
  public Vercel URL. Those rows run at other times of day, can duplicate a ticker/session, and can come from
  strangers.
- **Add a `source` column to `ChartSetup`**: the default is `"button"`, and Job 1 writes `"scheduled"`.
  Existing rows and the button route are otherwise untouched.
- **Only `source = "scheduled"` rows of the current `ruleVersion` are scored and counted.** Button rows are
  ignored by the scorecard.
- **Store the resolved model** for every row (`aiModel`, e.g. `claude-sonnet-…`), in addition to
  `aiBackend`. The review calls the `"sonnet"` alias, whose model can change silently over the months it takes
  to reach 300.
  - A model change does **not** reset the count: the question is "the AI as the owner actually uses it".
  - The page lists the model mix in the kept sample.
  - A change to the review **prompt** is a rule change and bumps `CHART_RULE_VERSION`.

**Groups (forward)**
- **AI kept:** status `shown` or `capped` with a non-null `aiReading`.
- **AI vetoed:** `ai_rejected`.
- **Guard-stripped:** `guard_stripped` is its own small line, outside the verdict.
- **Unread:** `shown` or `capped` with a null `aiReading` (the AI was down). These are excluded from the AI
  verdict but included in the "code rule, forward" line.
- If the builder finds that `aiReading` is not a reliable kept/unread signal, they should persist the review
  status explicitly.

**Random control**
- Each setup is paired with random entries on the **same ticker and same session**. The entry is a random
  regular bar open between the run time and 15:30 ET.
- The control keeps the setup's stop distance as the same multiple of daily ATR, and T1 as the same R
  multiple (`r1`).
- The same exits and costs apply.
- The control is run `CONTROL_RUNS` times (200) with `PANEL_SEED` and `mulberry32` from `src/lib/research/`.
  Each run gives one mean R over the group. The p50 and p95 of those means are the group's control.

## 6. Verdicts (pre-registered; never changed after a row is read)

- **Replay verdict (code rule):** over all scored replay setups, the primary-exit mean R must be **above the
  p95 of its random control**.
  - The verdict is either **ผ่าน** or **ไม่ผ่าน**.
  - It is computed once and stored with its sample size, period and stated biases.
- **AI verdict (forward):** decided only when **AI kept reaches 300 scored setups** of the current
  `ruleVersion`. Until then the card reads **ยังตัดสินไม่ได้ n/300**.
  - At 300, the verdict is **เชื่อได้** if the kept group's primary mean R is above the p95 of its own
    control, and **เชื่อไม่ได้** otherwise.
  - **The sample is the first 300 AI-kept, filled setups by `createdAt`.** Rows close out of order, so the
    verdict waits until all 300 have closed. It is then computed **once and frozen**: it is stored with
    its date, n and control stats, and never recomputed. *(designer's call, to avoid optional stopping)*
  - Setups after the first 300 keep being scored and are shown as "หลังคำตัดสิน", which is information only.
  - "Kept minus vetoed" is shown as a reported number, not a second verdict.
- Each number on the page carries its n. Means with n < 30 are shown greyed with "ยังน้อยเกินไป".
  *(designer's call)*

## 7. Replay *(designer's calls)*

- **Period:** the 3 years ending at the last finished session before the build, about 750 sessions. Use
  Alpaca SIP 5-minute and daily bars. Cache them to disk; this is a one-off, long-running script under
  `scripts/`.
- **Universe:** today's S&P 500 list.
  - **Survivorship bias:** names that left the index are missing.
  - The page and the results doc must state this. The random control inherits the same bias, so the
    margin still means something.
- **Simulated run time:** 10:30 ET each session, the same as the live job (§8).
  - Bars are read only up to 10:30 − `SIP_DELAY_MS`.
  - Fill at the first bar starting at or after 10:30.
- **Picking the top 20.** Mirror `runScanAgent`'s filter and order as closely as historical data allows:
  - `passesBase`: price, 10-day average volume, ATR %.
  - At least one trigger.
  - Order by `activityScore`.
  - Gap = the session open against the previous close.
  - Relative volume = volume up to the cutoff against the 10-session average for the same time window.
  - **The earnings and 8-K inputs are not available historically and count 0.** State this.
  - Take the top `CHART_TOP_N`.
- **Setups:** run the real `splitSessions` → `computeLevels` → `findSetup` pipeline with the same daily ATR
  rule as `runChartAgent`. The replay must call the live code, not a copy. No AI is involved, and the cap
  is irrelevant because every setup is scored.
- **Output:**
  - Write a results doc to `docs/quant/YYYY-MM-DD-sweep-v1-replay.md`.
  - Store a summary where the page can read it, with the same groups and control stats.
  - Replay setups are **never** written to `ChartSetup`.

## 8. Daily jobs *(designer's calls)*

**Job 1: run (night).** A new Task Scheduler task runs the scan then the chart agent, at about **10:30 ET**.
- **Clock.** ET shifts against Thai time with US daylight saving, so the task fires at both 21:30 and 22:30
  ICT, Monday to Friday.
- **Gate.** The script runs only if the ET clock reads 10:30 to 11:29 and no run is recorded yet for that
  session. That keeps it idempotent.
- **Scan.** Run without the per-row AI notes, to save quota.
- **Chart agent.** Use the real `runChartAgent` with the real review, which is one AI call, and the real
  `ChartSetup` log.
- **Run record.** Every attempt records one row in a new run table (or equivalent): session date, ran at,
  status (`ran` | `no_session` | `failed`), setup counts, AI backend, error text.
  - A holiday shows up as `no_session` (no regular bars today).
  - A day with no record at all reads as **"คอมไม่ได้รัน"** on the page.

**Job 2: score + Discord (morning).** It runs at **07:00 ICT, Tuesday to Saturday**, after the US close.
- It scores every unscored or open `ChartSetup` row on real bars and stores the outcomes in a new table, so
  the page never re-fetches bars.
  - Keep one row per setup per exit variant: status `open` / `closed` / `not_filled`, fill, exit time and
    price, R.
- It recomputes the control stats.
- It sends one Discord message through `DISCORD_WEBHOOK_URL`, layout as in the mockup:
  - last night's setups, kept against vetoed
  - trades closed overnight, with R and the reason
  - trades still open, with their session count
  - running kept n/300, mean R, control p95, status
  - whether last night's run happened, and whether the AI was up
- If the AI was down last night, the message says so, because those rows are "unread" and do not count
  toward 300.

Both scripts follow the existing pattern:
- `.cmd` wrappers that are ASCII-only and start with `node --env-file=.env --import tsx`.
- Logs written to `scripts/*.log`.
- All I/O injected into a pure orchestrator so it can be tested, the same shape as `runChartAgent` /
  `runRiskSentry`.

## 9. Page `/scorecard` (layout A)

Add it to the sidebar after `/journal`. From top to bottom:

1. **Two verdict cards.**
   - Replay: verdict, n, mean R, control p50/p95, period.
   - Forward AI: status, kept n/300 progress bar, start date.
2. **Table.** Rows: AI kept / AI vetoed / unread / guard-stripped / random control. Columns: n, mean R,
   win %, T1-before-stop %.
   - Primary exit first. A line or toggle shows the same-day-close figures.
3. **Cumulative R line chart:** kept, vetoed, and the control median.
4. **Recent trades:** date, ticker, AI decision, fill, stop, T1, and result (R and reason, or "ถืออยู่ วันที่
   k/10", or "ไม่ได้เข้า").
5. **Missed days, and the disclaimers:**
   - survivorship bias
   - the earnings and 8-K inputs missing from the replay
   - no edge claim

The page is read-only and makes no AI calls. Thai UI, like the rest of the site. Mockup:
`.superpowers/brainstorm/122-1793652691/content/scorecard-layout.html` (git-ignored; all its numbers are
made up).

## 10. Constraints and traps

- **Next.js 16 has breaking changes.** Read `node_modules/next/dist/docs/` before writing app code.
- **The dev DB is the live Neon DB.**
  - Migrations must be additive.
  - Tests use stubs, never real writes.
  - The live job is meant to write `ChartSetup` rows; nothing else may write them.
- **Never read a forming bar.** Respect `SIP_DELAY_MS` in the run and in scoring.
- **The AI review needs the Claude CLI logged in on this machine.** When the OAuth expires, rows become
  "unread", and Job 2 must make that loud.
- **Do not re-enable the desk's Task Scheduler jobs.** Add the two new tasks only.
- Do not commit `obsidian-vault/` changes.

## 11. Left to the builder

- Table and column names, and how the replay summary is stored.
- The chart component; reuse whatever `/scan` already uses.
- Exact Discord formatting within the content above.
- How the replay caches bars and how long it takes. Report the runtime.
- **What to verify before setting up the Task Scheduler tasks:**
  - `docs/STATE.md` §5 says `stopWatch` assumes it runs before the US open; check whether that applies
    to Job 2 too.
  - Check whether Risk Sentry's 19:00 slot interacts with either job.
