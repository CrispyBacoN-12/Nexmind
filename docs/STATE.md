# NEXMIND — Session State

**Living handoff. Read this first; update it before you finish.**
Auto-loaded every session via `CLAUDE.md`. Dated deep-dives live in `docs/quant/`;
this file is the current bar, not the archive.

_Last verified against the live DB + working tree: **2026-08-24**, branch `stocks-only-pivot`, HEAD `565fd55`._

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

## 2. Live state (verified by query, 2026-08-24)

| Thing | Value |
|---|---|
| Portfolios | **one**: #11 "US Stocks Desk", active, kill switch off, 5 slots, $10k paper |
| Desk #11 strategy | **`combo-vote`** (built-in) — no longer `research-29` |
| Open trades | 4 (KO, AZO, XOM, KMX), all `aiBackend = "mock"` |
| Closed trades | 35, cumulative **−$378.87** |
| AI backend on every trade ever | `mock` (37) or null (2) — **HAWK/SAGE have never decided a real trade** |
| `Counterfactual` rows | 3 (was 0 — the arm recorder finally fires; sample far too small) |
| `ResearchStrategy` | 40 approved / 168 rejected / 3 demoted / 1 proposed |
| …of the 40 approved | **34 are labelled `Mock *`** — junk from the mock backend, still approved |
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

## 4. Next steps, highest value first

### a. The blind-test gate has never passed a real candidate — check it isn't broken

The one live run of the new gate (strategy 212) returned
`"AAPL: could not fetch enough deep history (need >=400 days)"` → rejected by the
fail-closed branch. That is the correct policy on a *data* failure, but if the deep fetch
(`DEEP_RANGES = ["5y","2y"]` in `src/lib/research/blindTest.ts`) never succeeds, the gate
rejects **everything** forever and the research loop is dead in a way that looks like rigor.
Run `runBlindTest` on a known-good symbol and confirm the 5y daily fetch really returns
≥400 days through `src/lib/marketData.ts`.

### b. Purge the 34 `Mock *` approvals

They cleared the old bar under the mock backend and are still `approved`, i.e. still
activatable. The re-vet script only demoted 3 rows. Either widen the re-vet or reject the
mock-labelled ones outright — nothing decided by the mock path should be approvable.

### c. Retire the legacy 0.8:1 research ladder

`RESEARCH_ATR_TP_MULT = 1.2` / `SL 1.5` (`src/lib/trading/engine.ts:49-51`) is still the
fallback for approved rows that predate `exitLadder`. In the weekly sweep, `single 1.2 ATR`
was the **worst of 20 variants** despite the highest win rate. New candidates carry their own
ladder now, so the remaining job is to stop legacy rows trading the known-bad one — backfill
their `exitLadder`, or refuse to activate a row without one. Do **not** simply swap 1.2 → 2.5:
that variant failed OOS as a pick. The defensible claim is only "0.8:1 is measurably bad".

### d. Risk-normalise the sweep, then decide on the trailing stop

`scripts/exit-geometry-sweep.mts` sizes every trade at lot 1, so its PF column is a dollar
ratio dominated by high-priced, high-ATR names (on daily IS it contradicts totalR outright).
The live desk sizes to constant dollar risk (`computeLot`), under which summing R *is*
summing dollars — so totalR is the honest column today and PF is noise. Fix the sizing before
quoting PF, then reconsider shipping `trail 1.5/1.5` (+0.021 avgR, ~36% more trades on
weekly). Blockers on shipping it: idealised stop fills (gaps aren't modelled) and survivorship
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
- Next.js 16 here has breaking changes vs. training data; read `node_modules/next/dist/docs/`
  before writing app code (`AGENTS.md`).

## 6. Blocked on the user (still open)

- `FINNHUB_API_KEY` is set in local `.env` but **empty as a GitHub Actions secret**, so
  `fundamentalsLine()` and the INTEL news block reach HAWK/SAGE as empty strings in
  production: `gh secret set FINNHUB_API_KEY --repo CrispyBacoN-12/Nexmind`.
  (User must run it — do not handle the key; `gh` also has no network from the sandbox.)
- Dead Windows scheduled tasks are still registered and firing at a stocks-only app —
  `NEXMIND Bitcoin scan`, `NEXMIND Gold scan`, `NEXMIND Intraday scan`, `NEXMIND Options scan`
  (keep `NEXMIND Stocks scan` and `NEXMIND Manage positions`):
  `Unregister-ScheduledTask -TaskName 'NEXMIND Bitcoin scan','NEXMIND Gold scan','NEXMIND Intraday scan','NEXMIND Options scan' -Confirm:$false`
- `git rm -r --quiet rl mt5-bridge/__pycache__` — `rl/` is still tracked after the pivot.
- Confirm why desk #11 runs **`combo-vote`** and not `trend-pullback`
  (`scripts/revert-stocks-desk-to-default.ts` sets `trend-pullback`; something set combo-vote
  instead). Whichever is intended, the other is a silent mismatch.

## 7. Housekeeping for whoever writes here next

1. Update §2 only from a **real query**, never from what this file used to say.
2. Move anything finished out of §4 into §3 with its commit hash.
3. A rejected mechanism goes in §5 so it is never re-tuned; link its `docs/quant/` file.
4. Keep this file under ~150 lines. Deep evidence belongs in `docs/quant/`, not here.
