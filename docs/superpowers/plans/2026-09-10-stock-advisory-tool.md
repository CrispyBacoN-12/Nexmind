# Stock Advisory Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `/advisor` page and `POST /api/advisor` that, for one ticker the owner names, print the entry/stop structure, the whole-share size under both caps, an R ladder of exit prices, the correlation against what they already hold, and the market-gate reading — while stating plainly that the tool makes no prediction.

**Architecture:** A pure core in `src/lib/advisor/` (`types.ts` → `sizing.ts` → `rLadder.ts` → `advise.ts`) that does arithmetic on candle arrays and nothing else, wrapped by exactly one I/O surface (`src/app/api/advisor/route.ts`) that fetches candles and calls `advise()`. The page is a static server shell plus a `"use client"` form. The core reuses the desk's existing `atr`, `dailyReturns`/`pearsonCorrelation`, `gateSlots`, and `BENCHMARK`/`TREND_PERIOD` rather than reimplementing them.

**Tech Stack:** TypeScript, Next.js App Router, `node:test` + `assert/strict` run via `tsx --test`, Tailwind v4 tokens through the existing `src/components/ui.tsx` primitives.

**Spec:** `docs/superpowers/specs/2026-09-10-stock-advisory-tool-design.md`

## Global Constraints

- **No edge claim, ever.** Every card carries `ADVISOR_NO_EDGE_CLAIM` verbatim. The tool reports structure and risk for a ticker the owner chose. It never ranks, screens, or suggests names.
- **Boundary rule:** nothing under `src/lib/advisor/` may import `prisma`, `src/lib/marketData`, `src/lib/yahoo`, or anything else that touches the network or the database. The core takes candle arrays as arguments. Only `src/app/api/advisor/route.ts` does I/O.
- **Whole shares only.** The broker is Webull; fractional sizing does not exist. `src/lib/trading/positionSizing.ts`'s `computeLot` is a fractional forex lot function and must NOT be reused for sizing — it stays untouched because the desk still uses it.
- **1.5 × ATR(14) is the stop distance.** It is the one constant all three exit geometries in the repo agree on. The target multiple is NOT chosen — the card prints an R ladder at `[1, 1.5, 2, 2.5, 3]` and lets the owner pick.
- **Never report a fake risk percentage.** Two caps (risk budget and slot affordability) collide at $2,500 capital, and the binding one is usually affordability. The card always names which cap bound and prints the *actual* risk percentage, not the requested one.
- **Correlation is reported, not applied.** `corrMultiplierFor`'s multiplier is shown as a second line ("with the desk's correlation rule: N shares"), never folded silently into `shares`.
- **Fail loud, never silently zero.** Every zero-share and every unknown reading carries a stated reason string.
- **v1 is long-only.** No short side.
- **UI copy is English**, matching the sidebar and the verbatim English `ADVISOR_NO_EDGE_CLAIM`.
- **Percent units:** `riskPct` and every `*Pct` field are in percent units (`1` = 1%), matching `fmtPct` in `src/lib/utils.ts`, which divides by 100 before formatting.
- **`Candle.t` is epoch SECONDS.** Any date rendering is `new Date(t * 1000)`.
- Test runner: `npm test` = `tsx --test "src/**/*.test.ts"`. Typecheck: `npm run typecheck`. Lint: `npm run lint`. Dev server: `npm run dev:web` on port 3275.
- Git: never `git add -A`, `git add .`, `git commit -a`, `git stash`, `git clean`, or `git reset --hard`. The working tree is dirty with the owner's uncommitted research work. **Never `git add docs/STATE.md`.** Stage only the exact paths each step names.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Plan-Level Rulings

These three questions the spec does not settle. They are decided here; do not re-litigate them during execution.

1. **`corrMultiplierFor` is module-private** (`src/lib/trading/positionSizing.ts:24`). **Ruling:** add the `export` keyword to it — a one-word, behavior-preserving edit — so the advisor imports the desk's own buckets instead of duplicating them and drifting. This is a deliberate departure from spec §1.1's "no edits to existing code"; it is the smallest possible one.
2. **`/advisor` is unreachable without a sidebar entry.** **Ruling:** add one entry to the `nav` array in `src/components/sidebar.tsx` as part of Task 5.
3. **`src/app/analyze/page.tsx` is one `"use client"` file with Thai strings.** **Ruling:** `/advisor` departs from that — a static server shell plus a client form child, English copy — because the shell must stay free of Prisma and `force-dynamic`.

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `src/lib/advisor/types.ts` | Every shared type and constant. No logic. |
| `src/lib/advisor/sizing.ts` | Whole-share sizing under the two caps. |
| `src/lib/advisor/sizing.test.ts` | Both caps, both zero-share reasons, the worked example. |
| `src/lib/advisor/rLadder.ts` | R ladder as real prices and P/L; cost expressed in R. |
| `src/lib/advisor/rLadder.test.ts` | Ladder arithmetic, zero shares, cost in R. |
| `src/lib/advisor/advise.ts` | Composes the above into one card. Pure. |
| `src/lib/advisor/advise.test.ts` | Composition, gate BLIND, missing holdings, already-held. |
| `src/app/api/advisor/route.ts` | The ONLY I/O. Fetch candles, call `advise()`. |
| `src/app/advisor/page.tsx` | Static server shell. |
| `src/app/advisor/advisor-form.tsx` | `"use client"` form + rendered card. |

**Modified:**

| File | Change |
| --- | --- |
| `src/lib/trading/positionSizing.ts:24` | Add `export` to `corrMultiplierFor`. Nothing else. |
| `src/components/sidebar.tsx:8-15` | One new `nav` entry for `/advisor`. |

---

### Task 1: Types, constants, and whole-share sizing

**Files:**
- Create: `src/lib/advisor/types.ts`
- Create: `src/lib/advisor/sizing.ts`
- Test: `src/lib/advisor/sizing.test.ts`
- Modify: `src/lib/trading/positionSizing.ts:24` (add `export` to `corrMultiplierFor`)

**Interfaces:**
- Consumes: `Candle` from `@/lib/indicators`; `GateDecision` from `@/lib/market/marketGate`.
- Produces:
  - `ADVISOR_NO_EDGE_CLAIM: string`, `ADVISOR_COST_BPS = 5`, `ADVISOR_ATR_PERIOD = 14`, `ADVISOR_ATR_SL_MULT = 1.5`, `ADVISOR_R_STEPS: readonly number[]`
  - `interface ShareSizingInput { entry; slDistance; capital; maxSlots; riskPct }`
  - `interface ShareSizingResult { shares; riskShares; affordableShares; slotBudget; riskUsdTarget; actualRiskUsd; actualRiskPct; boundBy; reason }`
  - `interface LadderRow { r; price; gainPct; plUsd }`
  - `interface CorrelationLine { ticker; correlation; note }`
  - `interface AdvisorInput`, `interface AdvisorCard`, `type AdvisorResult`
  - `export function sizeShares(input: ShareSizingInput): ShareSizingResult`
  - `export function corrMultiplierFor(...)` becomes importable from `@/lib/trading/positionSizing`

- [ ] **Step 1: Write `src/lib/advisor/types.ts`**

This file is types and constants only — there is nothing to test in it, so it is written before the failing test rather than after.

