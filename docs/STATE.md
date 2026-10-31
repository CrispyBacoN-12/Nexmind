# NEXMIND — Session State

**Living handoff. Read this first; update it before you finish.**
Auto-loaded every session via `CLAUDE.md`. This file is the current bar, not the archive:
deep evidence is in `docs/quant/`, reasoning is in commit bodies, and the full pre-2026-10-01
text of this file (every desk-era entry, verbatim) is `docs/quant/2026-10-01-state-archive.md`.

_Last verified against the live DB, Task Scheduler and `npm test`: **2026-10-01**._

---

## 1. What this project is

**Since 2026-09-15 it has been an Execution & Risk Copilot, not an alpha-seeking desk.** The owner
decided this explicitly. Finding fully automated alpha on the S&P 500 with $2-3k of capital, whole
shares, about 5 slots and free data conflicts with how the market works. Every price entry rule,
every exit geometry and three non-price data classes were screened, and none survived a deep
hold-out (§3). The repo's value now lives in four surfaces:

- **`/scan`** (first in the sidebar): a button-only scan of the S&P 500 that lists what is moving today,
  with 8-K tags, headlines, the economic calendar and a one-line AI note per row.
  - It ranks activity, not odds. No rule in this repo has passed a hold-out, and the page says so.
  - It runs only when the button is pressed: no auto-run on page load, no schedule.
  - Each row links to `/advisor?ticker=` to prefill the ticker. Nothing auto-submits.
- **`/advisor`**: the owner types a ticker they already chose and gets back structure and risk only:
  - the ATR stop (1.5 × ATR14) and the R ladder in prices
  - whole-share sizing at real capital
  - round-trip cost in R and overnight gap-through risk
  - correlation to holdings, earnings date and the portfolio gates
  
  It never gives a name, a rank or a target (`ADVISOR_NO_EDGE_CLAIM`). Spec:
  `docs/superpowers/specs/2026-09-10-stock-advisory-tool-design.md`.
- **`/journal`**: trade journal + NAV log. The portfolio gates on the advisor card read it.
- **Risk Sentry**: a read-only daily check that sends one Discord alert covering:
  - stop hit
  - earnings this week
  - market-gate flip
  - correlated holdings

**The autonomous desk is paused, and its web layer is gone (2026-10-31, owner request).** It was
SCANNER → HAWK×3 → SAGE → Iron Rules, plus `panel-v1` research. The site is now only `/scan`,
`/advisor` and `/journal`; every archive page and the API routes only they used were deleted (git has them).
The desk's `src/lib` code, research scripts and DB tables are **kept** as reference. Its three Task
Scheduler jobs stay **Disabled**. Do not re-enable them or resume research rounds without a new
owner decision. **Next, by owner request: rebuild AI agents one at a time, design to be discussed.**

Hard context the code does not state:
- **Orders are manual, on Webull, whole shares, $2-3k.** Webull is data-only here. Go-Live is dead,
  not deferred.
- **Dev server is port 3275.** For preview, use launch config `dev:web` (`next dev -p 3275`),
  never `nexmind` (see §5).

## 2. Live state (verified by query, 2026-10-01)

