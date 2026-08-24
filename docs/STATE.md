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
| …the 6 survivors | all on **BTC-USD / GC=F / NG=F** — none on a stock; none has a blind test |
| `ResearchRun` | 109 rows, 102 `done` — but only **#110** was ever AI-proposed (§3) |
| Schema | `blindTest`, `exitLadder`, `demotedReason` columns are pushed and live |

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

## 4. Next steps, highest value first

Read **(f) first** — it was measured on 2026-08-25 and it reprioritises this whole list. It
absorbs most of (a): once backtests read the bar cache instead of the provider API, the
Webull-vs-Alpaca window question mostly stops mattering. (a)–(e) below are unchanged and still
true; they are just no longer the top of the list.

### a. Pin the bar window — the held-out set is still not reproducible

Corrected 2026-08-25: this used to be filed as a *Yahoo* problem (3473 then 7984 bars for an
identical `AAPL 2y/1h`). That measurement predates `778bfeb`/`36a9b35`, which put Webull at the
front of the chain. A probe of all five shapes the desk and the research loop actually request
(`2y/1d`, `5y/1d`, `3mo/1d`, `2y/1h`) returns **Webull every time** — Yahoo is now only the tail
fallback for symbols Webull and Alpaca both miss. Do not re-cite the Yahoo numbers.

The reproducibility problem moved rather than went away, and it is Webull's now.
`rangeToWebullCount` (`src/lib/webull.ts:53`) asks for **N bars counted back from now**, not a
date range. Three consequences, measured:

1. **The window slides one bar per trading day.** `AAPL 2y/1d` today and tomorrow are different
   series, so the in-sample/held-out cutoff moves with them. Re-running a blind test on a later
   day does not reproduce its own verdict.
2. **The 1200-bar cap is the real daily ceiling.** A `count` above 1200 is a 417
   `ILLEGAL_PARAMETER`, and `timestamp`/`endTime` are ignored (both probed) — there is no
   paging, so 1200 daily bars = **4.8y** is all Webull will ever give at `1d`. `5y/1d` returns
   4.8y, not 5y, and `coversDays` cannot catch it: it only compares against `minDays` = 400.
   (Weekly reaches 2003, monthly and yearly 1980. The API also serves `M120`, `M240`, `M`, `Y`,
   which `intervalToWebullTimespan` does not map.)
3. **The range label is wrong.** `2y/1d` returns 731 *bars* = 1064 calendar days (~2.9y). Every
   in-sample backtest recorded as "2y" ran on nearly three years.

(3) lands directly on the retention bar added in §3 — both sides of that ratio come from a
window that is not the one requested.

**The fix is probably not to patch Webull.** Alpaca is already configured in `.env` and is
better on every axis that matters here, measured the same day: it asks by **date range**, so
`2y/1d` returns exactly 2.0y (500 bars) with a label that does not lie, and `max/1d` reaches
**10.6y** against Webull's 4.8y ceiling. It is never reached, because `fetchCandles` tries
Webull first (`src/lib/marketData.ts:70`) and Webull always succeeds at `1d`. So the research
loop validates on the shallower provider with the sliding window while the deeper, stable one
sits behind it. Options: prefer Alpaca for research/backtest depth while leaving Webull first
for live quotes, or keep the order and pin an explicit end timestamp. Either changes what every
stored `backtestSummary` means, so it is the owner's call.

Also unfixed and harmless: strategy **212 is still `rejected`** on the old data error — a
smoke test, not a verdict.

### b. The approved pool is empty for this app's actual universe

The 6 surviving approvals are on **BTC-USD, GC=F, NG=F** — instruments the pivot removed —
and **not one has a blind test**. There is no validated stock strategy at all. Decide whether
the 6 get demoted as off-universe or re-validated on stocks; do not read "6 approved" as "6
usable". Until the loop produces one, the other route is a hand-authored candidate through
`runResearch`'s `manualCandidates` path.

### c. Retire the legacy 0.8:1 research ladder — legacy rows only, now

New candidates can no longer be assigned a sub-1:1 ladder. What is left: `RESEARCH_ATR_TP_MULT
= 1.2` / `SL 1.5` (`src/lib/trading/engine.ts:49-51`) is still `resolveExitOverride`'s
fallback for rows persisted before `exitLadder` existed, and `LEGACY_TP1_MULT` is the same
fallback in `blindTest.ts`. Backfill those rows by re-sweeping, or refuse to activate a row
without a ladder. Do **not** simply swap 1.2 → 2.5: that variant failed OOS as a pick. The
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

### f. The validation set is too small AND not held out — full proposal in `docs/PROPOSAL-panel-validation.md`