```ts
// Shared types and constants for the stock advisory tool.
//
// This tool does not predict. It reports structure and risk for a ticker the
// owner already chose, so they can decide with their eyes open. Every rule this
// project has ever fitted died on its deep hold-out; nothing here is an edge.
//
// Pure — no I/O anywhere under src/lib/advisor/. Candles arrive as arguments.

import type { Candle } from "@/lib/indicators";
import type { GateDecision } from "@/lib/market/marketGate";

/** Printed on every card, verbatim. Do not soften it. */
export const ADVISOR_NO_EDGE_CLAIM =
  "This tool does not predict anything. It reports structure and risk for a " +
  "ticker you chose. No rule in this project has survived its deep hold-out, " +
  "so nothing here is a reason to buy.";

/** Round-trip cost assumption, in basis points. Webull charges no stock
 *  commission, so this is spread plus slippage, not fees. It is an assumption,
 *  not a measurement of the owner's own fills. */
export const ADVISOR_COST_BPS = 5;

export const ADVISOR_ATR_PERIOD = 14;

/** The one constant all three exit geometries in this repo agree on. The target
 *  multiple is the one they disagree about — hence the ladder, not a choice. */
export const ADVISOR_ATR_SL_MULT = 1.5;

export const ADVISOR_R_STEPS: readonly number[] = [1, 1.5, 2, 2.5, 3];

/** Which of the two caps produced `shares`. Both, when they tie. */
export type SizingCap = "risk" | "affordability";

export interface ShareSizingInput {
  /** Intended fill price. */
  entry: number;
  /** Distance from entry to stop, in dollars. Always positive. */
  slDistance: number;
  /** Total account capital, in dollars. */
  capital: number;
  /** How many positions the account is willing to hold at once. */
  maxSlots: number;
  /** Percent units: 1 = 1% of capital. */
  riskPct: number;
}

export interface ShareSizingResult {
  /** Whole shares to buy. Zero is a legitimate answer and always has a reason. */
  shares: number;
  /** Shares the risk budget alone would allow. */
  riskShares: number;
  /** Shares one slot's worth of capital could pay for. */
  affordableShares: number;
  /** capital / maxSlots */
  slotBudget: number;
  /** capital * riskPct / 100 — what was ASKED for, not what happens. */
  riskUsdTarget: number;
  /** shares * slDistance — what actually happens if the stop fills. */
  actualRiskUsd: number;
  /** Percent units. Usually below riskPct, because affordability binds first. */
  actualRiskPct: number;
  /** Never empty when shares > 0. */
  boundBy: SizingCap[];
  /** Always populated. Explains the number, especially when it is zero. */
  reason: string;
}

export interface LadderRow {
  /** R multiple: 1, 1.5, 2, 2.5, 3. */
  r: number;
  /** entry + r * slDistance */
  price: number;
  /** Percent units, relative to entry. */
  gainPct: number;
  /** shares * (price - entry). Zero when shares is zero. */
  plUsd: number;
}

export interface CorrelationLine {
  ticker: string;
  /** null when the holding's candles could not be fetched or had no variance. */
  correlation: number | null;
  /** Why it is null, when it is null. Empty string otherwise. */
  note: string;
}

/** One position the owner already holds, as typed into the form. */
export interface HoldingInput {
  ticker: string;
  /** null when the fetch failed — the holding still consumes a slot. */
  candles: Candle[] | null;
}

export interface AdvisorInput {
  ticker: string;
  candles: Candle[];
  /** Blank in the form means "use the last close". */
  entryOverride?: number | null;
  capital: number;
  maxSlots: number;
  /** Percent units: 1 = 1%. */
  riskPct: number;
  costBps?: number;
  holdings: HoldingInput[];
  /** SPY daily candles, at least TREND_PERIOD of them. null = gate reads BLIND. */
  benchmark: Candle[] | null;
}

export interface AdvisorCard {
  ticker: string;
  /** Date of the last bar used, YYYY-MM-DD. */
  asOf: string;
  lastClose: number;
  entry: number;
  entrySource: "last close" | "override";
  atr: number;
  slDistance: number;
  stop: number;
  sizing: ShareSizingResult;
  /** shares * entry */
  deployedUsd: number;
  ladder: LadderRow[];
  /** Round-trip cost expressed as a fraction of one R. */
  costR: number;
  correlations: CorrelationLine[];
  avgCorrelation: number | null;
  /** From the desk's own corrMultiplierFor. Reported, never applied. */
  corrMultiplier: number;
  /** floor(shares * corrMultiplier). Shown as a second line. */
  corrAdjustedShares: number;
  /** max(0, maxSlots - holdings.length) */
  freeSlots: number;
  gate: GateDecision;
  /** True when the asked-about ticker is already in holdings. Shown at the top. */
  alreadyHeld: boolean;
  /** Everything that went wrong but did not stop the card rendering. */
  warnings: string[];
  noEdgeClaim: string;
}

export type AdvisorResult =
  | { ok: true; card: AdvisorCard }
  | { ok: false; error: string };
```

- [ ] **Step 2: Export `corrMultiplierFor`**