| Thing | Value |
|---|---|
| Branch | `master` **pushed to `origin` 2026-10-30**. Every push auto-deploys Vercel production |
| Tests | `npm test` **959 pass / 0 fail** (2026-10-31, on branch `scan-agent`) |
| Task Scheduler | **`NEXMIND Risk Sentry` Ready** (Mon-Fri 19:00 ICT). `Stocks scan`, `Manage positions`, `Research round` **Disabled** |
| Journal | **0 rows**, 0 `NavSnapshot`, 0 `GateOverride`. So DRAWDOWN/GAP_HEAT read WARN (fail closed) until a NAV is logged |
| Risk Sentry | manual extras `["AAPL","MSFT"]`, `riskSentry:lastGate = above`, `DISCORD_WEBHOOK_URL` set |
| Desk #11 (archive) | `trend-pullback`, status `active` but unscheduled. 3 legacy open paper trades (KO, AZO, XOM); 45 closed, cumulative **−$358.98** |
| Research (archive) | newest `ResearchRun` #113 `skipped`. `panel-v1`: 3, all rejected. Legacy: 6 approved (off-universe, never desk-eligible), 37 demoted, 171 rejected, 1 proposed |
| `Counterfactual` / `AiCall` | 123 rows, last 2026-09-14 / 90 rows |
| `Setting` keys | `fearGreed`, `lastDeskSessionAt`, `riskSentry:holdings`, `riskSentry:lastGate`, `ai:outage`, `webull:accessToken` |
| Worktrees | `.worktrees/xau-v1-phase-0-1`, `.worktrees/xau-v1-phase0-1-unblock`: gold work, **finished** (xau-v1 REJECT, §3), gitignored on master; kept until the owner says delete |

To re-verify, use a throwaway script under `scripts/` and delete it afterwards. It should query:
- `portfolio.findMany`; the field is `status`, not `active`
- `trade.groupBy({by:["status"]})`
- `journalTrade.count({where:{exitDate:null}})`
- `researchStrategy.groupBy({by:["status","validation"]})`

Also run `Get-ScheduledTask -TaskName "NEXMIND*"`.

## 3. Done recently

**Copilot era (newest first):**
- **2026-10-31: Scan agent (`/scan`, `POST /api/scan`). Branch `scan-agent`, commits `6007ba1..HEAD` of branch `scan-agent`. Not merged.**
  - `src/lib/scanAgent/`: TradingView screener client, New York session clock, base filter + triggers +
    activity score, economic calendar, AI notes, and the `runScanAgent` orchestrator (all I/O injected).
  - Only the TradingView fetch is fatal (route returns 502 with the error). Every other source
    degrades to a named `ok: false` entry in the sources strip.
  - Rows beyond the AI's top 30 show "ไม่ได้สรุป (นอก 30 อันดับแรก)", which is not a failure. A row
    priced above the $500 slot carries the fractional-share tag.
  - Data is 15 minutes late and the clock does not know US market holidays. Both are on the page.
  - Final review fixes: the AI-note guard also covers the prompt's forbids (Thai predictions, entry
    calls, rankings) and any SyntaxError is withheld; EDGAR calls are paced (125 ms shared gap,
    Retry-After honoured); `RecentNews.failed` separates a quiet stock from a Finnhub failure; rows
    whose 8-K check failed show "8-K ตรวจไม่ได้"; headlines render under each note.
  - Live check, 2026-10-31 (Saturday, phase closed, session 2026-10-30): covered 473/~503, 135
    passed. SEC 8-K failed for 33 of 135 tickers before the pacing fix (not re-run since). AI was
    unavailable (the CLI OAuth had expired). The Advisor prefill works.
  - `next dev` cannot run in this worktree (junctioned `node_modules`: Turbopack panics, webpack dev
    hung). It was verified with `next build --webpack` + `next start`.
- **2026-10-31: Web layer cut to the copilot. `3a50c1f`.**
  - Kept: `/advisor`, `/journal`, and APIs `advisor`, `advisor/critique`, `journal`, `journal/stops`,
    `portfolio/evaluate`, `cron/risk-sentry`. `/` redirects to `/advisor`.
  - Deleted: 12 pages (War Room, analyze, backtest, research, activity, reports, command, build,
    graph, roster, scoreboard, webull, a-futuristic), `components/office`, `components/research`, 25 API
    routes, and the `research-round` / `cleanup-signals` workflows whose only target was a deleted
    route. The 2 `/api/gold/status` tests went with their route (880 tests now).
  - The Risk Sentry manual-extras editor moved from `/command` to `/journal`, behind the new
    `/api/risk-sentry/holdings`. `globalTradingHalt` and the desk's settings panel are gone.
  - `next build` clean. `scripts/bot.ts` still calls the removed `/api/settings` and `/api/portfolios`.