Two findings, both measured 2026-08-25, both previously undocumented.

**The daily research loop cannot produce a decidable sample.** Of the 128 non-mock candidates
with a backtest, the 18 on a `1d` interval have a **median of 4 trades** and exactly 1 clears
`MIN_TRADES = 20` (`autoReview.ts`). That set already includes `5y/1d` and `max/1d` runs, so
**depth is not the binding constraint — single-symbol scope is** (`runResearch.ts:300` backtests
one symbol). Run #110 the same day is the pattern again: three candidates, 4/4/5 trades, all
auto-rejected without any of their mechanisms being evaluated.

Breadth is not a free substitute for depth, though. On `.cache/bars/sp500-1d.json` (491 symbols,
2016-01-04..2026-08-14, 1,277,489 bars), names disagree hugely in magnitude but barely in
direction:

| window | symbols | % up | ret p10 / med / p90 | avg pairwise corr | N_eff |
|---|---|---|---|---|---|
| 2016–2018 | 470 | 83% | −12 / 39 / 101% | 0.312 | 3.2 |
| 2019–2020 | 477 | 87% | −7 / 46 / 127% | 0.467 | 2.1 |
| 2021–2022 | 483 | 72% | −26 / 16 / 66% | 0.350 | 2.8 |
| 2023–2024 | 488 | 75% | −20 / 23 / 108% | 0.242 | 4.1 |
| last 2y | 489 | 69% | −27 / 17 / 94% | 0.345 | 2.9 |

`N_eff = N / (1 + (N−1)ρ)`: 491 correlated names ≈ **3 independent observations** of market
direction. That is the pessimistic bound — exact for a pure direction bet, too harsh for a
strategy with genuinely dispersed entry timing — but all four rotation briefs
(`scheduledResearch.ts:38`) ask for long-biased daily swing entries, which sits near it. So
**breadth buys trade count, depth buys regime count, and they are not interchangeable.** ρ itself
moves with the regime (0.467 in COVID, 0.242 in 2023–2024), which is the evidence that separate
time windows really are separate markets.

Corollary worth remembering: 69–87% of names are up in *every* window measured. A long-biased
rule shows positive avgR from beta alone, so any panel result needs a matched random-entry
control before it means anything.

**The blind test overlaps its own training data by 66%.** `blindTest.ts:208` cuts the held-out
set at `last − 365d` of a `5y` fetch, but compares it against the stored `backtestSummary` from
a `2y` fetch. On AAPL:

```
in-sample  (2y/1d)   2023-09-22 .. 2026-08-21   (2.9y — see (a): "2y" is a bar count)
deep fetch (5y/1d)   2021-11-10 .. 2026-08-21   (4.8y — Webull's 1200-bar ceiling)
cutoff = last − 365d                2025-08-21
held-out             2021-11-10 .. 2025-08-21
overlap              2023-09-22 .. 2025-08-21   =  1.92y  =  66% of in-sample
```

So `MIN_HOLDOUT_RETENTION = 0.5`, shipped in `158df23`, compares two samples that overlap by two
thirds. Retention reads artificially high and the gate is weaker than its docstring claims. This
is a design fault, not a bug to patch in place — the fix requires choosing a whole new window
policy, which is what the proposal doc is for.

**Blocked on the owner.** Any fix invalidates every stored `backtestSummary` as a basis for
comparison. Do not change code until a window policy is picked.

## 5. Traps — read before touching these areas

- **`scanner.ts:274`** — a portfolio with a `strategy` key set bypasses `decideSetup()`
  entirely, confluence block included. Filters are unreachable in that path, not merely inert.
- **`--split=all`** in the sweep script has **no held-out half**. It exists only for `--byYear`
  regime checks on an already-chosen variant. Never select anything with it.
- **Do not re-tune the 13 confluence filters, cross-sectional mean reversion, or
  cross-sectional momentum.** All three loops are closed and documented as rejected.
- **Live trading cannot measure an edge.** 5 slots on weekly bars ≈ 15–25 closed trades per
  8 weeks; sd(R) ≈ 1.39 → SE ±0.31R against an effect size ~0.04R. n comes from the sweep
  harness, not from waiting. Live runs verify plumbing, nothing else.
- **Blind-test a research strategy before approving it — every time, without asking.**
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
- **Pick a window policy** before any research code changes — see §4f and
  `docs/PROPOSAL-panel-validation.md`. The proposal is a walk-forward panel over all 491 cached
  symbols with three disjoint folds (train / select / test), a matched random-entry control, and
  a monthly block bootstrap. Adopting it makes every stored `backtestSummary` non-comparable, so
  it is the owner's call, not a refactor.
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