Only the `export` keyword changes. The body is untouched, so behavior is identical.

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && sed -i 's/^function corrMultiplierFor(/export function corrMultiplierFor(/' src/lib/trading/positionSizing.ts && sed -n '24p' src/lib/trading/positionSizing.ts
```

Expected output: `export function corrMultiplierFor(avgCorrelation: number | null): number {`

- [ ] **Step 3: Write the failing test**

Create `src/lib/advisor/sizing.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { sizeShares } from "./sizing";

test("the worked example: both caps bind at 2 shares and the real risk is 0.72%", () => {
  const r = sizeShares({ entry: 180, slDistance: 9, capital: 2500, maxSlots: 5, riskPct: 1 });
  assert.equal(r.riskShares, 2);
  assert.equal(r.affordableShares, 2);
  assert.equal(r.shares, 2);
  assert.deepEqual(r.boundBy, ["risk", "affordability"]);
  assert.equal(r.slotBudget, 500);
  assert.equal(r.riskUsdTarget, 25);
  assert.equal(r.actualRiskUsd, 18);
  assert.ok(Math.abs(r.actualRiskPct - 0.72) < 1e-9);
});

test("risk alone binds when the share price is small", () => {
  const r = sizeShares({ entry: 10, slDistance: 9, capital: 2500, maxSlots: 5, riskPct: 1 });
  assert.equal(r.riskShares, 2);
  assert.equal(r.affordableShares, 50);
  assert.equal(r.shares, 2);
  assert.deepEqual(r.boundBy, ["risk"]);
});

test("affordability alone binds when the stop is tight and the share is dear", () => {
  const r = sizeShares({ entry: 180, slDistance: 0.5, capital: 2500, maxSlots: 5, riskPct: 1 });
  assert.equal(r.riskShares, 50);
  assert.equal(r.affordableShares, 2);
  assert.equal(r.shares, 2);
  assert.deepEqual(r.boundBy, ["affordability"]);
  assert.equal(r.actualRiskUsd, 1);
});

test("zero shares because one share costs more than the slot budget, and it says so", () => {
  const r = sizeShares({ entry: 600, slDistance: 9, capital: 2500, maxSlots: 5, riskPct: 1 });
  assert.equal(r.affordableShares, 0);
  assert.equal(r.shares, 0);
  assert.equal(r.actualRiskUsd, 0);
  assert.match(r.reason, /slot budget/);
  assert.match(r.reason, /\$600\.00/);
});

test("zero shares because one share risks more than the whole risk budget, and it says so", () => {
  const r = sizeShares({ entry: 100, slDistance: 30, capital: 2500, maxSlots: 5, riskPct: 1 });
  assert.equal(r.riskShares, 0);
  assert.equal(r.shares, 0);
  assert.match(r.reason, /risk budget/);
  assert.match(r.reason, /\$30\.00/);
});

test("a non-positive stop distance is refused with a reason, not silently zeroed", () => {
  const r = sizeShares({ entry: 180, slDistance: 0, capital: 2500, maxSlots: 5, riskPct: 1 });
  assert.equal(r.shares, 0);
  assert.deepEqual(r.boundBy, []);
  assert.match(r.reason, /stop distance/i);
});

test("a non-positive slot count is refused with a reason", () => {
  const r = sizeShares({ entry: 180, slDistance: 9, capital: 2500, maxSlots: 0, riskPct: 1 });
  assert.equal(r.shares, 0);
  assert.match(r.reason, /slot/i);
});

test("no input can produce a fractional share", () => {
  for (const entry of [1.07, 33.33, 180, 999.99]) {
    for (const slDistance of [0.07, 1.3, 9, 44.4]) {
      for (const capital of [500, 2500, 137.5]) {
        for (const maxSlots of [1, 3, 5, 7]) {
          const r = sizeShares({ entry, slDistance, capital, maxSlots, riskPct: 1 });
          assert.ok(Number.isInteger(r.shares), `fractional shares for ${entry}/${slDistance}/${capital}/${maxSlots}`);
          assert.ok(Number.isInteger(r.riskShares));
          assert.ok(Number.isInteger(r.affordableShares));
          assert.ok(r.shares >= 0);
          assert.ok(r.reason.length > 0);
        }
      }
    }
  }
});
```

- [ ] **Step 4: Run it and confirm it fails**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && npx tsx --test src/lib/advisor/sizing.test.ts
```

Expected: fails to resolve `./sizing` — the module does not exist yet.

- [ ] **Step 5: Write `src/lib/advisor/sizing.ts`**

```ts
// Whole-share position sizing for a cash brokerage account.
//
// This is NOT computeLot() in src/lib/trading/positionSizing.ts. That one
// returns a fractional forex lot with a 0.01 minimum, which a Webull share
// order cannot express. Two caps apply here and the binding one is usually
// affordability, not risk, because $2,500 spread over 5 slots buys very few
// shares of anything expensive. The result names which cap bound and reports
// the risk that actually results, never the risk that was requested.
//
// Pure.

import type { ShareSizingInput, ShareSizingResult, SizingCap } from "./types";

function refuse(slotBudget: number, riskUsdTarget: number, reason: string): ShareSizingResult {
  return {
    shares: 0,
    riskShares: 0,
    affordableShares: 0,
    slotBudget,
    riskUsdTarget,
    actualRiskUsd: 0,
    actualRiskPct: 0,
    boundBy: [],
    reason,
  };
}

export function sizeShares(input: ShareSizingInput): ShareSizingResult {
  const { entry, slDistance, capital, maxSlots, riskPct } = input;

  const slotBudget = maxSlots > 0 ? capital / maxSlots : 0;
  const riskUsdTarget = (capital * riskPct) / 100;

  if (!Number.isFinite(entry) || entry <= 0) {
    return refuse(
      slotBudget,
      riskUsdTarget,
      "No position: the entry price is not a positive number.",
    );
  }
  if (!Number.isFinite(slDistance) || slDistance <= 0) {
    return refuse(
      slotBudget,
      riskUsdTarget,
      "No position: the stop distance is zero or unreadable, so risk per share cannot be measured.",
    );
  }
  if (!Number.isFinite(maxSlots) || maxSlots <= 0) {
    return refuse(
      slotBudget,
      riskUsdTarget,
      "No position: the slot count must be at least 1.",
    );
  }
  if (!Number.isFinite(capital) || capital <= 0) {
    return refuse(
      slotBudget,
      riskUsdTarget,
      "No position: capital must be greater than zero.",
    );
  }

  const riskShares = Math.floor(riskUsdTarget / slDistance);
  const affordableShares = Math.floor(slotBudget / entry);
  const shares = Math.min(riskShares, affordableShares);

  const boundBy: SizingCap[] = [];
  if (riskShares <= affordableShares) boundBy.push("risk");
  if (affordableShares <= riskShares) boundBy.push("affordability");

  const actualRiskUsd = shares * slDistance;
  const actualRiskPct = (actualRiskUsd / capital) * 100;

  let reason: string;
  if (shares === 0) {
    const parts: string[] = [];
    if (riskShares === 0) {
      parts.push(
        `one share risks $${slDistance.toFixed(2)}, more than the entire risk budget of $${riskUsdTarget.toFixed(2)}`,
      );
    }
    if (affordableShares === 0) {
      parts.push(
        `one share costs $${entry.toFixed(2)}, more than the slot budget of $${slotBudget.toFixed(2)}`,
      );
    }
    reason = `No position: ${parts.join("; and ")}.`;
  } else if (boundBy.length === 2) {
    reason =
      `${shares} share(s). Both caps bind at the same number: the risk budget allows ${riskShares} ` +
      `and the slot budget affords ${affordableShares}. Real risk is $${actualRiskUsd.toFixed(2)} ` +
      `(${actualRiskPct.toFixed(2)}% of capital), not the ${riskPct}% requested.`;
  } else if (boundBy[0] === "risk") {
    reason =
      `${shares} share(s), capped by RISK: the risk budget of $${riskUsdTarget.toFixed(2)} allows ` +
      `${riskShares} at $${slDistance.toFixed(2)} of risk each, while the slot budget could afford ` +
      `${affordableShares}. Real risk is $${actualRiskUsd.toFixed(2)} (${actualRiskPct.toFixed(2)}% of capital).`;
  } else {
    reason =
      `${shares} share(s), capped by AFFORDABILITY: one slot is $${slotBudget.toFixed(2)}, which buys ` +
      `${affordableShares} at $${entry.toFixed(2)}, while the risk budget would have allowed ${riskShares}. ` +
      `Real risk is $${actualRiskUsd.toFixed(2)} (${actualRiskPct.toFixed(2)}% of capital), not the ${riskPct}% requested.`;
  }

  return {
    shares,
    riskShares,
    affordableShares,
    slotBudget,
    riskUsdTarget,
    actualRiskUsd,
    actualRiskPct,
    boundBy,
    reason,
  };
}
```

- [ ] **Step 6: Run the test and the typechecker**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && npx tsx --test src/lib/advisor/sizing.test.ts && npm run typecheck
```

Expected: 8 passing tests, `tsc --noEmit` clean.

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && git add src/lib/advisor/types.ts src/lib/advisor/sizing.ts src/lib/advisor/sizing.test.ts src/lib/trading/positionSizing.ts && git commit -m "feat(advisor): whole-share sizing under the risk and affordability caps

Two caps apply to a Webull cash account and the binding one at \$2,500 is
usually affordability, not risk. The result names which cap bound and
reports the risk that actually results, never the risk that was asked for.

corrMultiplierFor gains an export keyword so the advisor can reuse the
desk's own correlation buckets instead of duplicating them. No behavior
change.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The R ladder

**Files:**
- Create: `src/lib/advisor/rLadder.ts`
- Test: `src/lib/advisor/rLadder.test.ts`

**Interfaces:**
- Consumes: `LadderRow`, `ADVISOR_R_STEPS`, `ADVISOR_COST_BPS` from `./types`.
- Produces:
  - `export function rLadder(entry: number, slDistance: number, shares: number, steps?: readonly number[]): LadderRow[]`
  - `export function costInR(entry: number, slDistance: number, costBps?: number): number`

- [ ] **Step 1: Write the failing test**

Create `src/lib/advisor/rLadder.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { rLadder, costInR } from "./rLadder";

test("the worked example ladder: five rungs from 1R to 3R", () => {
  const rows = rLadder(180, 9, 2);
  assert.equal(rows.length, 5);

  assert.deepEqual(rows[0], { r: 1, price: 189, gainPct: 5, plUsd: 18 });
  assert.deepEqual(rows[1], { r: 1.5, price: 193.5, gainPct: 7.5, plUsd: 27 });
  assert.deepEqual(rows[2], { r: 2, price: 198, gainPct: 10, plUsd: 36 });
  assert.deepEqual(rows[3], { r: 2.5, price: 202.5, gainPct: 12.5, plUsd: 45 });
  assert.deepEqual(rows[4], { r: 3, price: 207, gainPct: 15, plUsd: 54 });
});

test("zero shares still prints prices, with zero P/L", () => {
  const rows = rLadder(180, 9, 0);
  assert.equal(rows[0].price, 189);
  assert.equal(rows[0].plUsd, 0);
  assert.equal(rows[4].plUsd, 0);
});

test("the ladder honours a custom step list", () => {
  const rows = rLadder(100, 10, 1, [1, 2]);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].price, 120);
});

