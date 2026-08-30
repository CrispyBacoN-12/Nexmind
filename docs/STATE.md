# NEXMIND — Session State

**Living handoff. Read this first; update it before you finish.**
Auto-loaded every session via `CLAUDE.md`. Dated deep-dives live in `docs/quant/`; the
reasoning behind each change lives in its commit body. This file is the current bar, not
the archive.

_Last verified against the live DB + working tree: **2026-08-31**, branch `stocks-only-pivot`._

> **The panel gate has now run end to end (2026-08-31, run #112, `status: done`).** The budget
> that had paused everything came back the same day. The round proposed 3 strategies and rejected
> all 3 at the FIT fold — **the first `panel-v1` rows the project has ever produced**, and the
> answer to the question that had been open since the gate was built: it works, and it says no.
> The eligible pool is still empty, but that is now a verdict rather than an untested claim.
> **Resume at §4.0.**

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

## 2. Live state (verified by query, 2026-08-31)

| Thing | Value |
|---|---|
| Portfolios | **one**: #11 "US Stocks Desk", active, kill switch off, 5 slots, $10k paper |
| Desk #11 strategy | **`combo-vote`** (built-in) — no longer `research-29` |
| Open trades | 4 (KO, AZO, XOM, KMX), all `aiBackend = "mock"`, **all opened on or before 08-24** |
| Closed trades | 44, cumulative **-$386.82** |
| AI backend on every trade ever | `mock` (46) or null (2) — **no trade has ever been opened by a real backend** |
| Since the mock cutoff (08-25) | **0 trades opened.** The desk runs, decides with `cli`, and declines |
| `Counterfactual` rows | **51, every one `aiBackend = "cli"`**: no-consensus dominant, a handful of SAGE vetoes, **0 fills** |
| …by day | 08-23 (3), 08-26 (10), 08-27 (12), 08-29 (12), 08-30 (13) — the loop is running daily |
| `Signal` rows since 08-26 | 50 discarded, 6 vetoed, 0 traded |
| `ResearchStrategy` | 218 rows: **3 are `panel-v1`** (216-218, all rejected at FIT on 08-31), the other 215 `legacy-single-symbol` (6 of them still read "approved" — none desk-eligible) |
| Desk-eligible strategies | **0** — but as of 08-31 that is a *verdict*: 3 candidates were panel-tested and all 3 failed (`npx tsx scripts/list-survivors.mts`) |
| `ResearchRun` | newest is **#112, 2026-08-31, `status: done`** — **the first panel round ever to complete.** 491 symbols, FIT fold, 3 proposals, 3 rejections (#111 was the spend-limit failure the day before) |
| `Setting` rows | only `fearGreed` and `webull:accessToken` (expires **2026-09-14**). **No `ai:outage` row** — the spend limit predates the latch fix, so it was never recorded |
| Market gate | **live and readable again** since 08-30: `SPY 769.35 > SMA200 707.41` (+8.8%) on Alpaca bars (§3) |
| Scheduled tasks | all three (`Stocks scan` 05:00, `Manage positions` /15min, `Research round` Sun 06:00) now share the same power settings; next research fire **2026-09-06 06:00** |
| Working tree | **clean**, 4 commits ahead of origin and **not pushed**: `4fc29ce` feed, `e1282ed` Webull production, `fb39e58` spend-limit latch, `7d993d5` state refresh |

Re-verify with a throwaway script under `scripts/` (delete it afterwards) querying
`portfolio.findMany` (the field is `status`, **not** `active`),
`trade.groupBy({ by: ["status"] })` and `researchStrategy.groupBy({ by: ["status"] })`.

## 3. Done recently (2026-08-23 → 08-30)

Older entries are compressed to one line each; their reasoning is in the commit bodies.

- **A spent budget no longer fails silently. 2026-08-30.** `FATAL_BACKEND` in `anthropic.ts`
  matched `authenticat|oauth|logged in|api key|credit balance|quota|subscription` — and **not**
  "You've hit your monthly spend limit", the string the CLI actually returns when the account
  budget runs out. So the latch never tripped: the desk went on calling a backend that could not
  answer, every call failed on its own, and `aiOutageStatus()` stayed null, i.e. **War Room
  reported AI online while nothing worked.** `spend limit|usage limit` added, and the predicate
  extracted as `isFatalBackendReason` so it has tests (four, one per class). `limit` alone is
  deliberately NOT matched — a plain rate limit is worth retrying, and latching it would take the
  desk off AI for five minutes over a hiccup. Found by running a research round by hand, not by
  reading the code.

- **Webull market data moved to production (e1282ed).** UAT was serving a partially refreshed
  fixture set — 15 of 50 large caps stale, price errors to 39.8% (RTX 127.50 vs a real 211.71),
  and it never errored, so nothing downstream could tell. The old "the token is per-session, so a
  cron can never hold one" verdict was **wrong**: create -> approve once in the app -> check ->
  a NORMAL token lives exactly **15.00 days**, and `/token/refresh` returns +15 days with **no**
  second approval. `lib/webull/token*.ts` rolls it forward; **`ensureWebullTokenFresh()` hangs off
  the daily scan tick, not the data path** — Alpaca leads now, so `fetchWebullCandles` is
  essentially never called and a use-triggered refresh would have died 15 days after seeding,
  silently, leaving no fallback exactly when Alpaca finally needed cover. Verified against Alpaca
  on the symbols UAT was stale on: CSX/RTX/PM/SPY/MRK/HON all **0.00% diff, 366 bars,
  last 2026-08-28**. Still data-only; `/openapi/trade/*` untouched and untested.

- **The live bar feed is fixed: Alpaca leads, placeholders are dropped, the gate can be wrong
  again. 2026-08-30.** Three changes, each with a test that failed first:
  **(1) provider order** — `providerOrder()` in `marketData.ts` puts Alpaca ahead of Webull, and
  `fetchCandles`/`fetchCandlesBatch` both walk that order. Webull led before, never threw, and so
  Alpaca was never reached. **(2) placeholder drop in the live path** — `isPlaceholderBar` /
  `sanitizeSeries` moved out of `research/panel.ts` into **`src/lib/bars.ts`** (panel re-exports
  them, so nothing research-side changed) and every provider response now goes through
  `sanitizeResponse`, which also **re-quotes `price` from the surviving bars** — a dropped last
  bar could otherwise leave an invented quote in front of sizing and the facts sheet.
  **(3) the gate refuses an impossible series** — `MAX_TREND_EXTENSION = 0.5` in `marketGate.ts`;
  a benchmark further than 50% from its own SMA200 takes the existing **fail-OPEN BLIND** branch
  instead of reporting a reading. Not a chosen number: SPY's own extension across 2016-2026
  (2,679 Alpaca bars) ran **-25.8%** (2020-03-23) to **+17.8%** (2020-12-04), so no real regime
  can trip it, while the spliced series sat at **+117%**.
  Verified live, not just in tests: `fetchCandles("SPY","2y","1d",300)` now returns **500 Alpaca
  bars, 2024-08-30 → 2026-08-28, closes 489.57–777.88, 0 placeholders** (was 731 Webull bars,
  19.04–771.10), `readMarketGate` reads `SPY 769.35 > SMA200 707.41`, and feeding it the raw
  Webull series still produces `market gate BLIND — SPY 769.35 sits 116% from its own SMA200
  356.49`. All four open positions (KO/AZO/XOM/KMX) now get clean weekly series; **KMX had no
  Webull bar at all after 2024-12**. 393/393 tests pass, typecheck clean.

- **What Webull actually returns, measured 2026-08-30** — the evidence behind the change above,
  and the reason not to re-promote it. Depth is real: 1200 bars is a hard cap, so `1d` reaches
  ~5.11y (`5y` and `max` are the same response), `1h` 0.69y, `5m` 21d, and range labels are
  wrong throughout (`2y/1d` → 731 bars ≈ 3.05y). **The content is not.** Against Alpaca on the
  same dates (Alpaca and Yahoo agree to the cent), closes differ by >1% on **99.4% of SPY bars,
  86.6% of AAPL, 71.3% of KO, 58.0% of NVDA, 28.9% of MSFT**. SPY is a splice, not a
  mis-adjustment: real SPY to 2021-12-22, a different instrument in the $16–33 band for 84% of
  the series, real SPY again from 2026-04-14 (x0.046 down, x20.27 back). SPY's 2025-01 is
  **0 bars** against Alpaca's 20. AZO's "2y" pull is mostly 2019–2022 with a hole from 2022-07 to
  2026-06; **KMX ends at 2024-12**. Frozen `o=h=l=c` counts in one 2y daily pull: WMT 181,
  JNJ 180, AZO 147, XOM 130 — which is what SAGE was vetoing. Alpaca, same probe: `max/1d`
  **2,679 bars = 10.65y, 0 frozen**; `2y/1h` **8,006 bars = 2.00y** against Webull's 0.69y.

- **HAWK and SAGE decide for real now — and they have opened nothing. 2026-08-26 → 08-30.**
  47 new `Counterfactual` rows, every one `aiBackend = "cli"`: **44 no-consensus, 6 SAGE veto,
  0 fills.** This is the first stretch in the project's history where the analysts actually
  decided rather than the mock path deciding for them, so the arm recorder is finally
  collecting the sample §4b and `/scoreboard` were built for. Do **not** read it as evidence
  that the team is appropriately cautious: **5 of the 6 vetoes are about the bar data, not the
  setup** — SAGE is rejecting frozen placeholder prints (`o=h=l=c`, volume 0.23x average,
  multi-month calendar gaps) in the live weekly series, which is the same corruption
  `loadPanel` was taught to drop on 2026-08-25. The live path never got that guard. Next
  entry.
- **The live bar feed is broken, and the market gate is inert because of it. Found 08-30.**
  `fetchCandles("SPY", "2y", "1d", 300)` — the exact call `readMarketGate` makes — returns
  **731 Webull bars whose closes run from $20.67 (2023-08-10) to $769.35 (2026-08-28)**:
  635 of the 731 are below $500. That is not SPY's history at any split adjustment; it is a
  spliced or mis-adjusted series. The consequence is arithmetic: SMA200 computes to **356.49**
  against a $769 close, so `benchAbove` is **true unconditionally** and the one regime leg that
  survived the panel (f890a9d) can never fire. Every gate line since it shipped reads
  `market gate risk-on (SPY 769.35 > SMA200 356.49)`. The gate is not wrong about today's
  regime — it is incapable of being wrong, which is the same thing as not being on. The
  research path is unaffected: it reads `.cache/bars/sp500-1d.json`, never a live fetch.

- **`gap-fade` closed — the last live mechanism. 2026-08-26**,
  `docs/quant/2026-08-26-gap-fade-open-fill.md`. New `ExitOptions.entryAt` lets a rule fill
  at the bar OPEN (stop sized off `atrs[i-1]`, since ATR at i includes bar i's own range;
  entry session managed). Given the price it actually describes, `gap-fade` **loses to the
  control median on both panels** (−0.045 S&P 500, −0.017 broad) against +0.012 at the close
  fill — pre-registered to need MORE than +0.012 to survive. So buying the gapped open is
  0.055R worse than buying that session's close: the edge was never "fade the gap", it was
  "let the gap session finish, then take the reversion", and that version still only loses
  less than random. A `-nomanage` diagnostic prices the intrabar ambiguity at ~0.001R, which
  **closes intraday bars as a response to this** — see §4g.
- **Replicated on a disjoint universe. 2026-08-26**,
  `docs/quant/2026-08-26-broad-universe-rerun.md`. The same six mechanisms and the same
  baseline, re-run unchanged on `.cache/bars/broad-1d.json` — 1,172 liquid US common stocks
  sharing **not one ticker** with the S&P 500, same calendar, same folds, same `PANEL_SEED`.
  **Not one verdict flipped.** The baseline loses to the control median in 5/5 folds there
  too; the same five mechanisms fail; `gap-fade` passes again. So the eleven null results were
  never a statement about where we were looking. Changing the universe is now closed as a
  direction, and `decideSetup()` is closed as a research subject — §4g.
- **The baseline entry rule loses to random. 2026-08-26**, `scripts/mechanism-screen.mts`,
  full table in `docs/quant/2026-08-26-mechanism-screen-results.md`. Against the matched
  random control — same symbols, same trade count, same long/short mix, same exits, same
  costs, only the entry timing randomised — `decideSetup()`'s avgR is below the control
  **MEDIAN in all five folds** (−0.003/−0.034/+0.010/−0.024/−0.014 vs med
  +0.010/+0.067/+0.032/+0.001/+0.014). Not "roughly zero", which is how it was recorded
  before: **negative-value entry timing, in every fold, including the two it was built on.**
  Everything tuned around it — the exit ladder, the 13 vetoes, the market gate — was tuned
  around that. Read this before spending another round on the same rule.
- **Six new entry mechanisms screened, five rejected. 2026-08-26**, same run.
  `mr-down3`, `nr7`, `turn-of-month`, `vol-dryup`, `range-expand` — **do not re-tune**, all
  failed on the screening folds (fit/select). `gap-fade` is the only row beating the control
  p95 in 5/5 folds, but its raw avgR is negative in 4/5 because its control is negative too:
  an information result, not a tradeable one, and its entry fills at the CLOSE of the gap bar,
  which is the wrong price for the mechanism. Open, undecided — §4g.
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

**(a) and (f) are both resolved** (§3). Research and every blind test read
`.cache/bars/sp500-1d.json`, so the provider's window policy no longer decides what a stored
`backtestSummary` means; and as of 2026-08-30 the live path is on Alpaca, drops placeholder bars,
and the gate refuses a series it cannot believe. **(b) is the top of the list**, and §0 records
what the first completed panel round did to it: the eligible pool is still empty, but it is now
empty because three candidates were tested and lost, not because the gate had never run.

### 0. The panel gate ran, and it works — **DONE 2026-08-31**

Owner's chosen direction on 2026-08-30 was **"unlock the research round first"**. Both halves are
now done: the Task Scheduler block (§6) and, on 08-31, the AI budget came back and a hand-run
round completed. What it produced:

```
research run 112: panel 491 symbols — fit 474, select 476
run #112 status: done
research-216 [rejected] "MACD Momentum Continuation"        fit trades=3     win 100%  pnl $1
research-217 [rejected] SAFETY-FLAGGED "RSI Extreme Reversion"  fit trades=8401  win 48.7%  pf 0.70
research-218 [rejected] "Volume-Confirmed Range Breakout"   fit trades=363   win 48.2%  pf 0.23
```

**The result worth keeping is not the three rejections — it is `status: done`.** No panel round had
ever completed before, so "the pool is empty" had two possible causes: a strict gate, or a gate
that had never run. It was the first.

**All three rejections are correct, and none of them was decided by the numbers printed above.**
`runResearch.ts:311` decides `status` on `selectRun.summary` — the SELECT fold, 2019, held out from
the refinement loop and the ladder sweep — while the row stores `backtestSummary = swept.summary`
(FIT) and the round prints that. On the numbers that actually decided:

| | SELECT 2019 | verdict |
|---|---|---|
| research-216 | **0 trades**, 0/476 symbols | fires essentially never; rejected on the trade floor |
| research-217 | 2869 trades, **avgR −0.040**, PF 0.777 | a real anti-edge, and safety-flagged besides |
| research-218 | 90 trades, 85/476 symbols, **avgR −0.407**, PF 0.549 | thin participation, badly negative |

Do not read them as a market finding — they are the proposer producing weak candidates, which is
expected and cheap. But do read the *pattern*: not one of the three survived contact with a single
held-out year, and 216 could not even fire.

**The reporting defect this exposed — both halves FIXED 2026-08-31, before any new round:**

1. **The headline numbers were not the deciding numbers.** The round printed `fit=[…]` and the row
   stores the FIT summary, but approval is decided on SELECT. That is why 216 read
   "trades=3 win 100%" when its actual verdict was "0 trades in 2019" — anyone reading a round
   without knowing that would re-tune against the wrong fold. Fixed: `strategyResultLine`
   (`scheduledResearch.ts`, tested in `scheduledResearch.test.ts`) reads SELECT back out of
   `iterations` — the one place `runResearch.ts:301` persists it — and leads with it. FIT stays on
   the line, after SELECT and labelled, because FIT-strong/SELECT-collapsed is the overfit
   signature worth seeing; it just must not be read first. Run #112 now renders as:
   ```
   research-216 [rejected] "MACD Momentum Continuation" select=[trades=0 symbols=0/476 win%=0.0 avgR=— pf=—] fit=[trades=3 win%=100.0 pnl=$1 pf=—]
   research-218 [rejected] "Volume-Confirmed Range Breakout" select=[trades=90 symbols=85/476 win%=31.1 avgR=-0.407 pf=0.55] fit=[trades=363 win%=48.2 pnl=$-150 pf=0.23]
   ```
2. **`list-survivors.mts` could not tell a pre-blind-test rejection from a TEST-fold one.** It
   bucketed on `blindTest.error`, so a row rejected before the gate (`blindTest = "{}"`) landed
   under **FAILED THE BAR** reading `0 reason(s): (no reason recorded)` — indistinguishable from a
   candidate that genuinely lost out-of-sample, which is how all three of run #112's rows were
   filed. Fixed: `classifyPanelRow` (`blindTest.ts`, tested) names the three ways a row can read
   rejected — `failed-bar` / `blind-test-incomplete` / `never-reached-gate` — and the script grew a
   fourth section that prints the SELECT line as the reason.

Note also that the dollar columns in a fixed-lot backtest are not the ones to read: `runResearch.ts`
already selects on avgR precisely because a fixed 0.1 lot makes expectancy and profit factor weight
each trade by its own stop width. `autoReviewStatus` still gates on `expectancy`/`profitFactor`,
which is a live inconsistency — it did not change any verdict here (all three were negative on avgR
too, or had no trades) but it will eventually.

### 0b. Direction, decided 2026-08-31: **stop researching entries; research exits and risk**

The question was genuinely open — (b) says the eligible pool is empty, (g) says the daily-OHLCV
mechanism space is exhausted across two disjoint universes — and the owner chose deliberately.
Writing another entry rule is the low-value move: run #112 is a fair sample of what the proposer
generates unprompted, and the track record is one-sided.

| entry-rule research | exit / risk research |
|---|---|
| cross-sectional mean reversion — rejected | ATR trail 1.5/1.5 — **passed IS *and* OOS, 10/10 weekly years** |
| cross-sectional momentum — rejected | |
| 13 confluence filters — all failed OOS | |
| Donchian / breakout — dead on gold | |
| run #112's three — none survived one held-out year | |

The one change that ever cleared a full IS/OOS gate in this project was a change to exit geometry,
not to an entry. The baseline itself is weak (trend-pullback, ~+0.04R/trade at t=1.08 OOS on weekly
bars), so the aim is not a new signal — it is to find whether exits, position sizing, or a regime
filter can lift what the existing signal already produces.

**Next concrete step:** re-aim the proposer. `RESEARCH_ROTATION` (`scheduledResearch.ts:55`) and the
QUANT brief in `propose.ts` both currently ask for entry rules; they need to ask for exit/sizing/
regime variations on the existing baseline instead. Nothing has been changed there yet.

**Costs no AI, still open:** `git rm -r --quiet rl mt5-bridge/__pycache__` (§6), and settling why
desk #11 runs `combo-vote` rather than `trend-pullback` (§6 — whichever is intended, the other is a
silent mismatch). Also unpushed: four commits on `stocks-only-pivot`.

