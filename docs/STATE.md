# NEXMIND — Session State

**Living handoff. Read this first; update it before you finish.**
Auto-loaded every session via `CLAUDE.md`. Dated deep-dives live in `docs/quant/`; the
reasoning behind each change lives in its commit body. This file is the current bar, not
the archive.

_Last verified against the live DB + working tree: **2026-08-25**, branch `stocks-only-pivot`._

---

## 1. What this project is

Multi-agent AI trading guild (Next.js 16 · Prisma 7 · Neon Postgres). **US stocks only**,
**paper mode**, no broker API. Pipeline: SCANNER (no AI) → HAWK×3 vote → SAGE veto →
Iron Rules (pure code) → simulated fill. See `README.md` for the architecture; do not
duplicate it here.

Hard context the code does not state:

- **Webull is data-only.** Its trading API can't be reached unattended; the shadow-execution
  path was removed 2026-08-22. Real orders are manual.
- **Real capital is $2–3k on Webull, whole shares only.** No fractional sizing → ~5 usable
  slots. Validate unconstrained first, then restate results at $2–3k.
- Go-Live is deferred and unscheduled. Nothing goes live until an arm comparison shows the
  analysts beat the rule-only baseline.

## 2. Live state (verified by query, 2026-08-25)

| Thing | Value |
|---|---|
| Portfolios | **one**: #11 "US Stocks Desk", active, kill switch off, 5 slots, $10k paper |
| Desk #11 strategy | **`combo-vote`** (built-in) — no longer `research-29` |
| Open trades | 4 (KO, AZO, XOM, KMX), all `aiBackend = "mock"` |
| Closed trades | 35, cumulative **−$378.87** |
| AI backend on every trade ever | `mock` (45) or null (2) — **HAWK/SAGE have never decided a real trade** |
| As of 08-25 | desk **opens nothing** without a real backend (§3); runtime moved **local**, where the CLI backend is live-verified |
| `Counterfactual` rows | 3 (was 0 — the arm recorder finally fires; sample far too small) |
| `ResearchStrategy` | **6 approved** / 171 rejected / 37 demoted / 1 proposed (34 mock rows demoted 08-25) |
| …those 6 | all `legacy-single-symbol`, on **BTC-USD / GC=F / NG=F** — **0 desk-eligible** (`npx tsx scripts/list-survivors.mts`) |
| `ResearchRun` | 109 rows, 102 `done` — but only **#110** was ever AI-proposed (§3) |
| Schema | `blindTest`, `exitLadder`, `demotedReason`, **`validation`** columns are pushed and live |
| `validation` on every existing row | `legacy-single-symbol` (the column default) — so **0 rows are desk-eligible** until one passes a panel round (§3) |

Re-verify with a throwaway script under `scripts/` (delete it afterwards) querying
`portfolio.findMany` (the field is `status`, **not** `active`),
`trade.groupBy({ by: ["status"] })` and `researchStrategy.groupBy({ by: ["status"] })`.

## 3. Done recently (2026-08-23 → 08-25)

Older entries are compressed to one line each; their reasoning is in the commit bodies.

- **Stocks-only pivot finished.** Gold/forex/crypto/options desks and watchlist seeds gone.
- **All 13 confluence filters rejected** IS/OOS — loop closed (§5),
  `docs/quant/2026-08-23-confluence-filter-sweep-results.md`.
- **Exit-geometry sweep**: ATR **trail 1.5/1.5 passed the full protocol**, and stayed passing
  after `score()` was risk-normalised to compute PF over R rather than lot-1 dollars.
  Evidence only, **shipped nowhere** — §4d and
  `docs/quant/2026-08-24-exit-geometry-sweep-results.md`.
- **Research pipeline rigor** (86d489b → 565fd55): approval gated on a held-out blind test
  that fails **closed**; #7, #28 and **research-29** retro-demoted by
  `revet-research-strategies.mts`; each candidate sweeps and carries its own `exitLadder`.
  Desk #11 is off research-29.
