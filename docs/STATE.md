# NEXMIND — Session State

**Living handoff. Read this first; update it before you finish.**
Auto-loaded every session via `CLAUDE.md`. This file is the current bar, not the archive:
deep evidence is in `docs/quant/`, reasoning is in commit bodies, and the full pre-2026-10-01
text of this file (every desk-era entry, verbatim) is `docs/quant/2026-10-01-state-archive.md`.

_Last verified: `npm test` and the `ChartSetup` row count on **2026-11-01**; the Task Scheduler and the other §2 rows on **2026-10-01**._

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
  - **Chart setups panel (branch `chart-agent`, not merged):** a second button runs the chart agent
    over the top 20 scan names and opens a modal of at most 5 long-sweep setups (§3).
- **`/advisor`**: the owner types a ticker they already chose and gets back structure and risk only:
  - the ATR stop (1.5 × ATR14, or the chart stop when `?stop=` is given) and the R ladder in prices
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
owner decision. **Next, by owner request: rebuild AI agents one at a time. Agent #1 (`/scan`) and
#2 (the chart agent) are built; the next agent is to be discussed.**

Hard context the code does not state:
- **Orders are manual, on Webull, whole shares, $2-3k.** Webull is data-only here. Go-Live is dead,
  not deferred.
- **Dev server is port 3275.** For preview, use launch config `dev:web` (`next dev -p 3275`),
  never `nexmind` (see §5).

## 2. Live state (verified by query, 2026-10-01 unless a row is dated)

| Thing | Value |
|---|---|
| Branch | `master` = `origin/master` at `a2739d4` (2026-11-01). Every push auto-deploys Vercel production. `chart-agent` is a separate branch, **not merged** |
| Tests | `npm test` **1057 pass / 0 fail** (2026-11-01, on branch `chart-agent`) |
| `ChartSetup` | **0 rows** (2026-11-01, `prisma.chartSetup.count()`). Nothing has been logged yet, and the table only exists on the live Neon DB |
| Task Scheduler | **`NEXMIND Risk Sentry` Ready** (Mon-Fri 19:00 ICT). `Stocks scan`, `Manage positions`, `Research round` **Disabled** |
| Journal | **0 rows**, 0 `NavSnapshot`, 0 `GateOverride`. So DRAWDOWN/GAP_HEAT read WARN (fail closed) until a NAV is logged |
| Risk Sentry | manual extras `["AAPL","MSFT"]`, `riskSentry:lastGate = above`, `DISCORD_WEBHOOK_URL` set |
| Desk #11 (archive) | `trend-pullback`, status `active` but unscheduled. 3 legacy open paper trades (KO, AZO, XOM); 45 closed, cumulative **−$358.98** |
| Research (archive) | newest `ResearchRun` #113 `skipped`. `panel-v1`: 3, all rejected. Legacy: 6 approved (off-universe, never desk-eligible), 37 demoted, 171 rejected, 1 proposed |
| `Counterfactual` / `AiCall` | 123 rows, last 2026-09-14 / 90 rows |
| `Setting` keys | `fearGreed`, `lastDeskSessionAt`, `riskSentry:holdings`, `riskSentry:lastGate`, `ai:outage`, `webull:accessToken` |
| Worktrees | `.worktrees/xau-v1-phase-0-1`, `.worktrees/xau-v1-phase0-1-unblock`, `.worktrees/xau-vp-v1`: gold work, **finished** (§3), gitignored on master; kept until the owner says delete. `.worktrees/chart-agent` is the live branch above |

To re-verify, use a throwaway script under `scripts/` and delete it afterwards. It should query:
- `portfolio.findMany`; the field is `status`, not `active`
- `trade.groupBy({by:["status"]})`
- `journalTrade.count({where:{exitDate:null}})`
- `researchStrategy.groupBy({by:["status","validation"]})`
- `chartSetup.count()`

Also run `Get-ScheduledTask -TaskName "NEXMIND*"`.

## 3. Done recently