- **2026-10-30: `/advisor` base-rate columns on the R ladder (idea 3 from day-trader-skill). `0167ea0`, pushed.**
  - `advisor/baseRate.ts` (pure) replays the card's stop (1.5×ATR) and each R rung from the close
    of every session in the 2y history, walked forward at most 20 sessions. It reports target first,
    stop first, neither, and the 1/(1+R) break-even line.
  - Fill conventions never flatter the target: a session touching both counts as stop; a gap-open
    past either side resolves at once; windows running past the last bar are dropped.
  - It is a zero-information entry, so it shows the stock's drift. The card says so and prints the
    buy-and-hold move beside it. Live KO (+59.7% over the sample): 1R first 53.2% vs 50.0% break-even.
- **2026-10-30: Two ideas from day-trader-skill (MIT, read as data, nothing installed). `cf04836`, `9971cff`, pushed.**
  - **Risk Sentry reads SEC 8-Ks.** `src/lib/market/secFilings.ts` (EDGAR submissions API, no key,
    optional `SEC_USER_AGENT`) feeds the pure `riskSentry/filingWatch.ts`. 8-K items are tiered red
    (1.03, 1.05, 2.04, 2.06, 3.01, 4.01, 4.02), notable (1.01, 1.02, 2.01, 2.05, 3.02, 3.03, 5.01,
    5.02) or quiet (2.02, 7.01, 8.01, 9.01 and the rest never alert). Hits sit right after stop hits
    in the message, in New York time with the filing link.
    - Window: `(since, run start]`, with `since` from Setting `riskSentry:filingsCheckedTo` (first
      run 3 days back, cap 14). It advances only when every ticker was read; an EDGAR failure is
      named in the message as "NOT checked", never a quiet all-clear.
    - Live dry run over 60 days on AAPL/MSFT/KO/INTC/BRK-B: one hit (AAPL 8-K/A 5.02).
  - **`/advisor` fill guard** (`advisor/fillGuard.ts`, quote from `market/quote.ts`, Finnhub
    `/quote`). The stop is a price, so a fill above the entry carries more risk than the card sized.
    - Walk-away price: the highest fill where the card's shares still fit both caps. Needs no quote.
    - A quote under 15 min old and above the entry is re-measured against the same stop and
      re-sized. Past the walk-away it also becomes a card warning.
    - Reported, never applied: `sizing` is unchanged. Checked live on KO (entry 90 → quote 94.37:
      5 shares would risk $34.02, i.e. 1.36% of capital; re-sized at that quote: 3 shares).
- **2026-10-30: xau-vp-v1, volume profile on gold. All 3 REJECT. Gold testing is now open-ended.**
  - The owner overrode xau-v1's §0 to test volume profile as an H1 entry an AI agent could trade
    on MT5. It was pre-registered (`7c0c7c9`) and coded (`643b6d8`) before the run.
  - Hypotheses: prior-day value-area re-entry fade ("80% rule"), its acceptance mirror, and #137's
    sweep + VP entry. Four 2017-04+ folds, all TEST. Same exit, costs and control as xau-v1.
  - Results: re-entry p95 0/4; acceptance p95 1/4, only in the 2024-26 bull fold and carried by
    longs; sweep loses money in every fold and misses the trade floors. The control itself loses
    money on gold H1 at these costs, so "beats the median" was a low bar here.
  - The corrected folds also re-ran xau-v1's daily-trend as an audit row. It still fails (p95 2/4),
    so the xau-v1 REJECT was not an artifact of its broken fold table.
  - Evidence: branch `xau-vp-v1` (worktree `.worktrees/xau-vp-v1`), `docs/quant/2026-10-30-xau-vp-v1-results.md`,
    `scripts/xau-vp-screen.log`, commit `e854fdc`. Not merged to master.
  - The run carried a stop rule (all REJECT closes gold). **The owner dropped it after the run** and
    chose open-ended gold testing. The guard that replaces it is `docs/quant/xau-test-ledger.md` on
    branch `xau-vp-v1`. Every gold rule is logged there, the bar does not loosen as the count rises,
    and a PASS stays provisional until it also holds on bars after 2026-09-18, which no test has read.
    Round 3 (plain 20-bar sweep, EMA 20/50 cross) is pre-registered in `5777a8f`.
  - The AI-agent order path is not built. It waits on a rule that clears the forward check.