- **The loop can now pick the validated trail** (a70c1c4). `sweepLadder` selects on **avgR**,
  not dollar PF. Two side effects worth knowing: **1.0 and 1.2 are gone from
  `LADDER_TP_MULTS`** (sub-1:1 against the 1.5 ATR stop, so §4c is legacy-only), and the old
  `profitFactor ?? -Infinity` had ranked a zero-loss ladder strictly *worst* — no trail could
  ever have won that comparison.
- **Blind-test gate was broken; fixed** (0c43b2e). Cause was **silent provider truncation**,
  not the 400-day floor: Webull caps every request at 1200 bars (~256 days at `1h`) and
  `fetchCandles` accepted that short response as data, so both `DEEP_RANGES` hit the cap and
  **every intraday candidate was rejected forever** — non-deterministically, since the verdict
  followed whichever flaky provider answered. `fetchCandles` now takes `minDays` and treats a
  short response as a miss (Yahoo stays last, so genuinely young listings still return).
  `runBlindTest(212)` returns **236 held-out trades / 3981 bars / 364 days**.
- **Mock cycle cut, both halves.** Research (4dd946d): `isBankableRound` fails closed on a
  mock-proposed round — banked `skipped` with zero strategies instead of persisting the
  `Mock *` snippets as approvable research (manual candidates exempt). Backlog purged: 87 rows
  matched by **exact code** against `mockCandidates()`, the 34 still approved demoted, none
  live on a portfolio. Desk (8cbfea0): `runTradeTick` returns **`no-ai-backend`** instead of
  opening, and both *mid-flight* fallbacks refuse the same way — the SAGE one had been turning
  the risk veto into a rubber stamp exactly when risk review was unavailable. `manage.ts` has
  no AI dependency and is untouched, so open positions still exit normally.

- **Validation replaced with a walk-forward panel** (70fcec6) — the whole of §4f and the §6 window-policy
  blocker, closed. `docs/PROPOSAL-panel-validation.md` is now a record of what was built, not a
  request. Seven steps, all shipped:
  `panel.ts` (491-symbol cache, five disjoint folds, 250-bar Wilder warm-up, never falls back to
  a live fetch) · entry/exit separation in the sweep · `control.ts` (matched random-entry control
  + monthly block bootstrap, both on a fixed `PANEL_SEED` so a verdict reproduces from the cache
  alone) · research fits on **FIT 2016-2018** and is gated on **SELECT 2019** ·
  `runBlindTest` measures **TEST 2020-21 / 2022-23 / 2024-26** and requires **all three**, ANDed
  not averaged (research-29 is why) · a `validation` column with `getResearchStrategy` as the
  single enforcement point · the rotation moved to weekly.
  Three things worth carrying forward:
  **(1)** the proposal's expanding-window layout was *not* shipped — split 3's TRAIN contained
  splits 1-2's TEST windows, so a candidate required to pass all three splits would have been
  fitted to the folds it had already survived. One FIT + one SELECT + three later TEST folds is
  the only layout that keeps every TEST fold untouched at once.
  **(2)** a round measures **8-10 min**, not the 1-2 h the proposal estimated, so weekly rests on
  **multiple testing** (3/week ≈ 156 tests/yr vs 3/day ≈ 1,100 against a p95 bar), not on cost.
  **(3)** every removed parameter **refuses** rather than being ignored: `runResearch` lost its
  `symbol`/`interval`/`range` params, `POST /api/research` 400s on them, the UI pickers are gone,
  and seven `scripts/dispatch-*.ts` one-offs were deleted (git retains them).
  Tests: **356 pass / 0 fail**; `panel.test.ts` asserts the folds are disjoint and correctly
  ordered, so the layout cannot drift silently.
- **First real research round** — run **#110**, 08-25, fired through Task Scheduler:
  `status: done` with three novel mechanism labels. The proposer had never actually run
  before; all 109 prior rounds banked mocks. All three were rejected by `autoReview` on 4–5
  trades, which is the in-sample gate working. **Trap: `costUsd = 0` no longer proves a round
  was mock** — the CLI backend bills $0 too. Check labels against `mockCandidates()` instead.
