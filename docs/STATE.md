# NEXMIND — Session State

**Living handoff. Read this first; update it before you finish.**
Auto-loaded every session via `CLAUDE.md`. Dated deep-dives live in `docs/quant/`;
this file is the current bar, not the archive.

_Last verified against the live DB + working tree: **2026-08-25**, branch `stocks-only-pivot`.
§2 re-queried after the mock purge below; §3 and §4 updated after the exit-ladder,
blind-test-gate and mock-cycle work._

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
| `ResearchStrategy` | **6 approved** / 168 rejected / 37 demoted / 1 proposed (34 mock rows demoted 08-25) |
| …the 6 survivors | all on **BTC-USD / GC=F / NG=F** — none on a stock; none has a blind test |
| Schema | `blindTest`, `exitLadder`, `demotedReason` columns are pushed and live |

Re-verify with a throwaway script under `scripts/` (delete it afterwards):

```bash
node --env-file=.env --import tsx scripts/tmp-state.mts
```

…querying `portfolio.findMany` (the field is `status`, **not** `active`),
`trade.groupBy({ by: ["status"] })`, `researchStrategy.groupBy({ by: ["status"] })`.

## 3. Done recently (2026-08-23 → 08-24)

- **Stocks-only pivot finished** — gold/forex/crypto/options desks and their watchlist seeds gone.
- **Confluence filters: all 13 rejected** IS/OOS (`docs/quant/2026-08-23-confluence-filter-sweep-results.md`). Loop closed.
- **Exit-geometry sweep** (`docs/quant/2026-08-24-exit-geometry-sweep-results.md`) — ATR
  **trail 1.5/1.5 passed the full protocol** (pre-registered, OOS-confirmed, 10/10 weekly
  years, control failed). Evidence only; **not shipped anywhere**.
- **Research pipeline rigor** (86d489b → 565fd55):
  - approval is now gated on a held-out blind test (`applyBlindTestVerdict`, fails **closed**),
  - `revet-research-strategies.mts` retro-demotes stale approvals — **research-29 is demoted**
    ("re-vet 2026-08-24: no longer clears the bar (trades=8)"), along with #7 and #28,
  - each candidate sweeps and carries **its own exit ladder** (`exitLadder` → `preferredExit`).
- Desk #11 taken off research-29 — the pending DB write from the old handoff **is done**.
- **Exit sweep risk-normalised** — `score()` in `exit-geometry-sweep.mts` computes PF over
  R instead of over lot-1 dollars, so the PF and totalR columns stopped contradicting each
  other. Both OOS tables re-run: weekly baseline 1.09 → trail **1.16**, daily baseline
  0.97 → **1.02**, trail 1.09 → **1.14**. Direction unchanged. Caveat 3 of the sweep doc
  is closed.
- **Research loop can now choose the validated trail.** `sweepLadder` sweeps
  `LADDER_OPTIONS` (4 fixed targets + `trail 1.0/1.5` and `trail 1.5/1.5`) and selects on
  **avgR**, not dollar profit factor. `wrapAsStrategy` and `runBlindTest` carry `trail`
  through, so a swept trail reaches the desk and is validated as a trail. Two side effects
  worth knowing: **1.0 and 1.2 are gone from `LADDER_TP_MULTS`** (sub-1:1 against the
  1.5 ATR stop — §4c below is now only about legacy rows), and the old
  `profitFactor ?? -Infinity` ranked a zero-loss ladder as strictly *worst*, which is why
  no trail could ever have won that comparison.
- **Blind-test gate was broken; fixed and now demonstrably runs.** §4a's fear was correct.
  Root cause was **silent provider truncation**, not the 400-day floor: `fetchWebullCandles`
  caps every request at 1200 bars (`rangeToWebullCount`), which at `1h` is ~256 calendar
  days, and `fetchCandles` accepted that non-empty response as data. Both `DEEP_RANGES`
  hit the same cap, so **every intraday candidate was rejected forever**, and because Webull
  is flaky the verdict flipped with whichever provider answered — a *non-deterministic*
  gate, worse than a dead one. Fix: `fetchCandles` takes `minDays` and treats a short
  response as a provider miss (Yahoo stays last, so a genuinely young listing still returns);
  the deep-fetch loop stops swallowing errors and names why each range failed. Verified end
  to end — `runBlindTest(212)` now returns **236 held-out trades over 3981 bars / 364 days**
  instead of `{ error }`.