- **2026-10-29: Copilot polish shipped (owner sign-off in chat).**
  - `/journal` runs Risk Sentry's `stopWatch` on demand through the new `GET /api/journal/stops`.
    Each open row shows a red "closed below stop" or amber "low traded through stop" badge, and
    tickers with no candles are listed as unchecked. The same bar-still-forming caveat applies.
  - `/advisor`'s holdings field prefills from open journal positions until the owner types or
    submits.
  - Checked in the browser with a stubbed `fetch` only. No test rows were written, because the dev
    DB is the live Neon DB. `*.ex5` is now gitignored.
- **2026-10-13: Gold strategies exported to MQL5 (owner request, committed `1010f4d`).**
  - `mql5/`: 56 EAs cover all 60 non-mock `GC=F` research rows and the 4 xau-v1 hypotheses.
    `mql5/Experts/NEXMIND_Gold/NexCore.mqh` (next to the EAs, quoted include) ports `indicators.ts`, `computeSnapshots` and the
    single-target/trail exits. Install steps and every deviation are in `mql5/README.md`.
  - All 56 compile with 0 errors and 0 warnings. Parity with the TS backtester was **not** run.
  - This is for re-running backtests in the MT5 tester. It does not reopen gold: the xau-v1 REJECT
    and §0 still stand.
  - MetaEditor's `/compile:` fails silently on a path with a space (`CLAUDE WEB`). Copy the tree
    to a path without spaces to compile from the command line.
- **2026-10-01: xau-v1 gold validation ran. All 4 hypotheses REJECT; XAUUSD is closed.**
  - The owner chose to validate the pre-registered xau-v1 screen (H1, Exness `XAUUSDm`, 5 folds,
    `LADDERS.flat`, p90 cost) before any MT5 bridge or order work. No orders were placed.
  - mr-down3, session-break and asia-fade fail on the edge lines alone. daily-trend was the
    near-miss (p95 3/5, median 5/5) but bootstrap is 2/5, one p95 "beat" is a tie on a losing
    fold, and its lift is long-side drift.
  - Per pre-registration §0, failing closes gold as an instrument: **no other timeframe,
    parameter or ladder**. Phase 2 of the unblock plan (MT5 bridge, risk gates, demo orders) is
    dead.
  - Disclosed, not amended (§9): the fold table was unpassable for everyone (`xtest1` is 12
    months vs a 24-month floor; `xfit` has 613 bars vs a 200-trade floor). The first run's swap
    column read 0.000 because `pointValuePerLot` was missing; it is fixed and the verdicts are
    byte-identical. Swap is still reported beside avgR, not subtracted from it.
  - Evidence lives on branch `xau-v1-phase0-1-unblock`: `docs/quant/2026-10-01-xau-v1-results.md`,
    `scripts/xau-screen.log`, commits `08ff7b0` and `2ed722d`.
- **2026-10-01: Risk Sentry runs locally.**
  - Task `NEXMIND Risk Sentry` runs `scripts/risk-sentry.cmd` → `risk-sentry.mts`, with the same
    deps as `/api/cron/risk-sentry`. The log is `scripts/risk-sentry.log` (gitignored).
  - It runs at 19:00 ICT, which is 12:00 UTC and before the US open, so the last bar is a finished
    session.
  - First run returned 0 with gate `unknown→above`. The owner added the webhook the same day and a
    test message was delivered.
  - Commits: `8cfffa9`, `06174fd`.