### a. ~~Fix the live bar feed~~ — **RESOLVED 2026-08-30**, see §3

Both halves are done: the live path prefers Alpaca, `sanitizeResponse` drops frozen prints before
any consumer sees them, and `gateSlots` takes its BLIND branch on an implausible benchmark rather
than reporting a reading off a broken series. Re-probe with `fetchCandles("SPY","2y","1d",300)`
— a healthy answer is ~500 Alpaca bars whose closes stay inside a plausible band.

Two things survive this item and are worth keeping in view:

**Webull's window policy is unchanged and still wrong**, it just no longer decides anything.
`rangeToWebullCount` (`src/lib/webull.ts:53`) asks for **N bars counted back from now**, not a
date range, so the window slides one bar per trading day and a range label is never the same
series twice; **1200 bars is a hard cap** (higher `count` → 417 `ILLEGAL_PARAMETER`,
`timestamp`/`endTime` ignored, no paging). Do **not** re-cite the old Yahoo bar-count numbers —
Yahoo is only the tail fallback.

**Webull is still second in the chain, not deleted.** With Alpaca healthy it is never reached for
a US equity, and the two guards above catch the shapes that hurt. Removing it outright is a
reasonable call — it is the only provider here that is also the broker, which is the only reason
it is still there — but it should be taken explicitly, not by leaving it first.

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