**Copilot era (newest first):**
- **2026-11-01: Chart agent (agent #2) on `/scan`. Branch `chart-agent`, commits `09a68ad..HEAD` (`git log --oneline a2739d4..HEAD`). Not merged.**
  - What it does: reads the top 20 scan names on Alpaca SIP 5-minute bars. Per name it builds the
    previous-session volume profile (50 bins, 70% value area), PDH/PDL, PMH/PML and dPOC.
  - The one setup is a **long sweep** of PDL, PML or pVAL: the sweep bar opens above L, trades below
    it, closes above it, and the latest close is above L. Stop = sweep low − 0.1 × daily ATR14.
    T1/T2 are the next structural levels above. A setup under 1.5R carries a tag.
  - The AI (sonnet) writes a Thai reading per setup and may veto it; a guard strips predictions,
    entry calls and rankings. At most 5 setups show in a modal, the capped count is shown, and
    `/scan` links each to `/advisor?ticker=&entry=&stop=`.
  - **`ChartSetup` table logs every setup** with `ruleVersion` `"sweep-v1"` and a status (`shown`,
    `ai_rejected`, `guard_stripped`, `capped`). It exists to be scored later (§4). A logging
    failure shows on the panel and never blocks it.
  - **`/advisor` takes `?entry=&stop=`.** `stopAtrMult` (the chart stop in ATR units, default 1.5)
    flows through sizing, the R ladder, cost, gap risk, the fill guard, the base rate and the AI
    critic's facts sheet, so a chart-stop card is measured at its own stop.
  - Safety: bars ending after now − the 15-minute SIP delay are dropped (a forming bar is never
    read), and a run superseded by a newer click aborts before it spends AI or logs a row.
  - Live probe, 2026-11-01, real Alpaca bars with the clock set to Fri 2026-10-30 14:30 ET, log a
    no-op, no DB writes: before the from-below fix a gap-down name (DVA) read as a sweep. After the
    fix, DVA reads "no sweep yet", and two setups showed (KVUE PDL+pVAL 0.25R tagged, WDC PML 1.23R).
    The browser check showed the modal, levels on the chart, the R table, the footer and the
    Advisor prefill with 0 console errors (stubbed result; the live API returned "market closed").
  - **No backtest. The sweep rule is a description, not an edge.** It was never tested on stocks;
    its nearest relative, xau-vp-v1's gold sweep, lost money in every fold.
  - The AI is unavailable until `claude login` (the CLI OAuth expired; setups then show as unread).
  - Review: 16 controller rulings and a final fix wave (`896de01..91ea356`) are in the SDD ledger, `.superpowers/sdd/2026-11-01-chart-agent/progress.md` (worktree-local).
- **2026-10-31: Scan agent (`/scan`, `POST /api/scan`). Merged to master and pushed (branch deleted).** Commits `6007ba1..b225df6`.
  - `src/lib/scanAgent/`: TradingView screener, New York session clock, filter + triggers + activity
    score, economic calendar, AI notes, `runScanAgent` (all I/O injected). Only the TradingView
    fetch is fatal (502); every other source degrades to a named `ok: false` entry.
  - Rows beyond the AI's top 30 show "ไม่ได้สรุป (นอก 30 อันดับแรก)", which is not a failure. A row
    above the $500 slot carries the fractional-share tag. Data is 15 minutes late and the clock
    does not know US holidays; both are on the page. EDGAR calls are paced (125 ms shared gap).
  - Live check 2026-10-31 (Saturday): covered 473/~503, 135 passed, AI unavailable. `next dev`
    cannot run in a worktree with a junctioned `node_modules`; verify with `next build --webpack` + `next start`.
- **2026-10-31: Web layer cut to the copilot (`3a50c1f`).** Kept `/advisor`, `/journal` and their APIs; deleted
  12 pages, `components/office`, `components/research`, 25 API routes. The Risk Sentry extras editor moved to
  `/journal`. `scripts/bot.ts` still calls the removed `/api/settings` and `/api/portfolios`.
- **2026-10-30: `/advisor` base-rate columns on the R ladder (`0167ea0`).** `advisor/baseRate.ts` replays the
  card's stop and each R rung from every close in 2y, 20 sessions forward; both-touched counts as stop. It is a
  zero-information entry, so it shows drift (the card prints buy-and-hold beside it).
- **2026-10-30: Risk Sentry reads SEC 8-Ks; `/advisor` fill guard (`cf04836`, `9971cff`).** 8-Ks are tiered
  red/notable/quiet (`riskSentry/filingWatch.ts`); an EDGAR failure is "NOT checked", never a quiet all-clear.
  The fill guard (`advisor/fillGuard.ts`) reports a walk-away price and a re-sized card when the quote is above the
  entry. Reported, never applied.
- **2026-10-30: xau-vp-v1, volume profile on gold. All 3 REJECT; gold testing is open-ended.** Branch `xau-vp-v1`,
  `docs/quant/2026-10-30-xau-vp-v1-results.md`. Sweep + VP lost money in every fold. The owner dropped the stop rule
  and chose open-ended testing under `docs/quant/xau-test-ledger.md` (branch `xau-vp-v1`): every rule logged, the bar
  never loosens, a PASS stays provisional until it holds on bars after 2026-09-18. No order path is built.
- **2026-10-29: Copilot polish.** `/journal` runs `stopWatch` on demand (`GET /api/journal/stops`); `/advisor`
  prefills holdings from open journal positions.
- **2026-10-13: 56 gold EAs exported to MQL5 (`1010f4d`).** `mql5/README.md`; compile from a path without spaces.
  Parity with the TS backtester was not run.
- **2026-10-01: xau-v1 gold validation. All 4 REJECT; XAUUSD closed** (branch `xau-v1-phase0-1-unblock`,
  `docs/quant/2026-10-01-xau-v1-results.md`). Disclosed, not amended: the fold table was unpassable for everyone.
- **2026-10-01: Risk Sentry runs locally** at 19:00 ICT (`scripts/risk-sentry.cmd`, log `scripts/risk-sentry.log`)
  and watches open journal positions with `stopWatch` (`8cfffa9`, `06174fd`, `070382d`, `e35cde7`).
- **2026-09-27: Test B, residual momentum as the mr-down3 slot queue: FAIL, final** (`docs/quant/2026-09-27-test-b-results.md`).
  Same day: portfolio layer with six gates (`63837ef`), `/journal`, `/api/portfolio/evaluate`.
- **2026-09-25: overnight gap-through risk on `/advisor`** (`gapRisk.ts`). **09-17:** 88-file backlog became 10 scoped
  commits (`b7ac7b0..0176cfd`). **09-16:** Risk Sentry v1. **09-15:** pivot to copilot.
- **2026-09-14: Finnhub earnings date on the card; `AiCall` ledger fix; `RESEARCH_COST_MODEL` 0.5 → 5 bps.** Never
  pool verdicts across that date. **09-11:** `/advisor` shipped (`9bcae76..859331a`).

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
1. **Use the journal.** Open positions through `/journal` and log NAV so that DRAWDOWN and GAP_HEAT stop
   failing closed at WARN and Risk Sentry's `stopWatch` has input. This is the owner's workflow, not code.
2. **Check that Risk Sentry keeps running.** Read `scripts/risk-sentry.log` and the task's
   `LastTaskResult` after a few weekdays.
3. **Chart agent, owner decisions still open** (none are built):
   - merge `chart-agent`, or keep testing it on a few live sessions first (`claude login` is needed for the AI)
   - a **stricter sweep rule** that also rejects a retest after a gap-down reclaim, i.e. no regular close at
     or below L earlier today. It drops reclaim-retest patterns, so it is the owner's call
   - **chart label overlap** when levels sit close together (pVAL/T1, PDL/PMH on DVA)
   - whether `ChartSetup` rows written from the **public Vercel URL** should be logged: the route is unauthenticated
   - a **scoring spec** for the logged setups: T1-before-stop rate against a random-entry control, pre-registered
     before any row is read, with `ruleVersion` held fixed
4. **Housekeeping, the owner's call:**
   - delete the `xau-*` worktrees/branches and `wip/mt5-xauusd`, or keep them as the evidence trail. Gold is closed either way.
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

**Chart agent:**
- **`ChartSetup.ruleVersion`: bump `CHART_RULE_VERSION` whenever the sweep/setup rule changes; never
  pool rows across versions.** It is `"sweep-v1"` today. The 2026-11-01 from-below fix shipped before any row existed.
- **The sweep rule is a description, not an edge. It has no backtest.** Do not present a setup, its R or its
  AI reading as odds. A bar must open above L: without that, every gap-down reclaim reads as a sweep.
- **Never read a forming bar.** Bars ending after now − the SIP delay are dropped; keep that in any new reader.

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

- **AI features need `claude login`.** The CLI OAuth expired; `/scan` notes and the chart agent's readings show as unavailable until then.
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