- **2026-10-01: Risk Sentry watches open journal positions** (`070382d`).
  - It merges open `JournalTrade` tickers with the manual extras list (deduped, capped at 20,
    manual names dropped first).
  - The new **`stopWatch`** check (`e35cde7`) looks at the last bar of each journal position:
    - close at or below the stop is `breached`
    - low at or below the stop with the close above it is `touched`
  - Stop hits lead the message. Manual names carry no stop, so they are never stop-checked.
- **2026-09-27: Test B, residual momentum as the mr-down3 slot queue: FAIL.** This is final.
  - Pre-registered in `df0f51a` before the simulator existed.
  - S = +0.0125 over 2,473 trades. The random-queue walks had a median of −0.0016 and a p95 of
    +0.0314, so S never cleared the p95.
  - Write-up: `docs/quant/2026-09-27-test-b-results.md`. This closes the portfolio-layer plan.
- **2026-09-27: Portfolio layer** (`63837ef`).
  - `src/lib/portfolio/` (pure) has `evaluatePortfolio` with six gates: CAPACITY, SECTOR ≤2/GICS,
    CORRELATION ρ>0.70, REGIME, DRAWDOWN −3%/−8%/−15%, GAP_HEAT >10% NAV.
  - A missing input fails closed at WARN.
  - Overrides need a written reason and are logged to `GateOverride`.
  - Also built: `sectorMap.ts` (Finnhub industry → GICS), `/journal`, `/api/portfolio/evaluate`
    and `dateAlignedCorrelation`.
- **2026-09-25: Overnight gap-through risk on `/advisor`** (`gapRisk.ts`).
  - The worst adverse gap over 2y, in stops: G = gap ÷ (1.5 × ATRₜ₋₁).
  - It is disclosed and never applied to sizing. It is a floor on the tail, not a ceiling.
- **2026-09-17: The 88-file backlog became 10 scoped commits; Risk Sentry merged.**
  - Commits `b7ac7b0..0176cfd`.
  - Risk Sentry merge: `fd2d76f`.
  - Broken HEAD imports in `mt5.ts` were fixed in `bb70cd8`.
- **2026-09-16: Risk Sentry v1.** It runs three read-only checks over the `Setting`-stored
  holdings. Plan: `docs/superpowers/plans/2026-09-16-risk-sentry.md`.
- **2026-09-15: Pivot to copilot.** The sidebar puts Trade Advisor first and labels everything
  else "(archive)". No advisor arithmetic changed.
- **2026-09-14: Advisor card additions and new cost accounting.**
  - The card carries the real Finnhub earnings date. It is reported and never acted on.
  - `AiCall` ledger: the CLI path had been undercounting tokens by about 99.9% (cache tokens were
    dropped).
  - `RESEARCH_COST_MODEL` went from 0.5 to **5 bps** (`EQUITY_COST_MODEL`). Never pool verdicts
    across that date.
- **2026-09-11: `/advisor` shipped** (`9bcae76..859331a`). The route now returns a 400 for any
  present-but-unparseable numeric field. It used to fall back silently and fabricated a risk %.

**Desk era, one line each.** Full text is in the archive file; studies are in `docs/quant/`.
- 09-15 **Exit-geometry axis closed**: every ladder, trail and `maxBars` time stop "passes" on
  random entries only by collecting long-side drift.
- 09-15 **13F ownership network** is too narrow to build: it recovers only REITs and spinoff pairs.
  The owner stopped the data-class search here; Wikipedia pageviews was never tested.
- 09-14 **Insider Form 4** (raw and role-weighted) rejected both ways. The fade side made money but
  lost to its own control.
- 09-14 **News sentiment**: no free source is point-in-time back to 2016, so nothing was built.
  Earlier ATR-trail activation was also rejected at SELECT.