**Reweighted 2026-08-26 and probably not worth doing yet.** The trail's +0.021 avgR was
measured on top of an entry rule now shown to be worse than random (§3). A better exit on a
negative-value entry is still a negative-value strategy, so this is a refinement of the wrong
layer. It stays on the list because the measurement is sound and cheap to ship later; it
should not be worked before §4g.

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

### g. Change the input, not the rule — **run 2026-08-26, ANSWERED: it was not the universe**

Ten mechanisms across five families had been measured against the matched control and none was
tradeable. All ten were functions of daily OHLCV, and all ten were measured on the 491 most
heavily analysed securities on earth. So the input was changed rather than the rule.

`scripts/cache-broad-universe.mts` built `.cache/bars/broad-1d.json` — **1,172 liquid US
common stocks disjoint from the S&P 500** (5,196 candidates from the NASDAQ symbol directory,
floored at $2M median daily dollar volume and $5 close, sampled by an alphabetical stride so
the kept set is not just the next-largest caps). Alpaca SIP, `adjustment=all`, span
2016-01-04..2026-08-25 — identical to the existing panel, so `FOLDS` and `PANEL_WARMUP_BARS`
transferred unchanged. The same six mechanisms, same baseline row, same folds, same ladder,
same `PANEL_SEED`, same `--control=200`, via the new `--panel=` flag on
`scripts/mechanism-screen.mts`. Only the universe differed.