- **Blind-test pass bar raised** (158df23). It ran, but asked almost nothing: ≥20 held-out
  trades and `expectancy > 0`, which passed a candidate that fell from **in-sample avgR 0.63
  to held-out 0.063**. `evaluateHoldout` now also requires held-out PF ≥ `MIN_PROFIT_FACTOR`
  (the same 1.1 `autoReview` applies in-sample — asking it only of the fitted half was asking
  the easy question twice) and held-out ≥ **50%** of the in-sample edge
  (`MIN_HOLDOUT_RETENTION`), compared on **avgR** where both sides have it because dollar
  expectancy scales with the period's ATR level. 0.5 was **pre-registered before looking at
  any further candidate** and is the conventional walk-forward bar, chosen for being
  conventional rather than fitted here. The 6 legacy approvals were *not* re-vetted against
  it — they have no blind test at all (§4b).
- **Runtime moved local** (6eab8bf). Both Actions `schedule:` triggers are commented out
  (`workflow_dispatch` kept, and each file carries its re-enable condition); `vercel.json`
  crons were already `[]`, so **nothing in the cloud can open a trade or bank a strategy** —
  Vercel is the read-only UI. (`cleanup-signals.yml` is still scheduled weekly by design; it
  curls Vercel for pure DB maintenance and decides nothing.) The backend was verified by a
  live `callAgent` returning `cli:haiku`, *not* by a `claude --version` probe, which passes on
  an expired login. Three scheduled tasks remain, all intended: `Stocks scan` 05:00,
  `Manage positions` /15min, `Research round` 06:00; the four dead desk tasks are
  unregistered. `~/.local/bin` is on the persisted **User** PATH, so Task Scheduler resolves
  the CLI too.
- **The survivor condition is now readable from three places** — it was previously derivable
  only by reading `adapter.ts`. It is `status="approved" AND validation="panel-v1"`, and it is
  unforgeable: `applyBlindTestVerdict` rewrites status to `rejected` on anything short of
  `passed` on all three TEST folds, **errors included** (fails closed), and
  `adapter.getResearchStrategy` filters on the same pair — so the desk stays safe even if
  nobody looks. `scripts/list-survivors.mts` (new) prints per-fold TEST numbers and, crucially,
  **splits rows that failed the bar from rows whose gate never completed** (a mid-run
  `NeonDbError` fails closed to `rejected`, which is correct but is *not* a verdict — those are
  re-runnable). `runScheduledResearchRound` logs the same per-fold lines and now labels its
  in-sample numbers `fit=[...]`; bare FIT numbers next to `[approved]` read as evidence for the
  approval when the evidence is the fold lines. `/research` renders the three states distinctly.
  `list-approved` tags each row DESK-ELIGIBLE / not eligible. **Live state 08-25: 0 survivors,
  0 `panel-v1` rows, 6 legacy approvals.**

- **The panel cache was serving fake bars, and one of them owned a whole fold.** Found while
  measuring the market gate: TEST2's avgR read **-8,952,720**. Cause was three trades on frozen
  placeholder bars (`o==h==l==c`, zero volume) — no range → ATR ~0 → an ATR-multiple stop
  landing ~1e-14 from entry → `pnl/risk` = -5.6e10. The old guard `risk > 0` is not a guard;
  `1e-14 > 0`. The cache holds **1,886 such bars across 6 symbols** (PARA 946 including a run of
  **652 consecutive**, FI 421, SMCI 349, CTRA 167, BIIB 2, DXCM 1) out of 1,277,489. Fixed in two
  layers: `loadPanel` drops them on load and reports `droppedBars` per symbol (a gap is the
  truth — the symbol was not trading; interpolating would put invented history inside a TEST
  fold), and `rMultipleOf` in `backtest/engine.ts` requires risk ≥ `MIN_RISK_FRACTION` (1bp) of
  entry, so bad data degrades to `rMultiple: null` — which every consumer already filters —
  instead of a number no average survives. `trading/manage.ts` uses the same helper, so the live
  desk degrades identically. TEST2 now reads **-0.024**. Timing was deliberate: this changes
  every panel number, and the DB holds **0 `panel-v1` rows**, so the blast radius is zero. Only
  the unambiguous shape is dropped — ~98 zero-range-with-volume (halts) and ~310
  zero-volume-with-range (stale quotes) bars are left alone on purpose.