test("round-trip cost at 5bps on a 9-dollar stop is 0.02R", () => {
  assert.ok(Math.abs(costInR(180, 9, 5) - 0.02) < 1e-12);
});

test("a tighter stop makes the same cost a larger share of one R", () => {
  const wide = costInR(180, 9, 5);
  const tight = costInR(180, 1, 5);
  assert.ok(tight > wide);
  assert.ok(Math.abs(tight - 0.18) < 1e-12);
});

test("cost in R scales linearly with the bps assumption", () => {
  assert.ok(Math.abs(costInR(180, 9, 10) - 2 * costInR(180, 9, 5)) < 1e-12);
  assert.equal(costInR(180, 9, 0), 0);
});

test("P/L on every rung equals shares * r * slDistance", () => {
  const shares = 7;
  const slDistance = 3.25;
  for (const row of rLadder(88, slDistance, shares)) {
    assert.ok(Math.abs(row.plUsd - shares * row.r * slDistance) < 1e-9);
  }
});

test("an unusable stop distance reports zero cost rather than Infinity", () => {
  assert.equal(costInR(180, 0, 5), 0);
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && npx tsx --test src/lib/advisor/rLadder.test.ts
```

Expected: fails to resolve `./rLadder`.

- [ ] **Step 3: Write `src/lib/advisor/rLadder.ts`**

```ts
// The R ladder: what each exit multiple is worth, in the prices the owner will
// actually type into Webull and the dollars they will actually see.
//
// The tool does NOT pick a target. The three exit geometries in this repo
// disagree — 2.5 live, 1.2 research, 1.5 trail — and none of them survived a
// deep hold-out, so choosing one here would be inventing an answer. The ladder
// shows the whole range and the owner picks.
//
// Pure.

import { ADVISOR_COST_BPS, ADVISOR_R_STEPS, type LadderRow } from "./types";

/**
 * One row per R multiple. Prices are entry + r * slDistance; P/L is per the
 * whole position. With zero shares the prices still print — the owner may want
 * to see the geometry even when they cannot take the trade.
 */
export function rLadder(
  entry: number,
  slDistance: number,
  shares: number,
  steps: readonly number[] = ADVISOR_R_STEPS,
): LadderRow[] {
  return steps.map((r) => {
    const price = entry + r * slDistance;
    return {
      r,
      price,
      gainPct: entry > 0 ? ((price - entry) / entry) * 100 : 0,
      plUsd: shares * (price - entry),
    };
  });
}

/**
 * Round-trip cost expressed as a fraction of one R — the only unit in which
 * cost is comparable to an edge. Webull charges no stock commission, so this
 * is spread plus slippage, entry and exit, and it is an assumption rather than
 * a measurement of the owner's own fills.
 *
 * Note how fast it grows as the stop tightens: the same 5bps is 0.02R behind a
 * $9 stop and 0.18R behind a $1 one.
 */
export function costInR(entry: number, slDistance: number, costBps: number = ADVISOR_COST_BPS): number {
  if (!Number.isFinite(slDistance) || slDistance <= 0) return 0;
  if (!Number.isFinite(entry) || entry <= 0) return 0;
  return ((2 * costBps) / 10_000) * entry / slDistance;
}
```

- [ ] **Step 4: Run the test and the typechecker**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && npx tsx --test src/lib/advisor/rLadder.test.ts && npm run typecheck
```

Expected: 8 passing tests, `tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && git add src/lib/advisor/rLadder.ts src/lib/advisor/rLadder.test.ts && git commit -m "feat(advisor): R ladder in real prices, and cost expressed in R

Three exit geometries in this repo disagree on the target multiple and
none survived a deep hold-out, so the tool prints the whole ladder rather
than choosing. costInR makes the 5bps assumption comparable to an edge.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `advise()` — the composition

**Files:**
- Create: `src/lib/advisor/advise.ts`
- Test: `src/lib/advisor/advise.test.ts`

**Interfaces:**
- Consumes: `sizeShares` from `./sizing`; `rLadder`, `costInR` from `./rLadder`; every type and constant from `./types`; `atr` from `@/lib/indicators`; `dailyReturns`, `pearsonCorrelation` from `@/lib/trading/correlation`; `corrMultiplierFor` from `@/lib/trading/positionSizing` (exported in Task 1); `gateSlots`, `type GateDecision` from `@/lib/market/marketGate`.
- Produces: `export function advise(input: AdvisorInput): AdvisorResult`

**Reference — the exact existing signatures this task calls:**

```ts
atr(candles: Candle[], period = 14): (number | null)[]   // src/lib/indicators.ts:171
dailyReturns(candles: Candle[]): number[]                 // src/lib/trading/correlation.ts
pearsonCorrelation(xs: number[], ys: number[]): number | null
corrMultiplierFor(avgCorrelation: number | null): number  // null→1, ≥0.8→0.7, ≥0.6→0.85, else 1
gateSlots(benchmark: Candle[], freeSlots: number, cfg?: MarketGateConfig): GateDecision
// GateDecision = { slots: number; benchAbove: boolean | null; shortsAllowed: boolean; note: string }
// Candle = { t: number; o: number; h: number; l: number; c: number; v: number }  — t is epoch SECONDS
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/advisor/advise.test.ts`. The `bars()` helper follows the fixture style already used in `src/lib/market/marketGate.test.ts`.

```ts
import test from "node:test";
import assert from "node:assert/strict";

import type { Candle } from "@/lib/indicators";
import { advise } from "./advise";
import { ADVISOR_NO_EDGE_CLAIM } from "./types";

const DAY = 86_400;
const T0 = Date.parse("2020-01-01T00:00:00Z") / 1000;

/** n daily bars whose close is `close` and whose true range is exactly `range`. */
function bars(n: number, close: number, range = 6): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      t: T0 + i * DAY,
      o: close,
      h: close + range / 2,
      l: close - range / 2,
      c: close,
      v: 1_000_000,
    });
  }
  return out;
}