**Result — `docs/quant/2026-08-26-broad-universe-rerun.md`. Not one verdict flipped.**

- **The baseline is dead independently of universe.** It loses to the control MEDIAN in 5/5
  folds on the broad panel too (−0.024 / −0.119 / −0.016 / −0.011 / −0.042 vs the S&P 500's
  −0.019 / −0.112 / −0.030 / −0.033 / −0.034). Ten fold-cells, two symbol sets with zero
  overlap, never once positive. The pre-registered consequence, written before the run, was
  "no further work belongs on it". **`decideSetup()` is closed as a research subject.**
- **`gap-fade` replicated** — positive margin in 10/10 cells across both universes, and again
  the only mechanism passing BOTH screening folds. Caveats in §5 and in the doc.
- **The other five failed again, identically.** Do not re-tune them.
- **Changing the universe is now itself closed.** Two disjoint equity universes produced the
  same answers throughout, so further universe-swapping on daily OHLCV should not be funded.

**Correction to how this was framed earlier in the day:** "find data without survivorship
bias" was the wrong reason. The matched control re-places entries within the SAME symbols, so
a name that is only in the cache because it survived and tripled helps the rule and the
control equally — the margin was already survivorship-neutral, and broad-1d.json is in fact
*more* survivorship-biased than sp500-1d.json, because small caps delist far more often. The
real reason to change the universe was arbitrage intensity, not bias. Read margins off that
panel; never levels.