- **Market gate shipped — one leg of the three that were measured.** `src/lib/market/regime.ts`
  (pure: SPY-vs-SMA200, breadth, 20d realized vol) + `scripts/regime-conditional.mts`, which
  buckets all 91,236 baseline trades across all five folds by the regime on their **entry** day.
  Verdict, in `scripts/regime-conditional.log`:
  **SPY vs its own SMA200 is the only leg that survives** — avgR above/below is
  `+0.017/-0.071` (FIT), `+0.002/-0.293` (SELECT), `+0.012/-0.004` (TEST1), `+0.018/-0.077`
  (TEST2), `-0.004/-0.109` (TEST3): same sign 5/5. **Breadth and realized vol both fail** (§5).
  `marketGate.ts` ships that one leg, wired into `scanUniverse` **before** the universe fetch and
  logging its reading on every scan; kill switch is the `marketGate` setting (`"off"`).
  Three things to carry forward: **(1)** the surviving feature is the only one with **no free
  parameter to fit** — "above its own trailing mean" is self-normalising, and the two features
  with a number in them are the two that died. **(2)** it **removes a loss, it does not create an
  edge**: gated fold avgR is `{+0.017, +0.002, +0.012, +0.018, -0.004}`, i.e. ~0, and TEST3 is
  still negative. **(3)** it fails **open** — a blind benchmark passes slots through with a
  `BLIND` log line, because a data outage silently halting the desk is worse than missing a
  filter worth ~0.02R. Opposite of how the research gates fail, and intentional.

## 4. Next steps, highest value first

**(f) is now resolved** (§3) and it absorbed most of (a): research and every blind test read
`.cache/bars/sp500-1d.json`, so the provider's window policy no longer decides what a stored
`backtestSummary` means. (a) is kept because the desk's *live* path still fetches from Webull,
but it is no longer blocking research. **(b) is the top of the list now**, and the panel has
made it sharper rather than softer: the eligible pool is not just off-universe, it is empty.

### a. Pin the bar window — for the live desk path only, now

Downgraded 2026-08-25: research and blind tests read the pinned cache, so none of this touches a
stored research verdict any more. What is left is the live quote/scan path, where the desk still
fetches from Webull. Do **not** re-cite the old Yahoo bar-count numbers — a probe of all five
shapes the desk requests returns Webull every time; Yahoo is only the tail fallback.

Webull's `rangeToWebullCount` (`src/lib/webull.ts:53`) asks for **N bars counted back from now**,
not a date range. Measured consequences: the window **slides one bar per trading day**, so a
range label is never the same series twice; **1200 bars is a hard cap** (a higher `count` is a
417 `ILLEGAL_PARAMETER`, `timestamp`/`endTime` are ignored, no paging), which makes 4.8y the
daily ceiling and silently truncates `5y/1d`; and the **labels are wrong** (`2y/1d` returns 731
bars = ~2.9y). Alpaca, already configured in `.env`, asks by date range, returns exactly 2.0y for
`2y/1d`, and reaches 10.6y at `max/1d` — it is simply never reached, because `fetchCandles` tries
Webull first (`src/lib/marketData.ts:70`) and Webull always succeeds at `1d`. Either prefer
Alpaca for depth or pin an explicit end timestamp. Owner's call; it now affects live scans only.

Also unfixed and harmless: strategy **212 is still `rejected`** on the old data error — a smoke
test, not a verdict.

### b. The approved pool is empty — now literally, not just effectively

As of the panel change every row carries `validation = "legacy-single-symbol"`, and
`getResearchStrategy` requires `panel-v1`, so **no research strategy can be attached to a desk at
all** until one passes a panel round. That is intended. The older statement of the same problem:
the 6 surviving approvals are on **BTC-USD, GC=F, NG=F** — instruments the pivot removed —
and **not one has a blind test**. There is no validated stock strategy at all. Decide whether
the 6 get demoted as off-universe or re-validated on stocks; do not read "6 approved" as "6
usable". Until the loop produces one, the other route is a hand-authored candidate through
`runResearch`'s `manualCandidates` path.