- **Research half of the mock cycle cut.** `proposeCandidates` now reports its `backend`, and
  `isBankableRound` (pure, tested) makes `runResearch` **fail closed** on a mock-proposed
  round: the run is banked `status: "skipped"` with zero strategies instead of persisting
  the three hardcoded `Mock *` snippets as approvable research. Manual candidates are exempt
  (they skip the proposer by design). The cron log names the skip; the research page renders
  a `skipped` badge rather than falling through to green `done`. Then the backlog was purged —
  all 87 mock rows identified by **exact code match** against `mockCandidates()` (label prefix
  agreed on all 87, zero disagreement), the 34 still `approved` demoted with a
  `demotedReason`; none was live on a portfolio. **This is the code half only** — see §6.
- **Desk half of the mock cycle cut: no AI backend, no new position.** Owner's call on
  2026-08-25, overruling the previous session's deliberate "degrade rather than fail". The
  rule-only fallback was honest (`aiBackend = "mock"` on every row) but it meant 45 of 45
  trades and −$378.87 were decided by nobody. `runTradeTick` now returns the new outcome
  **`no-ai-backend`** instead of opening, and the two *mid-flight* fallbacks (HAWK throws →
  mockHawk, SAGE throws → mockSage, which approves everything) refuse the same way — the
  SAGE one had been turning the risk veto into a rubber stamp exactly when risk review was
  unavailable. `mockHawk`/`mockSage` survive only as the counterfactual baseline and can no
  longer decide anything. **Position management is untouched** (`manage.ts` has no AI
  dependency at all — verified), so open trades still exit normally; stranding a live
  position would be worse than the problem. `runScheduledScan` logs one loud banner up front
  rather than N identical per-symbol lines, and `scan-universe` counts `no-ai-backend` as a
  *setup* so an outage cannot be misread as a quiet market.
- **The loops now run on the local Windows box, not in the cloud.** Owner's call on
  2026-08-25: stay local until the system settles. Both GitHub Actions `schedule:` triggers
  are commented out (`swing-scan.yml`, `research-round.yml`); `workflow_dispatch` is kept so
  either is one click from returning, and each file carries the reason and the re-enable
  condition. With `vercel.json` crons already `[]`, **nothing in the cloud can now open a
  trade or bank a strategy** — the Vercel deployment is the read-only UI. (`cleanup-signals.yml`
  still curls Vercel weekly; it is pure DB maintenance and decides nothing.) The local
  backend was verified properly this time — not a `claude --version` probe but a live
  `callAgent`, which returned `cli:haiku` at $0 on subscription auth. `C:\Users\Kannithi\.local\bin`
  is on the persisted **User** PATH, so Task Scheduler sees the CLI too.

## 4. Next steps, highest value first

### a. The blind test runs now — but its pass bar is far too low

Fixed and verified (§3). The gate is no longer inert; the open question is what it *asks*.
`evaluateHoldout` passes anything with ≥20 held-out trades and **expectancy > 0**. On the
first real run the candidate degraded from **in-sample avgR 0.63 → held-out 0.063** (PF
2.14 → 1.06, Sharpe 5.7 → 0.50) and still `passed: true`. A 10× degradation is the textbook
overfit signature and this gate waves it through. Options: require the held-out PF to clear
`MIN_PROFIT_FACTOR` (1.1) the way `autoReview` already requires in-sample, and/or reject
when held-out expectancy is below some fraction of in-sample. Pick a rule **before** looking
at more candidates, or it is fitted to them.

Two smaller things found in the same pass, neither fixed:

- Yahoo returned **3473 bars then 7984 bars** for the identical `AAPL 2y/1h` request
  minutes apart (~4.8 vs ~11 bars/day — extended-hours inclusion flipping). A held-out
  result that is not reproducible bar-for-bar is not really held out. Worth pinning.
- Strategy **212 is still `rejected`** in the DB on the old data error. It is only a
  smoke test, so it was left alone — do not read that row as a verdict.

### b. The approved pool is now empty for this app's actual universe

The purge is done (§3), and what it uncovered is the real problem: the 6 surviving approvals
are **BTC-USD, GC=F, NG=F** — instruments the stocks-only pivot removed — and **not one of
them has a blind test**. There is no validated stock strategy in the pool at all. Until the
loop can propose again (§6), the only route to one is a hand-authored candidate through
`runResearch`'s `manualCandidates` path. Decide whether the 6 get demoted as off-universe or
re-validated on stocks; do not read "6 approved" as "6 usable".

### c. Retire the legacy 0.8:1 research ladder — **legacy rows only, now**