**The last thread, and it is now closed too.** `gap-fade` was re-run under a corrected fill
(`entryAt: "open"`) the same day and **failed against its own control on both panels** —
`docs/quant/2026-08-26-gap-fade-open-fill.md`. The pre-registration required it to beat
+0.012; it printed −0.045 and −0.017. **Intraday bars are closed as a response to this**: the
`-nomanage` diagnostic shows the same-session ambiguity daily bars cannot resolve is worth
~0.001R against a −0.045 effect, so a 5m/15m pipeline would settle a rounding error and could
not turn a negative fill-price result positive. If intraday data is ever built it must be
justified by a NEW mechanism that needs it, never by this one.

**Where that leaves the programme:** ten mechanisms, five families, two disjoint universes,
one corrected fill — nothing tradeable, and `decideSetup()` itself worse than random in 10/10
fold-cells. There is no candidate left to promote and no queued direction that the evidence
supports. That is a real state of the project, not a gap in it, and the next direction should
be chosen deliberately rather than inherited.

## 5. Traps — read before touching these areas

- **A raw avgR from the panel carries no information on its own.** Demonstrated three times
  now (regime features, the mechanism screen, then the broad-universe re-run — where
  `turn-of-month`, a rule that reads no price at all, again showed a test-fold avgR of +0.268
  at 70.6% win while failing both screening folds). On this universe 69-87% of names rose in
  every window, so any long-biased rule prints a good-looking number for free. On 2026-08-26
  the three best raw rows were all long-only and all died to the control; `turn-of-month`,
  which reads **no price at all**, showed test1 avgR **+0.355 at 75.5% win** against a control
  p95 of +0.124. Quote the margin over the matched control (`src/lib/research/control.ts`) or
  do not quote the number.
