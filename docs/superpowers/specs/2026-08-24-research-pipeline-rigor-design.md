# Research Pipeline Rigor — Design

## Goal

Close the three gaps that let `research-29` ("RSI-50 Momentum Cross (weekly)",
an 8-trade backtest) run live on portfolio 11's entire S&P 500 universe and
lose ≈$379 at a 0.8:1 reward:risk ladder requiring a >55.6% win rate to break
even, while only hitting ~43%:

1. **No held-out validation gates approval.** `autoReviewStatus()` judges only
   the in-sample backtest computed inside `runOneCandidate()`. A small,
   curve-fit-prone sample (8 trades) can clear the bar on noise alone.
   `src/lib/research/blindTest.ts` already implements deep-history held-out
   validation (`runBlindTest(id)`) but nothing calls it during approval.
2. **The bar has tightened without retroactive enforcement.** `MIN_TRADES`
   went from whatever it was when `#29` was approved to 20 today; `#29`'s
   8-trade row was never re-checked. Other currently-`"approved"` rows may
   have the same problem.
3. **Every research candidate is forced through one hardcoded exit ladder**
   (`tp1Mult=1.2`, `slMult=1.5` — both in `runOneCandidate()`'s backtest and,
   live, in `engine.ts`'s `resolveExitOverride()`). This is internally
   consistent (not a drift bug) but means no candidate's own validated
   reward:risk ever reaches the live desk — unlike built-in strategies, which
   declare a tuned `preferredExit` via `strategies.ts`.

This is a pure backend/pipeline change: no new UI surface beyond one badge
tweak (Feature 2) and no user-facing workflow change. The AI research loop
keeps running unattended (`nexmind-quant-research-round` scheduled task);
these changes make what it *approves* trustworthy.

## Architecture

Three additive layers on the existing pipeline, in dependency order:

```
runOneCandidate() -----> in-sample backtestSummary --> autoReviewStatus()
        |                                                      |
        |  (Feature 3, later)                                  v
        +--> ladder sweep --> exitLadder JSON          "approved"/"rejected"
                                     |                          |
                                     v                          v
                          wrapAsStrategy() reads          runBlindTest(id)
                          exitLadder -> preferredExit      (Feature 1)
                          (live desk gets the real               |
                           validated ladder, not the             v
                           0.8:1 constant)                 final status
```

Feature 1 (blind-test gate) ships first and works against the *current*
hardcoded 1.2/1.5 ladder — it does not need Feature 3. Feature 3 lands last
and, when it does, also updates `blindTest.ts` to validate against each
candidate's *own* swept ladder instead of the hardcoded constant, so the
held-out test and the live ladder never drift apart again. Feature 2
(retroactive re-vet) is independent of both and can run any time after
Feature 1, using data that already exists.

## Tech Stack

No new dependencies. Same stack as the rest of the research pipeline:
Prisma (SQLite dev DB), `node:test` + `node:assert/strict` for tests (this
repo's existing convention — no mocking library; pure functions are
extracted and tested directly, per `autoReview.test.ts` and
`blindTest.test.ts`), `tsx` for one-off scripts.

## Feature 1: Gate approval on `blindTest.ts`

**Current state:** `runResearch.ts` computes an in-sample `summary` inside
`runOneCandidate()`, calls `autoReviewStatus(summary, safetyFlag)`, and
persists that status directly. `blindTest.ts`'s `runBlindTest(strategyId)`
requires a persisted row (it does `prisma.researchStrategy.findUnique`), so
it can only run *after* the row exists — the gate has to be a post-persist
update, not an inline decision inside `runOneCandidate()`.

**New flow in `runResearch()`:**

```ts
const created = await prisma.researchStrategy.create({
  data: { runId: run.id, label: r.label, code: r.code, status: r.status,
    iterations: JSON.stringify(r.iterations),
    backtestSummary: JSON.stringify(r.backtestSummary),
    safetyFlag: r.safetyFlag },
});

let finalStatus = created.status;
let blindTestJson = "{}";
if (created.status === "approved") {
  const verdict = await runBlindTest(created.id);
  const applied = applyBlindTestVerdict(created.status, verdict);
  finalStatus = applied.status;
  blindTestJson = applied.blindTestJson;
  if (finalStatus !== created.status) {
    await prisma.researchStrategy.update({
      where: { id: created.id },
      data: { status: finalStatus, blindTest: blindTestJson },
    });
  } else {
    await prisma.researchStrategy.update({ where: { id: created.id }, data: { blindTest: blindTestJson } });
  }
}
```

`applyBlindTestVerdict` is a new pure, exported function in `blindTest.ts`
(same file as `evaluateHoldout`, same testing pattern):

```ts
export function applyBlindTestVerdict(
  inSampleStatus: "approved" | "rejected",
  verdict: BlindTestResult,
): { status: "approved" | "rejected"; blindTestJson: string } {
  if (inSampleStatus !== "approved") {
    return { status: inSampleStatus, blindTestJson: "{}" };
  }
  if ("error" in verdict) {
    // Lean conservative: a candidate whose held-out data we could not
    // fetch/validate does not get to trade live on an unverified claim.
    return { status: "rejected", blindTestJson: JSON.stringify({ error: verdict.error }) };
  }
  return {
    status: verdict.passed ? "approved" : "rejected",
    blindTestJson: JSON.stringify(verdict),
  };
}
```

Rejected-in-sample candidates never call `runBlindTest` — no wasted deep-history
fetch for a candidate that already failed.

**Schema:** add `blindTest String @default("{}")` to `ResearchStrategy` —
persists the full `BlindTestResult` (or `{error}`) that decided (or
confirmed) the final status, for audit/debugging. Defaults to `"{}"` for
every pre-existing row, meaning "blind test not run" (all rows created
before this ships).

## Feature 2: Retroactively re-vet existing approvals

**Problem:** `MIN_TRADES`/`MIN_PROFIT_FACTOR` in `autoReview.ts` are current
constants; nothing re-checks a row after the bar tightens. `autoReviewStatus`
is already pure and takes a `BacktestSummary` — it can be replayed against any
already-stored `backtestSummary` with zero new fetching or AI calls.

**New script:** `scripts/revet-research-strategies.mts` (one-time,
survives as a repeatable maintenance script — not a temp file, since the bar
can tighten again):

```ts
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { autoReviewStatus } from "../src/lib/research/autoReview";
import type { BacktestSummary } from "../src/lib/backtest/engine";

async function main() {
  const approved = await prisma.researchStrategy.findMany({ where: { status: "approved" } });
  const portfolios = await prisma.portfolio.findMany({ where: { status: "active" }, select: { id: true, name: true, strategy: true } });

  let demoted = 0;
  for (const row of approved) {
    let summary: BacktestSummary;
    try {
      summary = JSON.parse(row.backtestSummary || "{}");
    } catch {
      continue; // unparseable summary — leave as-is, flag for manual look
    }
    const recheck = autoReviewStatus(summary, row.safetyFlag);
    if (recheck === "approved") continue;

    await prisma.researchStrategy.update({
      where: { id: row.id },
      data: {
        status: "demoted",
        demotedReason: `re-vet ${new Date().toISOString().slice(0, 10)}: no longer clears autoReviewStatus (trades=${summary.trades}, profitFactor=${summary.profitFactor ?? "n/a"}, expectancy=${summary.expectancy ?? "n/a"})`,
      },
    });
    demoted++;
    console.log(`demoted #${row.id} "${row.label}" — trades=${summary.trades}`);

    const key = `research-${row.id}`;
    const dependents = portfolios.filter((p) => p.strategy === key);
    for (const p of dependents) {
      console.warn(`WARNING: active portfolio #${p.id} "${p.name}" still points at demoted strategy ${key} — getResearchStrategy() will now return null for it; the portfolio needs a strategy reassignment.`);
    }
  }
  console.log(`\n${demoted}/${approved.length} approved strategies demoted.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Demoted rows use a **new status value, `"demoted"`**, distinct from
`"rejected"` — a rejected row never passed the pipeline; a demoted row did,
under a bar that has since moved. Both are equally non-live
(`getResearchStrategy()` only ever activates `status: "approved"` rows, so
`"demoted"` is excluded automatically with no change to that function), but
the audit trail should show *why* differently.

**Schema:** add `demotedReason String?` to `ResearchStrategy` (nullable —
only set on demotion).

**UI (small, contained):** `ResearchPanel.tsx`'s `status` union type and
`strategyBadge()` (in `src/app/research/page.tsx`) currently only handle
`"proposed" | "approved" | "rejected"`. Widen both to include `"demoted"`,
rendered with a `negative` tone badge (same visual weight as rejected — it's
not live-eligible) but its own literal label so it reads distinctly:

```ts
// src/app/research/page.tsx
function strategyBadge(status: string, safetyFlag: boolean) {
  if (safetyFlag) return <Badge tone="negative">unsafe</Badge>;
  if (status === "approved") return <Badge tone="positive">approved</Badge>;
  if (status === "demoted") return <Badge tone="negative">demoted</Badge>;
  if (status === "rejected") return <Badge tone="neutral">rejected</Badge>;
  return <Badge tone="warning">proposed</Badge>;
}
```

(`ResearchPanel.tsx`'s own `status` field type and its inline
`s.status === "approved" ? "positive" : s.status === "rejected" ? "negative" : "neutral"`
ternary get the same `"demoted"` case added, same tone convention.)

Per this repo's `AGENTS.md` ("read the relevant guide in
`node_modules/next/dist/docs/` before writing any code"), the implementer
must check current Server/Client Component conventions before touching
`src/app/research/page.tsx`, since page/route file conventions in this
Next.js version may differ from training data.

## Feature 3: Per-candidate exit ladder

**Problem:** `runOneCandidate()`'s `runBacktest()` hardcodes
`tp1Mult=1.2` (and the implicit default `slMult=1.5`) for every candidate,
regardless of what ratio actually suits that candidate's edge.
`wrapAsStrategy()` never sets `preferredExit`, so `resolveExitOverride()`
always falls through to the same hardcoded `RESEARCH_ATR_SL_MULT`/
`RESEARCH_ATR_TP_MULT` live. Built-in strategies avoid this entirely by
declaring a tuned `preferredExit` (see `strategies.ts` — values of
1.0/1.5/2.0/3.0 across different entries, chosen via manual Backtest Lab
sweeps, precedented by the standalone `scripts/sweep-rr.ts`).

**New sweep, run once per candidate, after refinement finishes (not per
refinement round — refinement rounds must keep comparing apples to apples
against the fixed 1.2 ladder they already use, so a candidate's own
improvement is judged independent of ladder choice; only the *final* code
gets ladder-swept):**

```ts
// src/lib/research/runResearch.ts
const LADDER_SL_MULT = 1.5; // unchanged — same SL distance as before
const LADDER_TP_MULTS = [1.0, 1.2, 1.5, 2.0, 2.5, 3.0];

function sweepLadder(
  code: string,
  bars: Awaited<ReturnType<typeof fetchCandles>>["candles"],
  snaps: ReturnType<typeof computeSnapshots>,
): { ladder: { tp1Mult: number; slMult: number; singleTarget: true }; summary: BacktestSummary } {
  const compiled = compileStrategy(code);
  const entry = (i: number) => compiled.invoke(bars, snaps, i)?.side ?? null;
  let best: { ladder: { tp1Mult: number; slMult: number; singleTarget: true }; summary: BacktestSummary } | null = null;
  for (const tp1Mult of LADDER_TP_MULTS) {
    const bt = backtestCandles("sweep", bars, 0.1, undefined, entry, true, tp1Mult, RESEARCH_COST_MODEL, LADDER_SL_MULT);
    const summary = summarizeBacktest(bt.trades);
    const pf = summary.profitFactor ?? -Infinity;
    const bestPf = best ? best.summary.profitFactor ?? -Infinity : -Infinity;
    const better =
      !best ||
      pf > bestPf ||
      (pf === bestPf && (summary.expectancy ?? -Infinity) > (best.summary.expectancy ?? -Infinity));
    if (better) best = { ladder: { tp1Mult, slMult: LADDER_SL_MULT, singleTarget: true }, summary };
  }
  return best!; // LADDER_TP_MULTS is non-empty — always at least one candidate
}
```

Called from `runOneCandidate()` right before the final `autoReviewStatus`
call, replacing the last fixed-1.2 `runBacktest(code)` result with the swept
best:

```ts
const swept = sweepLadder(code, bars, snaps);
summary = swept.summary;
iterations.push({ code, note: "ladder sweep", backtestSummary: summary });
// ... return includes exitLadder: swept.ladder
```

**Schema:** add `exitLadder String @default("{}")` to `ResearchStrategy` —
JSON `{tp1Mult, slMult, singleTarget}`. `runResearch()`'s persist call adds
`exitLadder: JSON.stringify(r.exitLadder)`.

**`wrapAsStrategy()` change** (`src/lib/research/adapter.ts`) — attach the
persisted ladder as the returned `Strategy`'s `preferredExit`, exactly the
shape `scanner.ts:298` already reads off any `Strategy` object
(`preferredExit: strat?.preferredExit`) — no scanner/engine change needed,
this is purely supplying the field built-ins already supply:

```ts
export function wrapAsStrategy(researchStrategy: {
  id: number; label: string; code: string; exitLadder?: string;
}): Strategy {
  let preferredExit: Strategy["preferredExit"];
  try {
    const parsed = JSON.parse(researchStrategy.exitLadder || "{}");
    if (typeof parsed.tp1Mult === "number") {
      preferredExit = { tp1Mult: parsed.tp1Mult, singleTarget: parsed.singleTarget ?? true, slMult: parsed.slMult };
    }
  } catch { /* malformed/missing — falls back to engine.ts's RESEARCH_* constants, same as today */ }

  return {
    key: `research-${researchStrategy.id}`,
    label: `${researchStrategy.label} (research)`,
    ...(preferredExit ? { preferredExit } : {}),
    build(bars: Candle[]): StrategyEvaluator {
      const snaps = computeSnapshots(bars);
      const compiled = compileStrategy(researchStrategy.code);
      return (i: number) => compiled.invoke(bars, snaps, i);
    },
  };
}
```

`getResearchStrategy()` already fetches the full row (`findFirst`), so
`row.exitLadder` is available with no query change — just pass `row` through
unchanged (it's already a superset of the type `wrapAsStrategy` declares).

**`blindTest.ts` update (closes the loop so held-out validation matches the
live ladder):** replace the hardcoded `RESEARCH_TP1_MULT = 1.2` backtest call
with the candidate's own persisted `exitLadder`:

```ts
// inside runBlindTest, after fetching `strategy`:
let ladder: { tp1Mult: number; slMult: number; singleTarget: boolean };
try {
  const parsed = JSON.parse(strategy.exitLadder || "{}");
  ladder = typeof parsed.tp1Mult === "number"
    ? { tp1Mult: parsed.tp1Mult, slMult: parsed.slMult ?? 1.5, singleTarget: parsed.singleTarget ?? true }
    : { tp1Mult: RESEARCH_TP1_MULT, slMult: 1.5, singleTarget: true }; // pre-Feature-3 rows have no exitLadder yet
} catch {
  ladder = { tp1Mult: RESEARCH_TP1_MULT, slMult: 1.5, singleTarget: true };
}
// ...
const bt = backtestCandles(symbol, holdoutBars, RESEARCH_LOT, undefined, entry, ladder.singleTarget, ladder.tp1Mult, DEFAULT_COST_MODEL, ladder.slMult);
```

This means Feature 3 must ship after Feature 1 (it edits the same
`runBlindTest` body Feature 1 already touched) — matches the user-specified
build order (a, b, c) exactly; no reordering needed.

## Testing & verification

- `applyBlindTestVerdict` (Feature 1): pure-function unit tests in
  `blindTest.test.ts` — approved+passed, approved+failed (each `reasons`
  case), approved+error, rejected-in-sample (never calls blind test, always
  passthrough).
- `autoReviewStatus` replay (Feature 2): the re-vet script reuses the
  already-tested pure function; no new logic to unit test beyond a check
  that a below-bar stored summary produces `"demoted"` via a small script
  smoke-test (documented in Task 2, not a permanent test file, since the
  script itself has no branching logic worth a unit test beyond what
  `autoReview.test.ts` already covers).
- `sweepLadder` (Feature 3): unit test in a new
  `src/lib/research/runResearch.test.ts` — feed a small synthetic candle
  series and confirm the returned ladder is one of `LADDER_TP_MULTS` and its
  `summary.profitFactor` is >= every other swept option's (a monotonicity
  check against re-running `backtestCandles` directly for each multiplier).
- `wrapAsStrategy` ladder passthrough (Feature 3): unit test in a new
  `src/lib/research/adapter.test.ts` — a row with a valid `exitLadder` JSON
  produces a `Strategy` whose `.preferredExit.tp1Mult` matches; a row with
  `exitLadder: "{}"` (pre-Feature-3 legacy row) produces `preferredExit:
  undefined` (falls through to `engine.ts`'s existing constants, unchanged
  behavior for every row that predates this feature).
- Manual smoke check for the Feature 1 orchestration wiring (DB + AI-call
  integration, not unit-testable without a mocking framework this repo
  doesn't use): implementer runs one real `runResearch()` call via a
  throwaway `.mts` script (per this session's established convention) against
  a manual candidate, confirms the persisted row's `blindTest` column is
  populated and `status` reflects the held-out verdict, then deletes the
  script.

## Build order

1. Schema migration: add `blindTest`, `exitLadder` (both `String
   @default("{}")`, non-breaking for existing rows) and `demotedReason`
   (`String?`) to `ResearchStrategy` in one `prisma migrate dev` — all three
   columns land together since splitting the migration across tasks would
   mean re-running `prisma generate` mid-plan for no benefit; each Feature's
   task only *uses* the columns it needs.
2. Feature 1 (blind-test gate) — Task 1.
3. Feature 2 (retroactive re-vet + demoted status + badge) — Task 2.
4. Feature 3 (per-candidate ladder + `blindTest.ts` follow-up update) — Task 3.

Each task ships independently: portfolio 11 already runs `combo-vote` (the
2026-08-24 stopgap), so no task in this plan needs to touch live trading
config to be safe to land task-by-task.