### c. Retire the legacy 0.8:1 research ladder — legacy rows only, now

New candidates can no longer be assigned a sub-1:1 ladder. What is left: `RESEARCH_ATR_TP_MULT
= 1.2` / `SL 1.5` (`src/lib/trading/engine.ts:49-51`) is still `resolveExitOverride`'s
fallback for rows persisted before `exitLadder` existed, and `LEGACY_TP1_MULT` is the same
fallback in `blindTest.ts` — though that one is nearly dead, since only pre-ladder rows reach it
and every pre-ladder row is `legacy-single-symbol`, which `runBlindTest` now refuses outright.
Backfill those rows by re-sweeping, or refuse to activate a row without a ladder. Do **not** simply swap 1.2 → 2.5: that variant failed OOS as a pick. The
defensible claim is only "0.8:1 is measurably bad".

### d. Decide whether the desk's own default exit becomes a trail

**`resolveExitOverride`'s no-override path and the backtest engine's `ATR_TP_MULT` are
untouched** — a built-in strategy like desk #11's `combo-vote` still exits on the 1.5/2.5
ladder. On weekly, the desk's timeframe, the trail is +0.021 avgR and ~36% more trades.
Blockers: idealised stop fills (gaps aren't modelled, and a trail hits its stop far more often
than a ladder) and survivorship bias in `.cache/bars/sp500-1d.json`. `1.0/1.5` performs nearly
as well — do not present 1.5/1.5 as an optimum.

### e. Unswept: the ADX-descending candidate ranking in `runScan.ts` (697b295)

It replaced alphabetical order — better, but never swept as a ranking.

### f. ~~The validation set is too small AND not held out~~ — **RESOLVED 2026-08-25**, see §3

Both findings (median 4 trades per candidate; the blind test overlapping its own training window
by 66%) are fixed by the panel. The measurements that motivated it — the per-window %-up /
correlation / N_eff table, and the AAPL overlap arithmetic — are preserved in
`docs/PROPOSAL-panel-validation.md` §1, which is where to look before re-deriving any of it.

What is left of this item, and it is not small: **the pool is empty by construction.** Every
existing row is `legacy-single-symbol`, so nothing is desk-eligible. The next step is to run a
panel round and see whether anything clears a bar that is, deliberately, much harder than the
one the 6 legacy approvals cleared. Expect most rounds to produce nothing; that is the gate
working, not a fault. **Check with `npx tsx scripts/list-survivors.mts`**, not `list-approved` —
approved alone is not the survivor condition (§3).

## 5. Traps — read before touching these areas

- **`scanner.ts:274`** — a portfolio with a `strategy` key set bypasses `decideSetup()`
  entirely, confluence block included. Filters are unreachable in that path, not merely inert.
- **`--split=all`** in the sweep script has **no held-out half**. It exists only for `--byYear`
  regime checks on an already-chosen variant. Never select anything with it.
- **Do not re-tune the 13 confluence filters, cross-sectional mean reversion, or
  cross-sectional momentum.** All three loops are closed and documented as rejected.
- **Do not re-tune breadth or realized vol as regime features.** Measured on all five folds and
  rejected: breadth is monotone in FIT then inverts in SELECT and TEST3; vol's top bucket is
  consistently bad but its Q1–Q4 ordering holds nowhere. Both died the same way — **FIT-derived
  absolute cut points do not transfer.** The breadth quintile holding 17% of FIT's trades holds
  **79%** of TEST2's, and TEST2's top quintile is empty. A threshold fitted on 2016-2018 is
  measuring a different market by 2022. Evidence: `scripts/regime-conditional.log`.
- **The market gate's sample is ~a dozen episodes, not 91,236 trades.** Its variable changes only
  when SPY crosses its 200-day mean. Five folds of ONE benchmark series are not five independent
  observations. Never quote the trade counts as the evidence base.
- **`MIN_RISK_FRACTION` exists because `risk > 0` let 1e-14 through.** Do not relax it, and do not
  "fix" a null `rMultiple` by winsorizing — null means the trade cannot be measured in R, which is
  the honest report of a bar that never traded.