- **A failure classifier is only as good as the strings it was checked against.** `FATAL_BACKEND`
  in `anthropic.ts` was written from what a dead login looks like and shipped without a test, so it
  missed `You've hit your monthly spend limit` — the one failure most likely to actually happen.
  The result was the worst shape available: no latch, no banner, every call retried and failed, and
  War Room reporting AI online throughout. It was found by **running the thing**, not by reading the
  regex. Before adding a pattern, get the literal string out of the tool; before removing one, ask
  whether the failure it names is retryable. `limit` alone must stay unmatched — a rate limit is
  retryable and latching it is the same bug pointing the other way.
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

**Not on this list: anything about cloud credentials.** The runtime is local by decision
(§3), and locally `aiBackend()` resolves to `cli` — `claude.exe` is on the persisted User
PATH, so Task Scheduler resolves it and the desk can decide. Both key items below are
**dormant preconditions for re-enabling a cloud schedule**, not open questions, and must not
be reported as blockers while the runtime stays local:

- *(dormant)* Vercel has no `ANTHROPIC_API_KEY`, and the GH runner installs the CLI and passes
  `CLAUDE_CODE_OAUTH_TOKEN` yet still produced `mock` — unexplained. Diagnose `aiBackend()`'s
  CLI probe on the runner **before** re-enabling either schedule. Nothing depends on it today.
