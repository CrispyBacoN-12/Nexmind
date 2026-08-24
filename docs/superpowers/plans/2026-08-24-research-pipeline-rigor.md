# Research Pipeline Rigor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three structural gaps that let an under-sampled, curve-fit-prone research strategy (`research-29`, approved on 8 trades, ~$376 net loss live) reach live trading undetected: gate approval on held-out validation, retroactively re-vet existing approvals against the current bar, and give every research strategy its own validated exit ladder instead of a uniform one.

**Architecture:** Three independent features, built in a fixed dependency order because Feature 3 changes the same function (`runBlindTest`) that Feature 1 wires into the approval gate:

```
Feature 1 (blind-test gate)          Feature 2 (retroactive re-vet)         Feature 3 (per-candidate ladder)
runResearch() persists a row    ┌──▶ scripts/revet-research-           runOneCandidate() sweeps a ladder
  │                             │    strategies.mts demotes already-        after refinement finishes
  ├─ if approved in-sample:     │    approved rows that fail the             │
  │    runBlindTest(id)         │    CURRENT autoReviewStatus() bar          ├─ wrapAsStrategy() attaches it
  │    → applyBlindTestVerdict  │    (independent of Feature 1/3,            │  as preferredExit (static field,
  │    → update status+blindTest│     reads only already-stored data)        │  scanner.ts already reads it)
  └─ (rejected in-sample: skip, │                                            │
      no blind test, no cost)  │                                            └─ blindTest.ts's runBlindTest()
                                │                                                 updated a 2nd time to read
                                │                                                 the candidate's own ladder
                                └── independent of 1 & 3, ships any time         instead of the hardcoded 1.2
```

Feature 1 must land before Feature 3 touches the same file a second time (Feature 3's `blindTest.ts` edit is additive to Feature 1's, not a redesign). Feature 2 has no code dependency on 1 or 3 and could ship in any order, but stays last to match the user's requested (a, b, c) sequence.

**Tech Stack:** No new dependencies. Follows this codebase's existing conventions: plain `node:test` + `node:assert/strict` (no mocking framework exists here — decision logic is extracted into pure, exported functions and tested directly; DB/network-touching orchestration is verified only via a manual, deletable `.mts` smoke script, same pattern as `scripts/tmp-flip-strategy.mts`).

**Spec:** `docs/superpowers/specs/2026-08-24-research-pipeline-rigor-design.md`

## Global Constraints

- `MIN_TRADES = 20`, `MIN_PROFIT_FACTOR = 1.1` (`src/lib/research/autoReview.ts`) — the current approval bar; Feature 2 re-vets against these exact values, read live from that module, never hardcoded a second time.
- Research-candidate backtests use lot `0.1` and the live desk's `DEFAULT_COST_MODEL` (`slippageBps: 0.5, commissionBps: 1`) — every new backtest call in this plan (blind test, ladder sweep) uses the same two constants so numbers stay comparable.
- `WARMUP = 60` in `src/lib/backtest/engine.ts` — `backtestCandles()` does not scan for entries before bar index 60; any synthetic test candle series needs materially more than 60 bars to produce multiple round-trip trades.
- No mocking framework in this codebase (confirmed: zero `jest.mock`/`vi.mock`/`sinon` hits) — do not introduce one. Extract pure functions for anything that needs a unit test.
- `AGENTS.md` (project root): *"This is NOT the Next.js you know — read the relevant guide in `node_modules/next/dist/docs/` before writing any code."* Applies to Task 2's edit of `src/app/research/page.tsx`.
- Lean conservative: any ambiguous case in the blind-test gate (fetch failure, malformed data) resolves to **rejected**, never to "trust the in-sample result."
- `status` on `ResearchStrategy` gains a fourth value, `"demoted"`, distinct from `"rejected"` — a rejected row never passed the pipeline; a demoted row did, under a bar that has since moved. Only `"approved"` rows are ever live-activatable (`getResearchStrategy()` already filters on exactly that string, so `"demoted"` is automatically excluded with no code change).

---

### Task 1: Schema migration + blind-test approval gate