- 09-14 **Broad-universe (1,173 names) weekly replication**: not one verdict flipped.
  `scanAttemptsPerSlot = 4` capped the desk's analyst spend.
- 09-14 **mr-down3 Webull cost realism**: the probe's verdict that mr-down3 "survives" applied to
  the untradeable daily close fill only.
- 09-08 Weekly bars: mr-down3 and gap-fade cleared FIT/SELECT/TEST, then were **REJECTED on the
  2000-16 deep hold-out**. The weekly random control pays +0.11..+0.17 there.
- 09-08 Earnings timing (PEAD drift/fade) rejected both ways. Classic RSI/Bollinger beat their
  control while losing money and were rejected.
- 09-05 mr-down3 passed the *daily close-fill* deep hold-out, which no one can trade at
  (`2026-09-05-deep-holdout.md`). The exit-control null `runExitControl` was built.
- 09-03/05 **The entry rule is late**: it loses to random entry in 30/30 cells. Relaxing gates
  failed 8/8 and anticipating failed 4/4 (`2026-09-03-entry-lateness.md`).
- 09-02 Three "0 fills" defects fixed: forming-bar volume, truncated votes, and `combo-vote`
  silently acting as an AND. Desk moved to `trend-pullback`.
- 08-30 Live feed is Alpaca-first; placeholder bars are dropped; the gate refuses a series more
  than 50% from its SMA200. Webull data moved to production. The CLI "spend limit" message now
  latches.
- 08-26 Baseline `decideSetup()` loses to random in 10/10 cells across two disjoint universes.
  Six mechanisms screened; gap-fade died at the open fill.
- 08-25 Walk-forward panel validation (`70fcec6`): FIT 2016-18, SELECT 2019, TEST ×3. Survivors
  must be `approved` + `panel-v1`. Mock fallbacks were cut.
- 08-23/24 All 13 confluence filters rejected. The ATR trail 1.5/1.5 passed IS/OOS but was never
  shipped. Stocks-only pivot.

## 4. Next steps

There are no open research directions; the owner closed the search. Work items:
1. **Use the journal.** Open positions through `/journal` and log NAV so that the following have
   real input:
   - DRAWDOWN and GAP_HEAT, which stop failing closed at WARN
   - Risk Sentry's `stopWatch`
   
   This is the owner's workflow, not code.
2. **Check that Risk Sentry keeps running.** Read `scripts/risk-sentry.log` and the task's
   `LastTaskResult` after a few weekdays.
3. **Housekeeping, the owner's call:**
   - delete the two `xau-*` worktrees/branches and `wip/mt5-xauusd`, or keep them as the
     evidence trail for the xau-v1 REJECT. Gold is closed either way.
   - decide whether `stocks-only-pivot` is deleted (fully merged into master)

## 5. Traps — read before touching these areas

**Process:**
- **Preview with `dev:web`, never `nexmind`.** `nexmind` runs `scripts/dev.mts`, which
  spawns a real desk session that spends Claude budget. This happened on 2026-09-15.
- **Keep `vercel.json` `crons: []`.** A push to `master` auto-deploys Vercel production, and
  Risk Sentry runs locally by decision (`8cfffa9`). On 2026-10-29 a push briefly deployed a
  12:00 UTC Vercel cron in the local task's slot; it was reverted the same day.
- **Never start a dev server with Bash.** It outlives the turn and holds port 3275. After a cold
  start, the first `navigate` fails while Next compiles; check `preview_logs` for "Ready in".
- **`scripts/*.cmd` must be ASCII-only.** An em-dash broke cmd.exe under the Thai codepage.
- **Every `.cmd` script must start with `node --env-file=.env --import tsx`.** A bare tsx sees no
  keys.
- **`next dev` caches the AI backend probe and the Prisma client.** Restart it after
  `prisma generate`.
- **Never echo `.env` values.** Never print or persist the Webull token.
- **Next.js 16 has breaking changes.** Read `node_modules/next/dist/docs/` before writing app code.