- *(dormant)* `FINNHUB_API_KEY` is empty as a GitHub Actions secret; the local loops read it
  from `.env`, where it is set. It matters again the day a schedule is re-enabled:
  `gh secret set FINNHUB_API_KEY --repo CrispyBacoN-12/Nexmind` (user runs it — do not handle
  the key).
- ~~**Pick a window policy**~~ — **answered and implemented** (§3). Adopting it made every stored
  `backtestSummary` non-comparable, exactly as warned; that is what the `validation` column
  records rather than hides.
- ~~**Register the weekly research schedule.**~~ — **DONE 2026-08-26**, verified by
  `(Get-ScheduledTask -TaskName "NEXMIND Research round").Triggers`: `DaysOfWeek 1` /
  `WeeksInterval 1`, no surviving `DaysInterval`. The loop now tests ~156 candidates/yr against
  the fixed p95 bar, which is the number the multiple-testing argument in §3 assumes.
- **The AI budget is spent, and that is now the only thing stopping a research round.**
  A hand-run round on **2026-08-30** died in seconds:
  `claude CLI: You've hit your monthly spend limit`. Nothing in the repo can fix this —
  raise it at `claude.ai/settings/usage` (**owner runs it; do not handle the account**), or
  wait for the monthly reset. Until then `runScheduledResearchRound` cannot propose, and
  HAWK/SAGE cannot decide: expect every scan to log `no-ai-backend`, which is the desk
  refusing correctly, not a fault. The failure is at least **visible** now — see §3.
  ~~**The weekly research round has not run once** (battery veto)~~ — **the scheduler half is
  FIXED, 2026-08-30.** `NEXMIND Research round` had been returning **0x800710E0** on every
  firing: `DisallowStartIfOnBatteries` and `StopIfGoingOnBatteries` were both `True` and
  `StartWhenAvailable` `False` on **that task only** — `Stocks scan` and `Manage positions`
  already had all three set correctly, which is exactly why the desk ran daily for a week
  while research never ran at all. All three now match. Next automatic attempt **2026-09-06
  06:00**, and `StartWhenAvailable` means a missed slot is caught up rather than lost. The DB's
  newest `ResearchRun` is still **#110 from 08-24** and **0 `panel-v1` rows** exist; that will
  not change until the budget above is restored.
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