- **Live trading cannot measure an edge.** 5 slots on weekly bars ≈ 15–25 closed trades per
  8 weeks; sd(R) ≈ 1.39 → SE ±0.31R against an effect size ~0.04R. n comes from the sweep
  harness, not from waiting. Live runs verify plumbing, nothing else.
- **Blind-test a research strategy before approving it — every time, without asking.**
- **`PANEL_SEED` is a constant, not a parameter.** A caller who can choose the seed is a caller
  who can re-roll until the random-entry control loses. Same reasoning as the next bullet.
- **`MIN_HOLDOUT_RETENTION` is pre-registered.** Its value (0.5) was fixed before any
  candidate was measured against it. Re-tuning it after seeing a candidate fail turns the
  gate into a rubber stamp with extra steps — that is what "pre-registered" is protecting.
- **Never restore a mock fallback that can decide something.** Both halves were cut on
  2026-08-25 (§3). `mockHawk`/`mockSage` and `mockCandidates` still exist — as the
  counterfactual baseline and as the purge script's fingerprint — but the moment either can
  open a trade or bank a strategy the record becomes unreadable again. The failure mode is not
  dishonesty (the old code labelled everything correctly); it is that a correctly-labelled
  placeholder accumulates into the majority of the dataset while nobody reads labels.
- Next.js 16 here has breaking changes vs. training data; read `node_modules/next/dist/docs/`
  before writing app code (`AGENTS.md`).

## 6. Blocked on the user (still open)

- The cloud credential question is **deferred, not solved**: Vercel has no
  `ANTHROPIC_API_KEY`, and the GH runner installs the CLI and passes
  `CLAUDE_CODE_OAUTH_TOKEN` yet still produced `mock` — unexplained. Diagnose `aiBackend()`'s
  CLI probe on the runner before re-enabling either schedule.
- `FINNHUB_API_KEY` is **empty as a GitHub Actions secret** — parked while the loops run
  locally off `.env`, where the key is set. It matters again the day a schedule is re-enabled:
  `gh secret set FINNHUB_API_KEY --repo CrispyBacoN-12/Nexmind` (user runs it — do not handle
  the key).
- ~~**Pick a window policy**~~ — **answered and implemented** (§3). Adopting it made every stored
  `backtestSummary` non-comparable, exactly as warned; that is what the `validation` column
  records rather than hides.
- **Register the weekly research schedule.** The code rotates per week; the Windows task still
  fires daily at 06:00. Changing a scheduled task is a system setting — run it yourself. The
  task is named **`NEXMIND Research round`** (all three carry the `NEXMIND ` prefix), and
  `schtasks /Change` **cannot** do this — it edits `/ST`, `/TR`, `/RU`, not the schedule type.
  `/Create /F` would work but requires re-quoting the nested `wscript //B ...vbs ...cmd`
  command line; replacing only the trigger leaves the action and principal untouched:

  ```
  Set-ScheduledTask -TaskName "NEXMIND Research round" -Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 6:00am)
  ```

  Verify with `(Get-ScheduledTask -TaskName "NEXMIND Research round").Triggers` — expect
  `DaysOfWeek 1` / `WeeksInterval 1`; a surviving `DaysInterval` means it is still daily. Until
  this runs, the loop tests ~7x more candidates against a fixed p95 bar than the
  multiple-testing argument in §3 assumes.
- `git rm -r --quiet rl mt5-bridge/__pycache__` — `rl/` is still tracked after the pivot.
- Confirm why desk #11 runs **`combo-vote`** and not `trend-pullback`
  (`scripts/revert-stocks-desk-to-default.ts` sets `trend-pullback`; something set combo-vote
  instead). Whichever is intended, the other is a silent mismatch.

## 7. Housekeeping for whoever writes here next

1. Update §2 only from a **real query**, never from what this file used to say.
2. Move anything finished out of §4 into §3 with its commit hash.
3. A rejected mechanism goes in §5 so it is never re-tuned; link its `docs/quant/` file.
4. Keep this file under ~150 lines. Deep evidence belongs in `docs/quant/` and in commit
   bodies, not here. When §3 outgrows its space, compress its oldest entries to one line
   each — the reasoning is already in git.