New candidates can no longer be assigned a sub-1:1 ladder (1.0 and 1.2 removed from
`LADDER_TP_MULTS`). What is left: `RESEARCH_ATR_TP_MULT = 1.2` / `SL 1.5`
(`src/lib/trading/engine.ts:49-51`) is still the fallback in `resolveExitOverride` for
approved rows persisted before `exitLadder` existed, and `LEGACY_TP1_MULT` is the same
fallback in `blindTest.ts`. Backfill those rows' `exitLadder` by re-sweeping them, or refuse
to activate a row without one. Do **not** simply swap 1.2 → 2.5: that variant failed OOS as
a pick. The defensible claim is only "0.8:1 is measurably bad".

### d. Decide whether the desk's own default exit becomes a trail

The sweep is risk-normalised (§3) and the research loop can now pick a trail, but
**`resolveExitOverride`'s no-override path and the backtest engine's `ATR_TP_MULT` are
untouched** — a built-in strategy like the `combo-vote` desk #11 actually runs still exits
on the 1.5/2.5 ladder. On weekly, the desk's timeframe, the trail is +0.021 avgR and ~36%
more trades. Blockers before shipping it as the default: idealised stop fills (gaps aren't
modelled, and a trail exits at a stop far more often than a ladder does) and survivorship
bias in `.cache/bars/sp500-1d.json`. `1.0/1.5` performs nearly as well — do not present
1.5/1.5 as an optimum.

### e. Unswept: the ADX-descending candidate ranking in `runScan.ts` (697b295)

It replaced alphabetical order — better, but never swept as a ranking.

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
- **Never restore a mock fallback that can decide something.** Both halves were cut on
  2026-08-25 (§3). `mockHawk`/`mockSage` and `mockCandidates` still exist — as the
  counterfactual baseline and as the purge script's fingerprint respectively — but the
  moment either can open a trade or bank a strategy, the whole record becomes unreadable
  again. The failure mode is not dishonesty (the old code labelled everything correctly);
  it is that a correctly-labelled placeholder accumulates into the majority of the dataset
  while nobody is reading labels.
- Next.js 16 here has breaking changes vs. training data; read `node_modules/next/dist/docs/`
  before writing app code (`AGENTS.md`).

## 6. Blocked on the user (still open)

- **Register the local Task Scheduler jobs** — this is what actually runs the product now
  (§3). Only the owner can touch Windows scheduled tasks. Two parts:
  - Drop the four dead desks still firing at a stocks-only app (they log "no matching
    portfolios" every 15 min): `Unregister-ScheduledTask -TaskName 'NEXMIND Bitcoin scan','NEXMIND Gold scan','NEXMIND Intraday scan','NEXMIND Options scan' -Confirm:$false`
  - **There is no local research task at all.** `scripts/research-round.cmd` exists and works;
    nothing is scheduled to call it, so QUANT proposes nothing until one is registered.

  Keep `NEXMIND Stocks scan` (`scan.cmd 11`, daily 05:00 — desk #11 is `1wk/5y` on `sp500`,
  so daily is ample) and `NEXMIND Manage positions` (every 15 min).

  The cloud credential question is **deferred, not solved**: Vercel has no
  `ANTHROPIC_API_KEY`, and the GH runner installs the CLI and passes
  `CLAUDE_CODE_OAUTH_TOKEN` yet still produced `mock` — unexplained. Diagnose
  `aiBackend()`'s CLI probe on the runner before re-enabling either schedule.
- `FINNHUB_API_KEY` is **empty as a GitHub Actions secret** — parked, not urgent, while the
  loops run locally off `.env` where the key is set. It matters again the day a schedule is
  re-enabled: `gh secret set FINNHUB_API_KEY --repo CrispyBacoN-12/Nexmind` (user runs it —
  do not handle the key).
- `git rm -r --quiet rl mt5-bridge/__pycache__` — `rl/` is still tracked after the pivot.
- Confirm why desk #11 runs **`combo-vote`** and not `trend-pullback`
  (`scripts/revert-stocks-desk-to-default.ts` sets `trend-pullback`; something set combo-vote
  instead). Whichever is intended, the other is a silent mismatch.

## 7. Housekeeping for whoever writes here next

1. Update §2 only from a **real query**, never from what this file used to say.
2. Move anything finished out of §4 into §3 with its commit hash.
3. A rejected mechanism goes in §5 so it is never re-tuned; link its `docs/quant/` file.
4. Keep this file under ~150 lines. Deep evidence belongs in `docs/quant/`, not here.