/** n daily bars rising by `step` each day — used for a benchmark above its SMA200. */
function rising(n: number, start: number, step: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const c = start + i * step;
    out.push({ t: T0 + i * DAY, o: c, h: c, l: c, c, v: 1_000_000 });
  }
  return out;
}

const BASE = {
  ticker: "AAPL",
  capital: 2500,
  maxSlots: 5,
  riskPct: 1,
  holdings: [],
  benchmark: null,
};

test("the worked example composes end to end", () => {
  const res = advise({ ...BASE, candles: bars(60, 180, 6), entryOverride: 180 });
  assert.equal(res.ok, true);
  if (!res.ok) return;

  const card = res.card;
  assert.equal(card.ticker, "AAPL");
  assert.equal(card.entry, 180);
  assert.equal(card.entrySource, "override");
  assert.equal(card.atr, 6);
  assert.equal(card.slDistance, 9);
  assert.equal(card.stop, 171);
  assert.equal(card.sizing.shares, 2);
  assert.equal(card.deployedUsd, 360);
  assert.equal(card.ladder[4].price, 207);
  assert.ok(Math.abs(card.costR - 0.02) < 1e-12);
  assert.equal(card.noEdgeClaim, ADVISOR_NO_EDGE_CLAIM);
});

test("a blank entry falls back to the last close, and asOf is the last bar's date", () => {
  const res = advise({ ...BASE, candles: bars(60, 180, 6) });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.card.entry, 180);
  assert.equal(res.card.entrySource, "last close");
  assert.equal(res.card.lastClose, 180);
  assert.equal(res.card.asOf, "2020-02-29");
});

test("too few bars for ATR is an explicit error, not a card", () => {
  const res = advise({ ...BASE, candles: bars(5, 180, 6) });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.error, /ATR/);
});

test("an empty candle array is an explicit error", () => {
  const res = advise({ ...BASE, candles: [] });
  assert.equal(res.ok, false);
});

test("a missing benchmark renders the card and reads the gate BLIND", () => {
  const res = advise({ ...BASE, candles: bars(60, 180, 6) });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.card.gate.benchAbove, null);
  assert.match(res.card.gate.note, /BLIND/);
  assert.ok(res.card.warnings.some((w) => /benchmark/i.test(w)));
});

test("a benchmark too short for SMA200 reads BLIND and still renders a card", () => {
  const res = advise({ ...BASE, candles: bars(60, 180, 6), benchmark: rising(120, 100, 0.5) });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.card.gate.benchAbove, null);
  assert.equal(res.card.gate.slots, 5);
  assert.equal(res.card.noEdgeClaim, ADVISOR_NO_EDGE_CLAIM);
});

test("a real benchmark above its SMA200 leaves the free slots alone", () => {
  const res = advise({ ...BASE, candles: bars(60, 180, 6), benchmark: rising(300, 100, 0.5) });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.card.gate.benchAbove, true);
  assert.equal(res.card.freeSlots, 5);
  assert.equal(res.card.gate.slots, 5);
});