**Files:**
- Modify: `prisma/schema.prisma:252-263` (`ResearchStrategy` model)
- Modify: `src/lib/research/blindTest.ts` (add `applyBlindTestVerdict`, lines 144-145)
- Modify: `src/lib/research/runResearch.ts:143-164` (`runResearch()`'s persist loop)
- Test: `src/lib/research/blindTest.test.ts` (append)

**Interfaces:**
- Consumes: `runBlindTest(strategyId: number): Promise<BlindTestResult>` and `BlindTestResult` (existing, `src/lib/research/blindTest.ts`) — a discriminated union `{ error: string } | { strategy; symbol; range; totalBars; holdoutBars; holdoutDays; inSample; holdout; passed: boolean; reasons: string[] }`. `MIN_TRADES` from `src/lib/research/autoReview.ts`.
- Produces: `applyBlindTestVerdict(inSampleStatus: "approved" | "rejected", verdict: BlindTestResult): { status: "approved" | "rejected"; blindTestJson: string }` — exported from `blindTest.ts`. Task 3 will later read the resulting `ResearchStrategy.blindTest` column and the same `applyBlindTestVerdict` signature is unaffected by Task 3's ladder change (it only consumes `BlindTestResult`, which stays the same shape).

- [ ] **Step 1: Add the schema columns**

Edit `prisma/schema.prisma`, in the `ResearchStrategy` model (currently lines 252-263):

```prisma
/// One AI-authored strategy candidate — only ever executed inside the vm sandbox.
model ResearchStrategy {
  id              Int         @id @default(autoincrement())
  run             ResearchRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  runId           Int
  label           String
  code            String // AI-generated source, sandbox-only, never require()'d
  status          String      @default("proposed") // proposed | approved | rejected | demoted
  iterations      String      @default("[]") // JSON: [{ code, backtestSummary, note }]
  backtestSummary String      @default("{}") // JSON: final summarizeBacktest() result
  safetyFlag      Boolean     @default(false) // ever failed the deny-list scan
  blindTest       String      @default("{}") // JSON: BlindTestResult from the held-out validation gate
  exitLadder      String      @default("{}") // JSON: { tp1Mult, slMult, singleTarget } this candidate's own swept ladder
  demotedReason   String? // set when a re-vet sweep drops status from approved to demoted
  createdAt       DateTime    @default(now())
}
```

- [ ] **Step 2: Run the migration**

Run: `npx prisma migrate dev --name research_strategy_rigor_columns`
Expected: migration applies cleanly, adding `blindTest`, `exitLadder`, `demotedReason` with the defaults above; Prisma Client regenerates.

- [ ] **Step 3: Write the failing tests for `applyBlindTestVerdict`**

Append to `src/lib/research/blindTest.test.ts` (the file already imports `evaluateHoldout` and defines a local `summary()` helper — reuse it):

```ts
import { applyBlindTestVerdict } from "./blindTest";

test("applyBlindTestVerdict: a passing verdict keeps an approved candidate approved", () => {
  const verdict = {
    strategy: { id: 1, label: "X" },
    symbol: "AAPL",
    range: "2y" as const,
    totalBars: 500,
    holdoutBars: 120,
    holdoutDays: 365,
    inSample: summary(),
    holdout: summary(),
    passed: true,
    reasons: [],
  };
  const applied = applyBlindTestVerdict("approved", verdict);
  assert.equal(applied.status, "approved");
  assert.deepEqual(JSON.parse(applied.blindTestJson), verdict);
});

test("applyBlindTestVerdict: a failing verdict demotes an approved candidate to rejected", () => {
  const verdict = {
    strategy: { id: 1, label: "X" },
    symbol: "AAPL",
    range: "2y" as const,
    totalBars: 500,
    holdoutBars: 120,
    holdoutDays: 365,
    inSample: summary(),
    holdout: summary({ expectancy: -1 }),
    passed: false,
    reasons: ["held-out expectancy is not positive (-1)"],
  };
  const applied = applyBlindTestVerdict("approved", verdict);
  assert.equal(applied.status, "rejected");
});

test("applyBlindTestVerdict: an unfetchable/error verdict rejects conservatively rather than trusting the in-sample pass", () => {
  const applied = applyBlindTestVerdict("approved", { error: "AAPL: could not fetch enough deep history" });
  assert.equal(applied.status, "rejected");
  const parsed = JSON.parse(applied.blindTestJson);
  assert.ok(/Lean conservative/.test(parsed.reasons[0]));
});

test("applyBlindTestVerdict: a candidate already rejected in-sample passes through unchanged (blind test is never run for it)", () => {
  const applied = applyBlindTestVerdict("rejected", { error: "should not matter — status was never approved" });
  assert.equal(applied.status, "rejected");
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx tsx --test src/lib/research/blindTest.test.ts`
Expected: FAIL with `applyBlindTestVerdict is not a function` (or similar — not yet exported).

- [ ] **Step 5: Implement `applyBlindTestVerdict`**

Append to `src/lib/research/blindTest.ts` (after `runBlindTest`, i.e. after line 144):

```ts
/**
 * Pure decision layer between a blind-test run and the persisted status.
 * Lean conservative: a candidate whose held-out data could not be fetched or
 * validated (the `{ error }` branch of BlindTestResult) does not get to trade
 * live on an unverified in-sample claim — it is rejected, not left approved.
 * A candidate that was already rejected in-sample never reaches this path in
 * practice (runResearch only calls runBlindTest for in-sample approvals), but
 * this stays a total function over both inputs rather than assuming that.
 */
export function applyBlindTestVerdict(
  inSampleStatus: "approved" | "rejected",
  verdict: BlindTestResult,
): { status: "approved" | "rejected"; blindTestJson: string } {
  if (inSampleStatus !== "approved") {
    return { status: inSampleStatus, blindTestJson: JSON.stringify(verdict) };
  }
  if ("error" in verdict) {
    return {
      status: "rejected",
      blindTestJson: JSON.stringify({
        error: verdict.error,
        reasons: [
          `Lean conservative: a candidate whose held-out data we could not fetch/validate does not get to trade live on an unverified claim. (${verdict.error})`,
        ],
      }),
    };
  }
  return { status: verdict.passed ? "approved" : "rejected", blindTestJson: JSON.stringify(verdict) };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx tsx --test src/lib/research/blindTest.test.ts`
Expected: PASS (all tests, including the 5 pre-existing `evaluateHoldout` tests).

- [ ] **Step 7: Wire the gate into `runResearch()`'s persist loop**

Replace the persist loop in `src/lib/research/runResearch.ts` (currently lines 144-164):

```ts
    let totalCost = proposeCost;
    for (const r of results) {
      totalCost += r.costUsd;
      const created = await prisma.researchStrategy.create({
        data: {
          runId: run.id,
          label: r.label,
          code: r.code,
          status: r.status,
          iterations: JSON.stringify(r.iterations),
          backtestSummary: JSON.stringify(r.backtestSummary),
          safetyFlag: r.safetyFlag,
        },
      });

      // Held-out validation only runs for in-sample approvals — a candidate
      // rejected on its own in-sample numbers gains nothing from a blind test
      // and it would just be a wasted deep-history fetch.
      let finalRow = created;
      if (created.status === "approved") {
        const verdict = await runBlindTest(created.id);
        const applied = applyBlindTestVerdict(created.status as "approved" | "rejected", verdict);
        finalRow = await prisma.researchStrategy.update({
          where: { id: created.id },
          data: { status: applied.status, blindTest: applied.blindTestJson },
        });
      }

      // Vault export is a best-effort side note for browsing in Obsidian, never
      // load-bearing - a filesystem hiccup here must not fail the research run.
      try {
        exportStrategyNote(finalRow, run);
      } catch (e) {
        console.error(`obsidian export failed for strategy ${finalRow.id}:`, e);
      }
    }
```

Add the new import at the top of `runResearch.ts` (alongside the existing `autoReviewStatus` import on line 13):

```ts
import { runBlindTest, applyBlindTestVerdict } from "./blindTest";
```

- [ ] **Step 8: Manual smoke test of the DB/network wiring**

This orchestration touches Prisma + `fetchCandles` (real network) — not unit-testable without a mocking framework this repo doesn't use. Verify it manually with a throwaway script, same convention as `scripts/tmp-flip-strategy.mts`:

Create `scripts/tmp-verify-blindtest-gate.mts`:

```ts
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { runResearch } from "../src/lib/research/runResearch";

async function main() {
  const { runId } = await runResearch(
    "manual smoke test for the blind-test approval gate",
    "AAPL",
    "1h",
    "3mo",
    [
      {
        label: "smoke-test candidate",
        code: `
          var i = bars.length - 1;
          if (snaps[i].rsi != null && snaps[i].rsi < 30) return { side: "long", note: "oversold" };
          return null;
        `,
        rationale: "manual smoke test — verifying runBlindTest gets invoked and status can change",
      },
    ],
  );
  const strategies = await prisma.researchStrategy.findMany({ where: { runId } });
  for (const s of strategies) {
    console.log(`research-${s.id}: status=${s.status} blindTest=${s.blindTest.slice(0, 200)}`);
  }
  await prisma.$disconnect();
}

main();
```

Run (Git Bash): `set -a && source .env && set +a && npx tsx scripts/tmp-verify-blindtest-gate.mts`
Expected: exactly one `ResearchStrategy` row printed with a non-`"{}"` `blindTest` value (either it stayed "proposed"/"rejected" from the in-sample backtest with `blindTest` still `"{}"`, or it was "approved" in-sample and now shows a populated `blindTest` JSON body with `passed`/`reasons` or an `error`+conservative-reject reason). Confirm the status printed is internally consistent with the `blindTest` JSON (e.g. `passed: false` in the JSON implies `status=rejected`). Delete `scripts/tmp-verify-blindtest-gate.mts` after confirming.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/research/blindTest.ts src/lib/research/blindTest.test.ts src/lib/research/runResearch.ts
git commit -m "feat(research): gate strategy approval on held-out blind-test validation"
```

---

### Task 2: Retroactive re-vet script + `"demoted"` status in the UI

**Files:**
- Create: `scripts/revet-research-strategies.mts`
- Modify: `src/components/research/ResearchPanel.tsx:10,145`
- Modify: `src/app/research/page.tsx:47-52`

**Interfaces:**
- Consumes: `autoReviewStatus(bt: BacktestSummary, safetyFlag: boolean): "approved" | "rejected"` (existing, `src/lib/research/autoReview.ts`, unchanged by this task — re-vetting means calling this exact function against each row's already-stored `backtestSummary`). `ResearchStrategy.status` now includes `"demoted"` (added in Task 1's migration) and `ResearchStrategy.demotedReason: String?` (also Task 1).
- Produces: nothing consumed by Task 1 or 3 — this task's script and UI changes are read-only with respect to the rest of the plan. `"demoted"` is a terminal status string other code may match on going forward.

**Note on `AGENTS.md`:** this task edits `src/app/research/page.tsx`, a Next.js server component. Before touching it, skim `node_modules/next/dist/docs/` for any App Router / server-component conventions that differ from prior Next.js versions — the edit here is a small, local addition to an existing pure function (`strategyBadge`), not a structural change, but the project instruction applies to any edit in this file.

- [ ] **Step 1: Write the re-vet script**

Create `scripts/revet-research-strategies.mts`:

```ts
// One-time (and safely re-runnable) maintenance sweep: re-vets every
// currently-"approved" ResearchStrategy against the CURRENT autoReviewStatus()
// bar. The bar has tightened over time (MIN_TRADES/profitFactor were added or
// raised after some rows were approved), so an old approval can be stale.
//
// A row that no longer clears the bar is demoted to "demoted" — distinct from
// "rejected": it DID pass the pipeline once, under a bar that has since moved,
// which is a materially different fact than "never passed at all."
//
// Usage:
//   npx tsx scripts/revet-research-strategies.mts            (dry run — no writes)
//   npx tsx scripts/revet-research-strategies.mts --apply     (writes demotions)
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { autoReviewStatus } from "../src/lib/research/autoReview";
import type { BacktestSummary } from "../src/lib/backtest/engine";

async function main() {
  const apply = process.argv.includes("--apply");
  const approved = await prisma.researchStrategy.findMany({ where: { status: "approved" } });
  console.log(`checking ${approved.length} approved strategies against the current bar...`);

  let demoted = 0;
  for (const row of approved) {
    let bt: BacktestSummary;
    try {
      bt = JSON.parse(row.backtestSummary);
    } catch {
      console.log(`research-${row.id} (${row.label}): SKIP - backtestSummary is not valid JSON`);
      continue;
    }

    const verdict = autoReviewStatus(bt, row.safetyFlag);
    if (verdict === "approved") continue;

    demoted++;
    const reason = `re-vet ${new Date().toISOString().slice(0, 10)}: no longer clears the bar (trades=${bt.trades}, expectancy=${bt.expectancy}, profitFactor=${bt.profitFactor})`;
    console.log(`research-${row.id} (${row.label}): DEMOTE - ${reason}`);

    const activePortfolios = await prisma.portfolio.findMany({
      where: { strategy: `research-${row.id}`, killSwitch: false },
      select: { id: true, name: true },
    });
    if (activePortfolios.length) {
      console.log(
        `  WARNING: still live on portfolio(s) ${activePortfolios.map((p) => `#${p.id} (${p.name})`).join(", ")} - this script does not change portfolio.strategy, flip it manually if this demotion should take it off live trading`,
      );
    }

    if (apply) {
      await prisma.researchStrategy.update({
        where: { id: row.id },
        data: { status: "demoted", demotedReason: reason },
      });
    }
  }

  console.log(
    apply
      ? `done - ${demoted} row(s) demoted`
      : `dry run complete - ${demoted} row(s) WOULD be demoted (re-run with --apply to write)`,
  );
  await prisma.$disconnect();
}

main();
```

- [ ] **Step 2: Dry-run the script against real data**

Run (Git Bash): `set -a && source .env && set +a && npx tsx scripts/revet-research-strategies.mts`
Expected: prints a count of approved strategies checked, and for each one that would be demoted, its id/label/reason plus any live-portfolio warning. No database writes happen (no `--apply` flag). Confirm `research-29` (the known 8-trade, sub-`MIN_TRADES` approval from the investigation) appears in the demote list, since portfolio 11 already runs `combo-vote` (per the stopgap fix), no live-portfolio warning is expected for it.

- [ ] **Step 3: Apply the demotions**

Run (Git Bash): `set -a && source .env && set +a && npx tsx scripts/revet-research-strategies.mts --apply`
Expected: same output as the dry run, but `done - N row(s) demoted`. Spot-check one demoted row directly:

Run: `npx tsx -e "import('./src/lib/db.js').then(async ({prisma}) => { console.log(await prisma.researchStrategy.findUnique({where:{id:29}})); await prisma.\$disconnect(); })"`

(Adjust the id if `research-29`'s actual row id differs from 29 — the research-strategy key embeds the row id, confirm via the dry run's printed `research-<id>` label.) Expected: `status: "demoted"`, `demotedReason` populated.

- [ ] **Step 4: Widen `ResearchPanel.tsx`'s status type and badge**

Edit `src/components/research/ResearchPanel.tsx` line 10:

```ts
  status: "proposed" | "approved" | "rejected" | "demoted";
```

Edit line 145 (the badge tone ternary):

```tsx
                    <Badge tone={s.status === "approved" ? "positive" : s.status === "rejected" ? "negative" : s.status === "demoted" ? "negative" : "neutral"}>{s.status}</Badge>
```

No change needed to the Approve/Reject button `disabled` conditions (lines 154, 161) — both already gate on `s.status !== "proposed"`, which a `"demoted"` row already satisfies.

- [ ] **Step 5: Add the `"demoted"` badge branch in `src/app/research/page.tsx`**

Edit `strategyBadge()` (currently lines 47-52):

```tsx
function strategyBadge(status: string, safetyFlag: boolean) {
  if (safetyFlag) return <Badge tone="warning">flagged</Badge>;
  if (status === "approved") return <Badge tone="positive">approved</Badge>;
  if (status === "rejected") return <Badge tone="neutral">rejected</Badge>;
  if (status === "demoted") return <Badge tone="negative">demoted</Badge>;
  return <Badge tone="info">proposed</Badge>;
}
```

- [ ] **Step 6: Verify the page renders**

Run: `npm run build`
Expected: build succeeds with no type errors (both edited files are otherwise unchanged in shape — `status` stays a `string`/widened string-literal union, no new required props).

- [ ] **Step 7: Commit**

```bash
git add scripts/revet-research-strategies.mts src/components/research/ResearchPanel.tsx src/app/research/page.tsx
git commit -m "feat(research): retroactively re-vet approved strategies, add demoted status"
```

---

### Task 3: Per-candidate exit ladder (sweep, carry into live trading, blind-test follow-up)

**Files:**
- Modify: `src/lib/research/runResearch.ts` (add `sweepLadder`, wire into `runOneCandidate`/`runResearch`)
- Modify: `src/lib/research/adapter.ts` (`wrapAsStrategy` reads `exitLadder`)
- Modify: `src/lib/research/blindTest.ts` (`runBlindTest` reads the candidate's own ladder instead of the hardcoded 1.2/1.5)
- Test: `src/lib/research/runResearch.test.ts` (new)
- Test: `src/lib/research/adapter.test.ts` (new)

**Interfaces:**
- Consumes: `compileStrategy(code: string): CompiledStrategy` and `CompiledStrategy.invoke(bars, snaps, i): SandboxSignal | null` (existing, `src/lib/research/sandbox.ts`). `backtestCandles(symbol, candles, lot, thresholds, entry, singleTarget, tp1Mult, costs, slMult, trail?, precomputed?): BacktestResult` and `summarizeBacktest(trades): BacktestSummary` (existing, `src/lib/backtest/engine.ts`). `Strategy["preferredExit"]?: { tp1Mult: number; singleTarget: boolean; costs?: CostModel; slMult?: number; trail?: {...} }` (existing, `src/lib/trading/strategies.ts` — unchanged).
- Produces: `sweepLadder(code: string, bars: Candle[], snaps: ScanSnapshot[]): { ladder: { tp1Mult: number; slMult: number; singleTarget: true }; summary: BacktestSummary }`, plus `LADDER_TP_MULTS: number[]` and `LADDER_SL_MULT: number`, all exported from `runResearch.ts`. `runOneCandidate()`'s return type gains `exitLadder: { tp1Mult: number; slMult: number; singleTarget: true }`. `wrapAsStrategy()`'s input type gains an optional `exitLadder?: string` field.

- [ ] **Step 1: Write the failing test for `sweepLadder`**

Create `src/lib/research/runResearch.test.ts`:

```ts
import "dotenv/config"; // runResearch.ts imports prisma at module scope
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import { backtestCandles, summarizeBacktest, DEFAULT_COST_MODEL } from "@/lib/backtest/engine";
import { computeSnapshots } from "./adapter";
import { sweepLadder, LADDER_TP_MULTS, LADDER_SL_MULT } from "./runResearch";

function bar(t: number, c: number): Candle {
  return { t, o: c, h: c + 1, l: c - 1, c, v: 1000 };
}

// A 250-bar triangle wave (well past WARMUP=60): 10 bars up, 10 bars down,
// repeating, +-1.5/bar. Gives the periodic-long strategy below many round-trip
// trades across the whole ladder sweep.
function triangleBars(n: number): Candle[] {
  const bars: Candle[] = [];
  let price = 100;
  let direction = 1;
  for (let i = 0; i < n; i++) {
    if (i > 0 && i % 10 === 0) direction *= -1;
    price += direction * 1.5;
    bars.push(bar(i * 3600, price));
  }
  return bars;
}

const PERIODIC_LONG_CODE = `
  var i = bars.length - 1;
  if (i % 10 === 0) return { side: "long", note: "periodic" };
  return null;
`;

test("sweepLadder picks the ladder with the best profit factor (expectancy tie-break), matching an independently recomputed sweep", () => {
  const bars = triangleBars(250);
  const snaps = computeSnapshots(bars);
  const periodicEntry = (i: number) => (i % 10 === 0 ? "long" : null);

  let expectedBest: { tp1Mult: number; summary: ReturnType<typeof summarizeBacktest> } | null = null;
  for (const tp1Mult of LADDER_TP_MULTS) {
    const bt = backtestCandles("EXPECT", bars, 0.1, undefined, periodicEntry, true, tp1Mult, DEFAULT_COST_MODEL, LADDER_SL_MULT);
    const summary = summarizeBacktest(bt.trades);
    const pf = summary.profitFactor ?? -Infinity;
    const bestPf = expectedBest ? expectedBest.summary.profitFactor ?? -Infinity : -Infinity;
    const better =
      !expectedBest ||
      pf > bestPf ||
      (pf === bestPf && (summary.expectancy ?? -Infinity) > (expectedBest.summary.expectancy ?? -Infinity));
    if (better) expectedBest = { tp1Mult, summary };
  }
  assert.ok(expectedBest, "the sweep range must produce at least one candidate");

  const result = sweepLadder(PERIODIC_LONG_CODE, bars, snaps);

  assert.equal(result.ladder.tp1Mult, expectedBest!.tp1Mult);
  assert.equal(result.ladder.slMult, LADDER_SL_MULT);
  assert.equal(result.ladder.singleTarget, true);
  assert.equal(result.summary.trades, expectedBest!.summary.trades);
  assert.equal(result.summary.profitFactor, expectedBest!.summary.profitFactor);
});

test("sweepLadder returns a ladder that actually produced trades on a realistic-length series", () => {
  const bars = triangleBars(250);
  const snaps = computeSnapshots(bars);
  const result = sweepLadder(PERIODIC_LONG_CODE, bars, snaps);
  assert.ok(LADDER_TP_MULTS.includes(result.ladder.tp1Mult));
  assert.ok(result.summary.trades > 0, "the periodic-long strategy must produce trades on a 250-bar series");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test src/lib/research/runResearch.test.ts`
Expected: FAIL — `sweepLadder`/`LADDER_TP_MULTS`/`LADDER_SL_MULT` are not exported yet.

- [ ] **Step 3: Implement `sweepLadder` in `runResearch.ts`**

Add near the top of `src/lib/research/runResearch.ts`, after the existing `RESEARCH_COST_MODEL` constant (line 24) and before the `Iteration` interface (line 26):

```ts
import type { Candle } from "@/lib/indicators";
import type { ScanSnapshot } from "@/lib/trading/scanner";

// Every research candidate's own validated exit ladder, swept once after
// refinement finishes (not per refinement round — refinement rounds compare
// candidates against each other under the SAME fixed 1.2 ladder above, so a
// round's improvement is judged independent of ladder choice; only once the
// code is locked in does each candidate get its own ratio). Fixed SL, varying
// TP: matches this codebase's existing sweep convention (scripts/sweep-rr.ts).
export const LADDER_TP_MULTS = [1.0, 1.2, 1.5, 2.0, 2.5, 3.0];
export const LADDER_SL_MULT = 1.5;

/** Sweep LADDER_TP_MULTS against a fixed SL, picking the best by profit factor
 *  (ties broken by expectancy). Pure with respect to its inputs — no DB/network. */
export function sweepLadder(
  code: string,
  bars: Candle[],
  snaps: ScanSnapshot[],
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
  return best!; // LADDER_TP_MULTS is non-empty, so a candidate is always assigned
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test src/lib/research/runResearch.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `sweepLadder` into `runOneCandidate()` and thread `exitLadder` through `runResearch()`**

Update `runOneCandidate`'s return type (currently lines 33-41):

```ts
): Promise<{
  label: string;
  code: string;
  status: "approved" | "rejected";
  iterations: Iteration[];
  backtestSummary: BacktestSummary;
  exitLadder: { tp1Mult: number; slMult: number; singleTarget: true };
  safetyFlag: boolean;
  costUsd: number;
}> {
```

Update the early-reject return for an unsafe candidate (currently line 67) to include a neutral default ladder — this row is rejected regardless, but the field is required by the return type:

```ts
  if (!safe) {
    return {
      label: candidate.label,
      code,
      status: "rejected",
      iterations,
      backtestSummary: summarizeBacktest([]),
      exitLadder: { tp1Mult: 1.2, slMult: 1.5, singleTarget: true },
      safetyFlag,
      costUsd,
    };
  }
```

Replace the function's final block (currently lines 106-115):

```ts
  // Final ladder sweep on the finalized code only — see sweepLadder's comment
  // for why this runs once, after refinement, rather than per round.
  const swept = sweepLadder(code, bars, snaps);
  summary = swept.summary;
  iterations.push({ code, note: "final exit-ladder sweep", backtestSummary: summary });

  return {
    label: candidate.label,
    code,
    status: autoReviewStatus(summary, safetyFlag),
    iterations,
    backtestSummary: summary,
    exitLadder: swept.ladder,
    safetyFlag,
    costUsd,
  };
}
```

Update the persist call inside `runResearch()` (from Task 1's Step 7 edit — add one field to the `data` object passed to `prisma.researchStrategy.create`):

```ts
      const created = await prisma.researchStrategy.create({
        data: {
          runId: run.id,
          label: r.label,
          code: r.code,
          status: r.status,
          iterations: JSON.stringify(r.iterations),
          backtestSummary: JSON.stringify(r.backtestSummary),
          exitLadder: JSON.stringify(r.exitLadder),
          safetyFlag: r.safetyFlag,
        },
      });
```

- [ ] **Step 6: Write the failing test for `wrapAsStrategy`'s ladder passthrough**

Create `src/lib/research/adapter.test.ts`:

```ts
import "dotenv/config"; // adapter.ts imports prisma at module scope
import { test } from "node:test";
import assert from "node:assert/strict";
import { wrapAsStrategy } from "./adapter";

test("wrapAsStrategy carries a persisted exitLadder forward as preferredExit", () => {
  const strat = wrapAsStrategy({
    id: 42,
    label: "Test Strategy",
    code: "return null;",
    exitLadder: JSON.stringify({ tp1Mult: 2.0, slMult: 1.5, singleTarget: true }),
  });
  assert.deepEqual(strat.preferredExit, { tp1Mult: 2.0, slMult: 1.5, singleTarget: true });
});

test("wrapAsStrategy leaves preferredExit undefined for a legacy row with no exitLadder field at all", () => {
  const strat = wrapAsStrategy({ id: 43, label: "Legacy", code: "return null;" });
  assert.equal(strat.preferredExit, undefined);
});

test("wrapAsStrategy leaves preferredExit undefined for a malformed exitLadder JSON string", () => {
  const strat = wrapAsStrategy({ id: 44, label: "Bad JSON", code: "return null;", exitLadder: "not json" });
  assert.equal(strat.preferredExit, undefined);
});

test("wrapAsStrategy leaves preferredExit undefined for the schema default empty-object ladder", () => {
  const strat = wrapAsStrategy({ id: 45, label: "Default", code: "return null;", exitLadder: "{}" });
  assert.equal(strat.preferredExit, undefined);
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx tsx --test src/lib/research/adapter.test.ts`
Expected: FAIL — `wrapAsStrategy` doesn't accept `exitLadder` yet and never sets `preferredExit`, so the first test's `deepEqual` fails.

- [ ] **Step 8: Implement the `exitLadder` passthrough in `wrapAsStrategy`**

Replace `wrapAsStrategy` in `src/lib/research/adapter.ts` (currently lines 50-60):

```ts
export function wrapAsStrategy(researchStrategy: { id: number; label: string; code: string; exitLadder?: string }): Strategy {
  let preferredExit: Strategy["preferredExit"];
  try {
    const parsed = JSON.parse(researchStrategy.exitLadder || "{}");
    if (typeof parsed.tp1Mult === "number" && typeof parsed.slMult === "number") {
      preferredExit = { tp1Mult: parsed.tp1Mult, slMult: parsed.slMult, singleTarget: !!parsed.singleTarget };
    }
  } catch {
    // malformed JSON — fall back to the engine's hardcoded RESEARCH_ATR_* ladder (preferredExit stays undefined)
  }

  return {
    key: `research-${researchStrategy.id}`,
    label: `${researchStrategy.label} (research)`,
    preferredExit,
    build(bars: Candle[]): StrategyEvaluator {
      const snaps = computeSnapshots(bars);
      const compiled = compileStrategy(researchStrategy.code);
      return (i: number) => compiled.invoke(bars, snaps, i);
    },
  };
}
```

Update `getResearchStrategy()` (currently line 74) so its Prisma query actually selects `exitLadder` — `findFirst` with no `select` clause already returns every column, so no change is needed there; confirm this by checking the query has no `select:` restricting fields (it doesn't, per the current file).

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx tsx --test src/lib/research/adapter.test.ts`
Expected: PASS.

- [ ] **Step 10: Update `blindTest.ts` to read the candidate's own ladder**

Replace the two `RESEARCH_LOT`/`RESEARCH_TP1_MULT` constants (currently lines 31-32) with:

```ts
const RESEARCH_LOT = 0.1;
// Pre-Feature-3 rows (approved before per-candidate ladders existed) have no
// exitLadder yet — fall back to the ladder every candidate used to be
// uniformly validated against.
const LEGACY_TP1_MULT = 1.2;
const LEGACY_SL_MULT = 1.5;
```

Replace the backtest call inside `runBlindTest` (currently lines 123-127):

```ts
  const snaps = computeSnapshots(holdoutBars);
  const compiled = compileStrategy(strategy.code);
  const entry: EntryRule = (i) => compiled.invoke(holdoutBars, snaps, i)?.side ?? null;

  let ladderTp1Mult = LEGACY_TP1_MULT;
  let ladderSlMult = LEGACY_SL_MULT;
  try {
    const parsed = JSON.parse(strategy.exitLadder || "{}");
    if (typeof parsed.tp1Mult === "number") {
      ladderTp1Mult = parsed.tp1Mult;
      ladderSlMult = typeof parsed.slMult === "number" ? parsed.slMult : LEGACY_SL_MULT;
    }
  } catch {
    // malformed JSON — fall back to the legacy ladder
  }

  const bt = backtestCandles(symbol, holdoutBars, RESEARCH_LOT, undefined, entry, true, ladderTp1Mult, DEFAULT_COST_MODEL, ladderSlMult);
  const holdout = summarizeBacktest(bt.trades);
```

No change needed to the `evaluateHoldout` call or return statement below it — both operate on `holdout`/`inSample` summaries regardless of which ladder produced them.

- [ ] **Step 11: Run the full blindTest test suite to confirm no regression**

Run: `npx tsx --test src/lib/research/blindTest.test.ts`
Expected: PASS — all `evaluateHoldout` and `applyBlindTestVerdict` tests (from Task 1) still pass; this step doesn't add new blindTest.ts-specific tests since `runBlindTest` itself is DB/network-orchestration, consistent with this file's existing testing boundary (only `evaluateHoldout`, a pure function, is directly tested).

- [ ] **Step 12: Manual smoke test — confirm a swept ladder round-trips end to end**

Create `scripts/tmp-verify-exit-ladder.mts`:

```ts
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { runResearch } from "../src/lib/research/runResearch";
import { getResearchStrategy } from "../src/lib/research/adapter";

async function main() {
  const { runId } = await runResearch(
    "manual smoke test for the per-candidate exit ladder",
    "AAPL",
    "1h",
    "3mo",
    [
      {
        label: "smoke-test ladder candidate",
        code: `
          var i = bars.length - 1;
          if (snaps[i].rsi != null && snaps[i].rsi < 35) return { side: "long", note: "oversold" };
          return null;
        `,
        rationale: "manual smoke test — verifying sweepLadder runs and the ladder round-trips through wrapAsStrategy",
      },
    ],
  );
  const rows = await prisma.researchStrategy.findMany({ where: { runId } });
  for (const row of rows) {
    console.log(`research-${row.id}: status=${row.status} exitLadder=${row.exitLadder}`);
    if (row.status === "approved") {
      const strat = await getResearchStrategy(`research-${row.id}`);
      console.log(`  wrapAsStrategy preferredExit: ${JSON.stringify(strat?.preferredExit)}`);
    }
  }
  await prisma.$disconnect();
}

main();
```

Run (Git Bash): `set -a && source .env && set +a && npx tsx scripts/tmp-verify-exit-ladder.mts`
Expected: `exitLadder` is populated (non-`"{}"`) JSON with a `tp1Mult` from `LADDER_TP_MULTS`; if the candidate ended up `"approved"`, the printed `preferredExit` exactly matches that same `tp1Mult`/`slMult`. Delete `scripts/tmp-verify-exit-ladder.mts` after confirming.

- [ ] **Step 13: Commit**

```bash
git add src/lib/research/runResearch.ts src/lib/research/runResearch.test.ts src/lib/research/adapter.ts src/lib/research/adapter.test.ts src/lib/research/blindTest.ts
git commit -m "feat(research): sweep and carry each candidate's own validated exit ladder"
```

---

## Self-Review

**1. Spec coverage** — every Feature in `docs/superpowers/specs/2026-08-24-research-pipeline-rigor-design.md` maps to a task: Feature 1 → Task 1, Feature 2 → Task 2, Feature 3 → Task 3. The spec's combined-migration note ("one migration adding all three new columns up front") is honored — Task 1's Step 1-2 adds `blindTest`, `exitLadder`, and `demotedReason` together, even though `exitLadder`/`demotedReason` aren't consumed until Tasks 2/3, avoiding a second migration later.

**2. Placeholder scan** — no "TBD"/"handle appropriately"/"similar to Task N" patterns; every step has runnable, complete code, including the manual `.mts` smoke scripts (real files with real assertions printed to stdout, not descriptions of what to check).

**3. Type consistency** — `sweepLadder`'s return type `{ ladder: { tp1Mult: number; slMult: number; singleTarget: true }; summary: BacktestSummary }` (Task 3, Step 3) matches its consumption in `runOneCandidate` (Step 5: `swept.ladder`/`swept.summary`) and in the test (Step 1: `result.ladder.tp1Mult`, `result.summary.trades`). `applyBlindTestVerdict`'s signature (Task 1, Step 5) matches its call site in `runResearch()` (Task 1, Step 7: `applyBlindTestVerdict(created.status as "approved" | "rejected", verdict)`) and its test calls (Task 1, Step 3). `wrapAsStrategy`'s widened input type (Task 3, Step 8: `{ id; label; code; exitLadder?: string }`) matches every call site: `getResearchStrategy()` (adapter.ts, unchanged, passes the full Prisma row which now includes `exitLadder`) and the new adapter tests (Step 6). `ResearchStrategy.status` string values (`"proposed" | "approved" | "rejected" | "demoted"`) are consistent across Task 1's schema comment, Task 2's script, and both UI files.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-24-research-pipeline-rigor.md`. Per the user's original instruction ("run it through the normal SDD implement→review cycle per task, same as the RL work"), execution proceeds via **Subagent-Driven Development**: a fresh implementer subagent per task, task review (spec compliance + code quality) after each, and a final whole-branch review once all three tasks land.