**Web layer (reviewers get these wrong):**
- `fmtPct` divides by 100, and `*Pct` fields are already in percent units. Passing a `*Pct` field to
  it is correct.
- `Stat` renders its own `<Card>`.
- Nothing under `src/app/` has tests, by design.
- `npm run lint` has about 263 pre-existing problems. Judge lint only on the files you touched.

**Risk logic:**
- **Correlation, gap risk and the earnings date are disclosed, never applied to size.** The one
  exception is the portfolio DRAWDOWN gate's size cut, which applies even when overridden.
- **The card's `pearsonCorrelation` zips series by trailing index; the gate's
  `dateAlignedCorrelation` pairs them by date.** Do not swap one for the other.
- **`stopWatch` assumes the run happens before the US open (12:00 UTC).** Run it during a session
  and the last bar is still forming. It checks journal positions only and assumes long-only
  (stop below entry).
- **Under `strictMode: true`, DRAWDOWN safe mode never releases.** A flat book's NAV cannot recover
  past −15%. Read the per-fold trade counts of any simulator run with that in mind.
- **A failure classifier is only as good as the strings it was tested against.** `FATAL_BACKEND`
  missed "spend limit". Never match bare `limit`, because a rate limit should be retried.

**Research (if it is ever reopened):**
- **Quote the margin over the matched random-entry control, never a raw avgR.** Drift makes any
  long-biased rule look good. Read the control's own level as well: a weekly control paid
  +0.11..+0.17 on the deep folds.
- **Use `runControl` for an entry claim and `runExitControl` for an exit claim.** A change that
  moves both is two claims and passes neither gate.
- **Every exit result needs a long/short split before it is believed.**
- **Do not re-tune any of these** (rejected, with evidence in `docs/quant/` and the archive):
  - the 13 confluence filters
  - cross-sectional mean reversion and cross-sectional momentum
  - breadth and realized-vol regime features
  - regime × side
  - entry relaxation and anticipation
  - all `LADDER_OPTIONS`, trails and `maxBars`
  - the six screened mechanisms
  - insider, earnings-timing and 13F data
  - universe swapping
  - any XAUUSD rule already in `docs/quant/xau-test-ledger.md` (branch `xau-vp-v1`). Gold testing is
    open-ended by owner decision, but a rejected row is never re-tuned, and a new rule gets a new
    ledger row and its own pre-registration first
- **"Add one more confirmation" is predicted to fail**, because the entry rule is already late.
  Lateness numbers past t−3 are lookahead, not edge.
- **Pre-registered constants:**
  - `PANEL_SEED`
  - `MIN_HOLDOUT_RETENTION = 0.5`
  - the TEST folds, which must be ANDed
  - `MIN_RISK_FRACTION` (it exists because a 1e-14 risk passed `risk > 0`)
- **Never restore a mock fallback that can decide anything.**
- **Live trading cannot measure an edge:** SE ±0.31R against effects of about 0.04R.
- **Yahoo `range=max` silently returns weekly or monthly bars.** Use `period1`/`period2` and
  check `isDailySeries`.
- **The 2016 floor is an Alpaca inception artifact.** Yahoo has data back to 1998.

## 6. Blocked on the user (still open)

- **Dormant, only if a cloud schedule is ever re-enabled:**
  - Vercel has no `ANTHROPIC_API_KEY`.
  - The GH runner's CLI produced `mock`, and why is unexplained.
  - The `FINNHUB_API_KEY` Actions secret is empty. The owner sets it; do not handle the key.

## 7. Housekeeping for whoever writes here next

1. Update §2 only from a **real query**, never from what this file used to say.
2. Move anything finished out of §4 into §3 with its commit hash.
3. A rejected mechanism goes in §5 so it is never re-tuned; link its `docs/quant/` file.
4. Keep this file under ~150 lines. When §3 grows, compress its oldest entries to one line each.
   Never paste a study into this file.