test("holdings consume slots, and an unfetchable holding still consumes one", () => {
  const res = advise({
    ...BASE,
    candles: bars(60, 180, 6),
    holdings: [
      { ticker: "MSFT", candles: bars(60, 300, 4) },
      { ticker: "NVDA", candles: null },
    ],
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;

  assert.equal(res.card.freeSlots, 3);
  assert.equal(res.card.correlations.length, 2);

  const nvda = res.card.correlations.find((c) => c.ticker === "NVDA");
  assert.equal(nvda?.correlation, null);
  assert.match(nvda?.note ?? "", /could not be fetched/i);
  assert.ok(res.card.warnings.some((w) => /NVDA/.test(w)));
});

test("holding the asked-about ticker is flagged", () => {
  const res = advise({
    ...BASE,
    candles: bars(60, 180, 6),
    holdings: [{ ticker: "aapl", candles: bars(60, 180, 6) }],
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.card.alreadyHeld, true);
});

test("the correlation multiplier is reported, never folded into shares", () => {
  const res = advise({ ...BASE, candles: bars(60, 180, 6), entryOverride: 180 });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  // No holdings -> no correlation -> multiplier 1, and shares is untouched either way.
  assert.equal(res.card.avgCorrelation, null);
  assert.equal(res.card.corrMultiplier, 1);
  assert.equal(res.card.sizing.shares, 2);
  assert.equal(res.card.corrAdjustedShares, 2);
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && npx tsx --test src/lib/advisor/advise.test.ts
```

Expected: fails to resolve `./advise`.

- [ ] **Step 3: Write `src/lib/advisor/advise.ts`**

```ts
// advise(): everything the card shows, from candle arrays already in hand.
//
// Pure by design — no fetch, no prisma, no clock. The route does the I/O and
// hands the arrays in, so every number here is reproducible from its inputs and
// testable without a network.
//
// Three failure levels, and they are deliberately different:
//   * the asked-about ticker is unusable  -> no card at all, explicit error
//   * a holding is unfetchable            -> card renders; that line reads
//                                            "unknown" and still eats a slot
//   * the benchmark is unfetchable        -> card renders; the gate reads BLIND
//                                            and says so, because the gate must
//                                            never reduce slots silently

import { atr } from "@/lib/indicators";
import { gateSlots, type GateDecision } from "@/lib/market/marketGate";
import { dailyReturns, pearsonCorrelation } from "@/lib/trading/correlation";
import { corrMultiplierFor } from "@/lib/trading/positionSizing";

import { rLadder, costInR } from "./rLadder";
import { sizeShares } from "./sizing";
import {
  ADVISOR_ATR_PERIOD,
  ADVISOR_ATR_SL_MULT,
  ADVISOR_COST_BPS,
  ADVISOR_NO_EDGE_CLAIM,
  type AdvisorCard,
  type AdvisorInput,
  type AdvisorResult,
  type CorrelationLine,
} from "./types";

/** Candle.t is epoch SECONDS, not milliseconds. */
function barDate(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 10);
}

export function advise(input: AdvisorInput): AdvisorResult {
  const ticker = input.ticker.trim().toUpperCase();
  if (!ticker) return { ok: false, error: "No ticker was given." };

  const candles = input.candles;
  if (!candles || candles.length === 0) {
    return { ok: false, error: `No price history came back for ${ticker}.` };
  }

  const lastBar = candles[candles.length - 1];
  const lastClose = lastBar.c;

  const atrSeries = atr(candles, ADVISOR_ATR_PERIOD);
  const atrValue = atrSeries.at(-1) ?? null;
  if (atrValue == null || !Number.isFinite(atrValue) || atrValue <= 0) {
    return {
      ok: false,
      error:
        `ATR(${ADVISOR_ATR_PERIOD}) could not be computed for ${ticker} from ${candles.length} bars, ` +
        `so there is no stop distance and therefore no size. Nothing is shown rather than a guess.`,
    };
  }

  const warnings: string[] = [];

  const override = input.entryOverride;
  const useOverride = override != null && Number.isFinite(override) && override > 0;
  const entry = useOverride ? (override as number) : lastClose;
  const entrySource: AdvisorCard["entrySource"] = useOverride ? "override" : "last close";

  const slDistance = ADVISOR_ATR_SL_MULT * atrValue;
  const stop = entry - slDistance;

  const sizing = sizeShares({
    entry,
    slDistance,
    capital: input.capital,
    maxSlots: input.maxSlots,
    riskPct: input.riskPct,
  });

  const costBps = input.costBps ?? ADVISOR_COST_BPS;
  const ladder = rLadder(entry, slDistance, sizing.shares);
  const costR = costInR(entry, slDistance, costBps);

  // Correlation against what is already held. Reported, never applied.
  const tickerReturns = dailyReturns(candles);
  const correlations: CorrelationLine[] = input.holdings.map((h) => {
    const name = h.ticker.trim().toUpperCase();
    if (!h.candles || h.candles.length === 0) {
      warnings.push(`${name}: price history could not be fetched, so its correlation is unknown. It still consumes a slot.`);
      return { ticker: name, correlation: null, note: "price history could not be fetched" };
    }
    const c = pearsonCorrelation(tickerReturns, dailyReturns(h.candles));
    if (c == null) {
      return { ticker: name, correlation: null, note: "too few overlapping bars, or no variance" };
    }
    return { ticker: name, correlation: c, note: "" };
  });

  const known = correlations.map((c) => c.correlation).filter((c): c is number => c != null);
  const avgCorrelation = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : null;
  const corrMultiplier = corrMultiplierFor(avgCorrelation);
  const corrAdjustedShares = Math.floor(sizing.shares * corrMultiplier);

  const freeSlots = Math.max(0, input.maxSlots - input.holdings.length);

  const benchmark = input.benchmark;
  let gate: GateDecision;
  if (benchmark && benchmark.length > 0) {
    gate = gateSlots(benchmark, freeSlots);
  } else {
    gate = {
      slots: freeSlots,
      benchAbove: null,
      shortsAllowed: true,
      note: "BLIND: the benchmark could not be fetched, so the market gate is not reducing slots. It never reduces them silently.",
    };
    warnings.push("The benchmark (SPY) could not be fetched, so the market regime is unknown.");
  }

  const alreadyHeld = input.holdings.some((h) => h.ticker.trim().toUpperCase() === ticker);

  const card: AdvisorCard = {
    ticker,
    asOf: barDate(lastBar.t),
    lastClose,
    entry,
    entrySource,
    atr: atrValue,
    slDistance,
    stop,
    sizing,
    deployedUsd: sizing.shares * entry,
    ladder,
    costR,
    correlations,
    avgCorrelation,
    corrMultiplier,
    corrAdjustedShares,
    freeSlots,
    gate,
    alreadyHeld,
    warnings,
    noEdgeClaim: ADVISOR_NO_EDGE_CLAIM,
  };

  return { ok: true, card };
}
```

- [ ] **Step 4: Run the test and the typechecker**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && npx tsx --test src/lib/advisor/advise.test.ts && npm run typecheck
```

Expected: 10 passing tests, `tsc --noEmit` clean. If the `atr` fixture does not produce exactly 6, read `src/lib/indicators.ts:171` and adjust the `bars()` helper's `range` so true range is constant — do NOT loosen the assertion to make it pass.

- [ ] **Step 5: Run the whole suite**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && npm test
```

Expected: all pre-existing tests still pass alongside the three new files.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && git add src/lib/advisor/advise.ts src/lib/advisor/advise.test.ts && git commit -m "feat(advisor): compose the card from candles, purely

Three failure levels, deliberately different: an unusable main ticker
yields no card at all; an unfetchable holding still consumes a slot and
reads 'unknown'; an unfetchable benchmark renders the card with the gate
BLIND, because the gate must never reduce slots silently.

Correlation and the desk's corrMultiplierFor are reported as a second
line, never folded into the share count.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `POST /api/advisor` — the only I/O

**Files:**
- Create: `src/app/api/advisor/route.ts`

**Interfaces:**
- Consumes: `advise` and every type from `@/lib/advisor/*`; `fetchCandles`, `fetchCandlesBatch` from `@/lib/marketData`; `BENCHMARK` from `@/lib/market/regime`.
- Produces: `POST /api/advisor` returning `AdvisorResult` as JSON — `{ ok: true, card }` with status 200, or `{ ok: false, error }` with status 400 or 502.

**Reference — the exact existing signatures this task calls:**

```ts
fetchCandles(symbol: string, range = "1mo", interval = "1h", minDays = 0): Promise<CandleResponse>
fetchCandlesBatch(symbols: string[], range = "1mo", interval = "1d"): Promise<Map<string, CandleResponse>>
// CandleResponse = { symbol, range, interval, currency?, exchangeName?, price?, provider?, candles: Candle[] }
// fetchCandlesBatch OMITS symbols it could not fetch, and takes NO minDays.
BENCHMARK = "SPY"        // src/lib/market/regime.ts:30
TREND_PERIOD = 200       // src/lib/market/regime.ts:35
```

**Why the benchmark is fetched separately:** SMA200 needs 200 *sessions*, roughly 290 calendar days. Folding SPY into the `"6mo"` batch would make `sma()` return null and the gate would read BLIND on every single request without anyone noticing. `fetchCandlesBatch` takes no `minDays`, so the benchmark gets its own `fetchCandles(BENCHMARK, "2y", "1d", 300)`.

- [ ] **Step 1: Write `src/app/api/advisor/route.ts`**

There is no test for this route or for the page — nothing under `src/app/` has tests in this repo, and adding a test harness for the App Router is out of scope. Verification is Task 5's dev-server check.

```ts
// The advisory tool's only I/O. Everything in src/lib/advisor/ is pure and
// takes candle arrays; this route is what fetches them.
//
// The benchmark is fetched on its own rather than folded into the batch: SMA200
// needs 200 sessions (~290 calendar days), fetchCandlesBatch takes no minDays,
// and a "6mo" SPY would make the gate read BLIND on every request with nobody
// the wiser.

import { advise } from "@/lib/advisor/advise";
import type { HoldingInput } from "@/lib/advisor/types";
import { BENCHMARK } from "@/lib/market/regime";
import { fetchCandles, fetchCandlesBatch } from "@/lib/marketData";
import type { CandleResponse } from "@/lib/yahoo";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_HOLDINGS = 20;

function toPositiveNumber(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const ticker = String(body.ticker ?? "").trim().toUpperCase();
  if (!/^[A-Z][A-Z.\-]{0,9}$/.test(ticker)) {
    return Response.json({ ok: false, error: "Enter a ticker symbol, e.g. AAPL." }, { status: 400 });
  }

  const holdingTickers = Array.isArray(body.holdings)
    ? body.holdings
        .map((h) => String(h ?? "").trim().toUpperCase())
        .filter((h) => /^[A-Z][A-Z.\-]{0,9}$/.test(h))
        .slice(0, MAX_HOLDINGS)
    : [];

  const capital = toPositiveNumber(body.capital, 2500);
  const maxSlots = Math.max(1, Math.round(toPositiveNumber(body.maxSlots, 5)));
  const riskPct = toPositiveNumber(body.riskPct, 1);

  const rawEntry = body.entry;
  const entryOverride =
    rawEntry === "" || rawEntry == null ? null : toPositiveNumber(rawEntry, 0) || null;

  const symbols = Array.from(new Set([ticker, ...holdingTickers]));

  let batch: Map<string, CandleResponse>;
  try {
    batch = await fetchCandlesBatch(symbols, "6mo", "1d");
  } catch (e) {
    return Response.json(
      { ok: false, error: `Price data could not be fetched: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  const main = batch.get(ticker);
  if (!main || main.candles.length === 0) {
    return Response.json(
      { ok: false, error: `No daily price history came back for ${ticker}.` },
      { status: 502 },
    );
  }

  const holdings: HoldingInput[] = holdingTickers.map((h) => ({
    ticker: h,
    candles: batch.get(h)?.candles ?? null,
  }));

  // 2y at 1d with a 300-day floor, so SMA200 has the 200 sessions it needs.
  const benchmark = await fetchCandles(BENCHMARK, "2y", "1d", 300)
    .then((r) => (r.candles.length > 0 ? r.candles : null))
    .catch(() => null);

  const result = advise({
    ticker,
    candles: main.candles,
    entryOverride,
    capital,
    maxSlots,
    riskPct,
    holdings,
    benchmark,
  });

  return Response.json(result, { status: result.ok ? 200 : 400 });
}
```

- [ ] **Step 2: Typecheck and lint**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && npm run typecheck && npm run lint
```

Expected: both clean.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && git add src/app/api/advisor/route.ts && git commit -m "feat(advisor): POST /api/advisor, the tool's only I/O

The benchmark is fetched separately at 2y/300d rather than folded into
the 6mo batch: SMA200 needs 200 sessions, fetchCandlesBatch takes no
minDays, and a 6mo SPY would silently read BLIND on every request.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The `/advisor` page

**Files:**
- Create: `src/app/advisor/page.tsx`
- Create: `src/app/advisor/advisor-form.tsx`
- Modify: `src/components/sidebar.tsx:8-15` (one `nav` entry)

**Interfaces:**
- Consumes: `AdvisorCard`, `AdvisorResult` from `@/lib/advisor/types`; `Card`, `CardTitle`, `Stat`, `Badge`, `Button`, `PageHeader` from `@/components/ui`; `fmtMoney`, `fmtNumber`, `fmtPct` from `@/lib/utils`; `POST /api/advisor`.
- Produces: the route `/advisor`, reachable from the sidebar.

**Reference — the existing UI primitives:**

```ts
Card({ ...ComponentProps<"div"> })
CardTitle({ children, className? })
Stat({ label, value, sub?, subColor? })
Button({ variant?: "default" | "ghost" | "outline" | "danger", size?: "sm" | "md", ...button props })
Badge({ children, tone?: "neutral" | "positive" | "negative" | "warning" | "info", className?, title? })
PageHeader({ title, description?, action? })
fmtPct(n)  // n is in PERCENT units; the function divides by 100 before formatting
```

- [ ] **Step 1: Add the sidebar entry**

`Compass` is the icon; it is already available from `lucide-react`, which the file imports from.

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && \
sed -i 's/import { Radar, FileBarChart, Activity, LineChart, FlaskConical, ScrollText, Microscope } from "lucide-react";/import { Radar, FileBarChart, Activity, LineChart, FlaskConical, ScrollText, Microscope, Compass } from "lucide-react";/' src/components/sidebar.tsx && \
sed -i 's|  { href: "/backtest", label: "Backtest Lab", icon: FlaskConical },|  { href: "/advisor", label: "Trade Advisor", icon: Compass },\n  { href: "/backtest", label: "Backtest Lab", icon: FlaskConical },|' src/components/sidebar.tsx && \
sed -n '5,17p' src/components/sidebar.tsx
```

Expected: the import line now ends `Microscope, Compass } from "lucide-react";` and the `nav` array has a `/advisor` entry between `/analyze` and `/backtest`.

- [ ] **Step 2: Write `src/app/advisor/page.tsx`**

A static server shell — no Prisma, no `force-dynamic`. `src/app/layout.tsx` already wraps children in `<main className="flex-1 min-w-0 px-6 py-8 lg:px-10">`, so this renders its own plain `<div>` the way `src/app/reports/page.tsx` does.

```tsx
import { PageHeader } from "@/components/ui";
import { ADVISOR_NO_EDGE_CLAIM } from "@/lib/advisor/types";

import { AdvisorForm } from "./advisor-form";

export const metadata = { title: "Trade Advisor — NEXMIND" };

export default function AdvisorPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Trade Advisor"
        description="Name a ticker. Get its structure, its risk, and what one slot of your capital can actually buy."
      />
      <p className="text-sm text-(--color-muted) max-w-2xl border-l-2 border-(--color-border) pl-4">
        {ADVISOR_NO_EDGE_CLAIM}
      </p>
      <AdvisorForm />
    </div>
  );
}
```

- [ ] **Step 3: Write `src/app/advisor/advisor-form.tsx`**

```tsx
"use client";

import { useState } from "react";

import { Badge, Button, Card, CardTitle, Stat } from "@/components/ui";
import type { AdvisorCard, AdvisorResult } from "@/lib/advisor/types";
import { fmtMoney, fmtNumber, fmtPct } from "@/lib/utils";

const CAP_LABEL: Record<string, string> = {
  risk: "RISK BUDGET",
  affordability: "AFFORDABILITY",
};

export function AdvisorForm() {
  const [ticker, setTicker] = useState("");
  const [entry, setEntry] = useState("");
  const [capital, setCapital] = useState("2500");
  const [maxSlots, setMaxSlots] = useState("5");
  const [riskPct, setRiskPct] = useState("1");
  const [holdings, setHoldings] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState<AdvisorCard | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setCard(null);
    try {
      const res = await fetch("/api/advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          entry,
          capital,
          maxSlots,
          riskPct,
          holdings: holdings.split(/[\s,]+/).filter(Boolean),
        }),
      });
      const json = (await res.json()) as AdvisorResult;
      if (json.ok) setCard(json.card);
      else setError(json.error);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-3">
          <Field label="Ticker" value={ticker} onChange={setTicker} placeholder="AAPL" required />
          <Field label="Entry (blank = last close)" value={entry} onChange={setEntry} placeholder="180.00" />
          <Field label="Capital ($)" value={capital} onChange={setCapital} />
          <Field label="Max slots" value={maxSlots} onChange={setMaxSlots} />
          <Field label="Risk per trade (%)" value={riskPct} onChange={setRiskPct} />
          <Field
            label="Currently holding (comma separated)"
            value={holdings}
            onChange={setHoldings}
            placeholder="MSFT, NVDA"
          />
          <div className="sm:col-span-3">
            <Button type="submit" disabled={loading}>
              {loading ? "Reading…" : "Read the structure"}
            </Button>
          </div>
        </form>
      </Card>

      {error ? (
        <Card className="p-5 border-(--color-negative)/40">
          <CardTitle className="text-(--color-negative)">Nothing to show</CardTitle>
          <p className="text-sm mt-2">{error}</p>
        </Card>
      ) : null}

      {card ? <ResultCard card={card} /> : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-xs text-(--color-muted) space-y-1">
      <span>{label}</span>
      <input
        className="w-full rounded-md border border-(--color-border) bg-(--color-card) px-3 py-2 text-sm text-(--color-foreground)"
        value={value}
        placeholder={placeholder}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function ResultCard({ card }: { card: AdvisorCard }) {
  return (
    <div className="space-y-4">
      {card.alreadyHeld ? (
        <Card className="p-4 border-(--color-warning)/40">
          <p className="text-sm">
            <Badge tone="warning">ALREADY HELD</Badge>{" "}
            You listed {card.ticker} among your current holdings. Everything below sizes a NEW position on top of it.
          </p>
        </Card>
      ) : null}

      {/* Stat already renders its own Card, so these grids are NOT wrapped in one. */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold tracking-tight">
            {card.ticker} · {fmtMoney(card.lastClose)}
          </h2>
          <span className="text-xs text-(--color-muted) font-mono">as of {card.asOf}</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <Stat label="Entry" value={fmtMoney(card.entry)} sub={card.entrySource} />
          <Stat label="Stop (1.5 x ATR)" value={fmtMoney(card.stop)} sub={`${fmtMoney(card.slDistance)} away`} />
          <Stat label="ATR(14)" value={fmtMoney(card.atr)} />
          <Stat label="Cost of the round trip" value={`${fmtNumber(card.costR, 3)} R`} sub="5bps assumption" />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Size</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          <Stat label="Shares" value={fmtNumber(card.sizing.shares, 0)} />
          <Stat
            label="Capital deployed"
            value={fmtMoney(card.deployedUsd)}
            sub={`slot budget ${fmtMoney(card.sizing.slotBudget)}`}
          />
          <Stat
            label="Real risk"
            value={fmtMoney(card.sizing.actualRiskUsd)}
            sub={`${fmtPct(card.sizing.actualRiskPct)} of capital`}
          />
          <Stat label="Bound by" value={card.sizing.boundBy.map((b) => CAP_LABEL[b] ?? b).join(" + ") || "—"} />
        </div>
        <Card className="p-5 space-y-2">
          <p className="text-sm text-(--color-muted)">{card.sizing.reason}</p>
          <p className="text-sm text-(--color-muted)">
            With the desk&apos;s correlation rule (multiplier {fmtNumber(card.corrMultiplier, 2)}):{" "}
            {fmtNumber(card.corrAdjustedShares, 0)} share(s). Reported, not applied — the number above is unadjusted.
          </p>
        </Card>
      </section>

      <Card className="p-5 space-y-3">
        <CardTitle>R ladder</CardTitle>
        <p className="text-xs text-(--color-muted)">
          The tool does not pick a target. Three exit geometries in this project disagree, and none survived a deep
          hold-out.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-(--color-muted) text-left">
              <tr>
                <th className="py-1 pr-4">R</th>
                <th className="py-1 pr-4">Price</th>
                <th className="py-1 pr-4">Gain</th>
                <th className="py-1">P/L on {fmtNumber(card.sizing.shares, 0)} share(s)</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {card.ladder.map((row) => (
                <tr key={row.r} className="border-t border-(--color-border)">
                  <td className="py-1 pr-4">{fmtNumber(row.r, 1)}R</td>
                  <td className="py-1 pr-4">{fmtMoney(row.price)}</td>
                  <td className="py-1 pr-4">{fmtPct(row.gainPct)}</td>
                  <td className="py-1">{fmtMoney(row.plUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Slots and market state</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Free slots" value={fmtNumber(card.freeSlots, 0)} sub={`${card.ticker} would be one of them`} />
          <Stat
            label="Gate"
            value={card.gate.benchAbove == null ? "BLIND" : card.gate.benchAbove ? "ABOVE TREND" : "BELOW TREND"}
            sub={`${fmtNumber(card.gate.slots, 0)} slot(s) permitted`}
          />
          <Stat
            label="Avg correlation to holdings"
            value={card.avgCorrelation == null ? "—" : fmtNumber(card.avgCorrelation, 2)}
          />
        </div>
        <Card className="p-5 space-y-2">
          <p className="text-sm text-(--color-muted)">{card.gate.note}</p>
          <p className="text-xs text-(--color-muted)">
            This is information. The tool blocks nothing — the decision is yours.
          </p>
          {card.correlations.length > 0 ? (
            <ul className="text-sm space-y-1">
              {card.correlations.map((c) => (
                <li key={c.ticker} className="font-mono">
                  {c.ticker}: {c.correlation == null ? `unknown (${c.note})` : fmtNumber(c.correlation, 2)}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </section>

      {card.warnings.length > 0 ? (
        <Card className="p-5 space-y-2 border-(--color-warning)/40">
          <CardTitle>What went wrong but did not stop the card</CardTitle>
          <ul className="text-sm space-y-1 list-disc pl-5">
            {card.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <p className="text-xs text-(--color-muted) border-l-2 border-(--color-border) pl-4">{card.noEdgeClaim}</p>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck, lint, and the whole test suite**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && npm run typecheck && npm run lint && npm test
```

Expected: all three clean.

- [ ] **Step 5: Verify in the browser**

Start the dev server with the Browser pane (`preview_start`, never Bash) on `npm run dev:web` / port 3275, navigate to `http://localhost:3275/advisor`, submit `AAPL` with capital 2500, 5 slots, 1% risk and holdings `MSFT, NVDA`, then:

- `read_console_messages` — expect no errors
- `read_page` — confirm the card renders: a stop, a share count, a "Bound by" value, five ladder rows, a gate reading that is not BLIND, and the no-edge claim at the bottom
- `computer {action: "screenshot"}` — send the screenshot to the owner with `SendUserFile`

If the gate reads BLIND on a live request, the benchmark fetch is the bug — check that `fetchCandles(BENCHMARK, "2y", "1d", 300)` is returning at least 200 bars.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && git add src/app/advisor/page.tsx src/app/advisor/advisor-form.tsx src/components/sidebar.tsx && git commit -m "feat(advisor): the /advisor page and its sidebar entry

A static server shell plus a client form, so the shell stays free of
Prisma and force-dynamic. The card always names which cap bound the size
and prints the real risk percentage, never the requested one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Done When

- `npm test`, `npm run typecheck`, and `npm run lint` are all clean.
- `/advisor` is reachable from the sidebar and renders a full card for a live ticker.
- Every card prints `ADVISOR_NO_EDGE_CLAIM` verbatim, names the binding cap, and shows the actual risk percentage.
- Nothing under `src/lib/advisor/` imports Prisma, `marketData`, or `yahoo`.
