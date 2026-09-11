# RAVEN Advisor Critic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AI critic ("RAVEN") to the `/advisor` page that can only argue *against* the structure on the card — never recommend, score, rank or approve — invoked by an explicit button and enforced by both the type contract and a deterministic guard.

**Architecture:** A pure module renders the already-computed `AdvisorCard` + `ChartBar[]` into a plain-text facts sheet and holds the strip-directional-language guard. A sibling impure module calls the model through the project's existing `callAgentJSON` (which resolves to the owner's Claude subscription via the CLI backend) and always resolves — never throws — returning `degraded: true` on any failure. A `POST` route wires the two together, and a client component adds a button under the card. Nothing about the card itself changes; RAVEN is decoration on a card that is already complete.

**Tech Stack:** TypeScript, Next.js 16.2.7 (Turbopack, App Router), React 19 client components, `node:test` + `node:assert/strict` run by `tsx --test`, Tailwind v4 utility classes with CSS custom properties.

**Spec:** `docs/superpowers/specs/2026-09-11-advisor-ai-critic-design.md` — read it before Task 1. The plan argues from the spec; where they disagree, the spec wins except at the three Rulings recorded below.

## Global Constraints

- **RAVEN can only argue against.** No `approved`, no `score`, no `side`, no `confidence` field may appear anywhere in the result type, the JSON schema, the prompt or the UI. Saying what to do is an edge claim and this project has none to make.
- **`src/lib/advisor/` stays pure.** No `prisma`, no market-data fetch, no `yahoo`, no clock, no `child_process`. The AI call lives in `src/lib/critic/`.
- **Nothing in `advise.ts`, `sizing.ts`, `rLadder.ts`, `chartSeries.ts` or `types.ts` is modified.** `AdvisorCard` keeps meaning exactly what it meant before RAVEN existed.
- **`ADVISOR_NO_EDGE_CLAIM` is unchanged** and stays rendered at the bottom of the card, *below* the critique block.
- **Guard vocabulary, verbatim** (spec §4):
  ```
  English (word-boundary, case-insensitive):
    buy, buying, sell, selling, long, short, enter, entering, avoid,
    recommend, recommendation, suggest, should, worth it, take this trade
  Thai (substring — Thai has no word boundaries):
    ควรซื้อ, น่าซื้อ, ควรเข้า, น่าเข้า, ควรขาย, ไม่ควร, แนะนำ, น่าลงทุน
  ```
  Thai matches are plain `String.includes` — a `\b` anchor never fires against Thai and would silently disable the whole Thai half.
- **Stripping is visible, never silent.** Stripped objections are appended verbatim to `stripped` and rendered in the UI.
- **At most 4 objections.** Zero objections is a legitimate answer and is rendered as a sentence, never as blank space.
- **`costUsd` is displayed as the word "subscription", never as "$0.00".** The CLI backend reports `0`; a printed zero dollars reads as a bug.
- **No auto-run.** The critique fires only from the button. The card must render before any AI runs.
- **Thai UI strings, verbatim:**
  - button: `หาข้อโต้แย้ง`
  - wait copy: `อาจใช้เวลา 10-40 วินาที`
  - zero objections: `RAVEN ไม่พบข้อโต้แย้งจากตัวเลขชุดนี้ — ไม่ได้แปลว่าน่าเข้า`
  - stripped note: `RAVEN พยายามให้คำแนะนำซื้อ/ขาย N ครั้ง — ตัดออกแล้ว` (`N` = `stripped.length`)
- **Tests live under `src/lib/` only.** `src/app/` carries no tests, by project convention. No network in any test.
- **Every `*Pct` field in this codebase is already in percent units** (`fmtPct` in `src/lib/utils.ts:31` divides by 100). Never multiply a `*Pct` field by 100 again.
- **Formatting numbers:** the facts sheet formats every number itself with local helpers, not with `fmtPct`/`fmtMoney`, so the `/100` convention cannot leak into the model's input.
- **Lint:** repo-wide `npm run lint` has a ~263-problem pre-existing baseline. Judge lint on touched files only.
- **Commit attribution:** every commit message ends with
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```
- **Never `git add -A`, `git add .`, `git commit -a`, `git stash`, `git clean`, `git reset --hard`, or `git checkout --` any path.** The working tree carries the owner's uncommitted research work. Stage only the exact files each task names, by explicit path.
- **Never `git add docs/STATE.md`.**

## Rulings (spec conflicts resolved against the code)

Three places where the spec's words do not match what the code can deliver. These are decided; implement the ruling, not the spec sentence.

1. **"52-week high and low" (spec §3, position-in-range) is not available.** `src/app/api/advisor/route.ts:205` builds `chart` with `chartSeries(candles)`, which returns the last `CHART_VISIBLE_BARS = 126` bars — roughly six months. **Ruling:** label the block by the actual window (`bars supplied: N daily bars, <first date> to <last date>`) and report the high/low *over the supplied bars*, never as "52-week". Calling a six-month range a 52-week range is exactly the kind of quietly wrong number this project refuses to print. Cost if wrong: RAVEN sees a shorter lookback than the spec author imagined — one weaker argument, no incorrect number.

2. **`maxDuration = 120` would kill the request before the CLI's own timeout.** `src/app/api/advisor/route.ts:~30` sets `export const maxDuration = 120`, but `callAgentCli` runs with a hard 240 s timeout and `CLI_CONCURRENCY = 3` means a third caller can queue behind two in-flight subprocesses. **Ruling:** the critique route sets `export const maxDuration = 300`. A platform kill produces a raw 504 the UI cannot explain; the CLI timeout produces the `degraded` result the UI *can* explain. Cost if wrong: a hung request occupies a connection for up to 5 minutes.

3. **`Severity`, `Objection` and `CritiqueResult` live in `src/lib/advisor/critiqueContext.ts`,** not in `src/lib/critic/advisorCritic.ts`. The spec's file table assigns critiqueContext.ts "facts sheet + `guardObjections()`" and does not say where the types go. The client component must import `CritiqueResult`, and `advisorCritic.ts` transitively imports `node:child_process` through `src/lib/anthropic.ts` — importing it from a `"use client"` file would drag a Node builtin into the browser bundle. The pure module is the only safe home. Cost if wrong: none; it is an import-path choice.

---

## File Structure

| File | Responsibility | Pure |
|---|---|---|
| `src/lib/advisor/critiqueContext.ts` | **Create.** `Severity` / `Objection` / `CritiqueResult` types; `renderCritiqueContext(card, chart)`; `guardObjections(objections)` | **yes** |
| `src/lib/advisor/critiqueContext.test.ts` | **Create.** Facts-sheet content, degenerate cards, guard behaviour | — |
| `src/lib/critic/advisorCritic.ts` | **Create.** System prompt, JSON schema, `callAgentJSON`, normalisation, guard call, never-throws fallback | no (I/O) |
| `src/lib/critic/advisorCritic.test.ts` | **Create.** Mock-backend path returns `degraded`; guard runs inside `critiqueCard` | — |
| `src/app/api/advisor/critique/route.ts` | **Create.** `POST` boundary: shape-validate body, render facts, call, return | no (I/O) |
| `src/app/advisor/advisor-critique.tsx` | **Create.** Button, in-flight state, rendered objections / blind spots / stripped / degraded | no |
| `src/app/advisor/advisor-form.tsx` | **Modify.** Mount `<AdvisorCritique>` above the no-edge claim; clear the critique when any form input changes | no |

`src/lib/critic/` is a new directory, created by Task 3. It mirrors how `src/lib/trading/sage.ts` sits beside the pure modules it reads.

---

### Task 1: The facts sheet (pure)

**Files:**
- Create: `src/lib/advisor/critiqueContext.ts`
- Test: `src/lib/advisor/critiqueContext.test.ts`

**Interfaces:**
- Consumes: `AdvisorCard`, `ShareSizingResult`, `LadderRow`, `CorrelationLine`, `ADVISOR_ATR_PERIOD`, `ADVISOR_ATR_SL_MULT`, `ADVISOR_COST_BPS` from `@/lib/advisor/types`; `ChartBar` from `@/lib/advisor/chartSeries`; `GateDecision` (reached through `AdvisorCard["gate"]`, not imported directly).
- Produces:
  - `export type Severity = "note" | "concern" | "serious"`
  - `export interface Objection { claim: string; evidence: string; severity: Severity }`
  - `export interface CritiqueResult { objections: Objection[]; blindSpots: string[]; degraded: boolean; note: string; stripped: string[]; model: string; costUsd: number }`
  - `export function renderCritiqueContext(card: AdvisorCard, chart: ChartBar[] | null): string`

Task 2 adds `guardObjections` to this same file. Task 3 imports all four names. Task 5 imports `CritiqueResult`, `Objection` and `Severity` only.

**Reference — the exact input shapes** (already in the repo; do not redefine them):

```ts
// src/lib/advisor/types.ts
export interface ShareSizingResult {
  shares: number; riskShares: number; affordableShares: number;
  slotBudget: number; riskUsdTarget: number; actualRiskUsd: number;
  actualRiskPct: number; boundBy: SizingCap[]; reason: string;
}
export interface LadderRow { r: number; price: number; gainPct: number; plUsd: number }
export interface CorrelationLine { ticker: string; correlation: number | null; note: string }
// src/lib/market/marketGate.ts
export interface GateDecision {
  slots: number; benchAbove: boolean | null; shortsAllowed: boolean; note: string;
}
// src/lib/advisor/chartSeries.ts
export interface ChartBar {
  t: number; d: string; o: number; h: number; l: number; c: number; v: number;
  sma50: number | null; sma200: number | null;
}
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/advisor/critiqueContext.test.ts`:

```ts
// The facts sheet is the model's entire view of the trade. Its tests are
// content tests, not snapshot tests: what matters is that a number the owner
// can see on the card is present in the string, and that a number the card
// does NOT have renders as an explicit "n/a" rather than vanishing. An absent
// line reads to a model as a fact that does not exist, which is a different
// and worse claim than "unknown".
//
// No dotenv import: this module is pure and pulls in nothing that touches
// prisma at module scope (contrast src/lib/trading/hawk.test.ts).

import { test } from "node:test";
import assert from "node:assert/strict";

import type { ChartBar } from "@/lib/advisor/chartSeries";
import { renderCritiqueContext } from "@/lib/advisor/critiqueContext";
import { ADVISOR_NO_EDGE_CLAIM, type AdvisorCard } from "@/lib/advisor/types";

function makeCard(over: Partial<AdvisorCard> = {}): AdvisorCard {
  return {
    ticker: "AAPL",
    asOf: "2026-09-10",
    lastClose: 226.4,
    entry: 226.4,
    entrySource: "last close",
    atr: 4.12,
    slDistance: 6.18,
    stop: 220.22,
    sizing: {
      shares: 4,
      riskShares: 4,
      affordableShares: 2,
      slotBudget: 500,
      riskUsdTarget: 25,
      actualRiskUsd: 24.72,
      actualRiskPct: 0.99,
      boundBy: ["affordability"],
      reason: "affordability capped the size at 2 shares",
    },
    deployedUsd: 905.6,
    ladder: [
      { r: 1, price: 232.58, gainPct: 2.73, plUsd: 24.72 },
      { r: 2, price: 238.76, gainPct: 5.46, plUsd: 49.44 },
    ],
    costR: 0.04,
    correlations: [{ ticker: "MSFT", correlation: 0.62, note: "126 overlapping bars" }],
    avgCorrelation: 0.62,
    corrMultiplier: 0.7,
    corrAdjustedShares: 2,
    freeSlots: 3,
    gate: { slots: 3, benchAbove: true, shortsAllowed: false, note: "market gate ON" },
    alreadyHeld: false,
    warnings: [],
    noEdgeClaim: ADVISOR_NO_EDGE_CLAIM,
    ...over,
  };
}

function makeBars(n: number): ChartBar[] {
  return Array.from({ length: n }, (_, i) => ({
    t: 1_750_000_000 + i * 86_400,
    d: `2026-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, "0")}`,
    o: 200 + i,
    h: 205 + i,
    l: 195 + i,
    c: 200 + i,
    v: 1_000_000,
    sma50: 190 + i,
    sma200: 180 + i,
  }));
}

test("facts sheet carries entry, stop, ATR, costR and every ladder rung", () => {
  const text = renderCritiqueContext(makeCard(), makeBars(40));
  assert.match(text, /entry: \$226\.40/);
  assert.match(text, /stop: \$220\.22/);
  assert.match(text, /ATR\(14\): 4\.12/);
  assert.match(text, /0\.04 R/);
  assert.match(text, /1\.0 R · \$232\.58/);
  assert.match(text, /2\.0 R · \$238\.76/);
});

test("a zero-share card still renders and carries the sizing reason verbatim", () => {
  const card = makeCard({
    sizing: {
      shares: 0,
      riskShares: 0,
      affordableShares: 0,
      slotBudget: 100,
      riskUsdTarget: 25,
      actualRiskUsd: 0,
      actualRiskPct: 0,
      boundBy: ["affordability"],
      reason: "one share costs more than the slot budget",
    },
  });
  const text = renderCritiqueContext(card, makeBars(40));
  assert.match(text, /shares: 0/);
  assert.match(text, /one share costs more than the slot budget/);
});

test("a null chart renders the position-in-range block as n/a and throws nothing", () => {
  const text = renderCritiqueContext(makeCard(), null);
  assert.match(text, /\[position in range\]/);
  assert.match(text, /last close vs SMA50: n\/a/);
  assert.match(text, /last close vs SMA200: n\/a/);
  assert.doesNotMatch(text, /52-week/);
});

test("the correlation multiplier is labelled reported-not-applied", () => {
  const text = renderCritiqueContext(makeCard(), makeBars(40));
  assert.match(text, /correlation multiplier: 0\.70 — REPORTED ONLY, not applied/);
});

test("the range block names the window it actually measured, never 52-week", () => {
  const text = renderCritiqueContext(makeCard(), makeBars(40));
  assert.match(text, /bars supplied: 40 daily bars/);
  assert.doesNotMatch(text, /52-week/);
});

test("warnings render verbatim, and an empty list says so", () => {
  const dirty = renderCritiqueContext(makeCard({ warnings: ["correlation data missing for MSFT"] }), null);
  assert.match(dirty, /correlation data missing for MSFT/);
  const clean = renderCritiqueContext(makeCard(), null);
  assert.match(clean, /\[warnings\]\nnone/);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && npx tsx --test src/lib/advisor/critiqueContext.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/advisor/critiqueContext'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/advisor/critiqueContext.ts`:

```ts
// The facts sheet RAVEN argues about.
//
// Everything here was produced by this server one request earlier: the card the
// owner is looking at, and the bars already drawn under it. Nothing is fetched
// and nothing is recomputed, so the numbers RAVEN argues about are byte-for-byte
// the numbers on the owner's screen.
//
// buildAnalystContext is NOT reused: it takes a ScanResult, which the advisor
// never produces. The advisor gets its own, much smaller renderer.
//
// Every number is formatted here, once, with local helpers rather than with
// fmtPct/fmtMoney. fmtPct divides by 100, and every *Pct field in this codebase
// is already in percent units; keeping that convention out of the model's input
// removes a whole class of silently-wrong number.
//
// Pure — no prisma, no market data, no clock.

import type { ChartBar } from "@/lib/advisor/chartSeries";
import {
  ADVISOR_ATR_PERIOD,
  ADVISOR_ATR_SL_MULT,
  ADVISOR_COST_BPS,
  type AdvisorCard,
} from "@/lib/advisor/types";

export type Severity = "note" | "concern" | "serious";

export interface Objection {
  /** What is wrong with this structure. One sentence. */
  claim: string;
  /** The number from the card or the facts sheet that supports the claim. */
  evidence: string;
  severity: Severity;
}

export interface CritiqueResult {
  /** 0-4. Zero is a legitimate answer and is rendered as such. */
  objections: Objection[];
  /** What the card cannot see at all: earnings dates, news, sector-wide moves. */
  blindSpots: string[];
  /** True when the AI backend was unavailable or the call failed. */
  degraded: boolean;
  note: string;
  /** Claims the guard stripped, verbatim, so a muzzled model is visible. */
  stripped: string[];
  model: string;
  costUsd: number;
}

/** Bars in the "recent" sub-window of the range block. */
const RECENT_BARS = 20;

const NA = "n/a";

function num(v: number | null | undefined, digits = 2): string {
  return v == null || !Number.isFinite(v) ? NA : v.toFixed(digits);
}

/** The value is ALREADY in percent units. Do not scale it. */
function pct(v: number | null | undefined, digits = 2): string {
  return v == null || !Number.isFinite(v) ? NA : `${v.toFixed(digits)}%`;
}

function usd(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? NA : `$${v.toFixed(2)}`;
}

function yesNo(v: boolean | null): string {
  return v == null ? NA : v ? "yes" : "no";
}

export function renderCritiqueContext(card: AdvisorCard, chart: ChartBar[] | null): string {
  const s = card.sizing;
  const atrPctOfEntry = card.entry > 0 ? (card.atr / card.entry) * 100 : null;

  const lines: string[] = [
    "[head]",
    `ticker: ${card.ticker}`,
    `as of: ${card.asOf}`,
    `last close: ${usd(card.lastClose)}`,
    `entry: ${usd(card.entry)} (${card.entrySource})`,
    `already held: ${card.alreadyHeld ? "yes" : "no"}`,
    "",
    "[risk]",
    `ATR(${ADVISOR_ATR_PERIOD}): ${num(card.atr)} (${pct(atrPctOfEntry)} of entry)`,
    `stop distance: ${num(card.slDistance)} (${ADVISOR_ATR_SL_MULT} x ATR)`,
    `stop: ${usd(card.stop)}`,
    `round-trip cost at ${ADVISOR_COST_BPS} bps: ${num(card.costR)} R`,
    "",
    "[sizing]",
    `shares: ${s.shares}`,
    `bound by: ${s.boundBy.length > 0 ? s.boundBy.join(", ") : NA}`,
    `slot budget: ${usd(s.slotBudget)}`,
    `risk target: ${usd(s.riskUsdTarget)}`,
    `actual risk: ${usd(s.actualRiskUsd)} (${pct(s.actualRiskPct)} of capital)`,
    `risk-only shares: ${s.riskShares} / affordable shares: ${s.affordableShares}`,
    `deployed: ${usd(card.deployedUsd)}`,
    `sizing reason: ${s.reason}`,
    "",
    "[ladder]",
  ];

  if (card.ladder.length === 0) {
    lines.push(NA);
  } else {
    for (const row of card.ladder) {
      lines.push(`${num(row.r, 1)} R · ${usd(row.price)} · ${pct(row.gainPct)} · ${usd(row.plUsd)}`);
    }
  }

  lines.push("", "[portfolio]");
  if (card.correlations.length === 0) {
    lines.push(`correlations: ${NA}`);
  } else {
    for (const c of card.correlations) {
      lines.push(`correlation vs ${c.ticker}: ${num(c.correlation)} — ${c.note}`);
    }
  }
  lines.push(
    `average correlation: ${num(card.avgCorrelation)}`,
    `correlation multiplier: ${num(card.corrMultiplier)} — REPORTED ONLY, not applied to the share count above`,
    `correlation-adjusted shares: ${card.corrAdjustedShares} — REPORTED ONLY, not applied`,
    `free slots: ${card.freeSlots}`,
    "",
    "[regime]",
    `slots allowed by the market gate: ${card.gate.slots}`,
    `benchmark above its own trend: ${yesNo(card.gate.benchAbove)}`,
    `shorts allowed: ${yesNo(card.gate.shortsAllowed)}`,
    `gate note: ${card.gate.note}`,
    "",
    "[position in range]",
    ...rangeBlock(card, chart),
    "",
    "[warnings]",
  );

  if (card.warnings.length === 0) {
    lines.push("none");
  } else {
    for (const w of card.warnings) lines.push(`- ${w}`);
  }

  return lines.join("\n");
}

/**
 * Where the last close sits inside the history the client was actually given.
 *
 * The spec called this the "52-week" range; the chart the route hands back is
 * chartSeries()'s last CHART_VISIBLE_BARS bars — about six months. Labelling a
 * six-month range as 52 weeks would be the kind of quietly wrong number this
 * tool exists not to print, so the block names the window it measured.
 */
function rangeBlock(card: AdvisorCard, chart: ChartBar[] | null): string[] {
  if (chart == null || chart.length === 0) {
    return [
      `bars supplied: ${NA}`,
      `last close vs SMA50: ${NA}`,
      `last close vs SMA200: ${NA}`,
      `range over the supplied bars: ${NA}`,
      `last ${RECENT_BARS} bars: ${NA}`,
      "no chart history was supplied with this card, so nothing about position in range is known",
    ];
  }

  const first = chart[0]!;
  const last = chart[chart.length - 1]!;
  const vsSma = (mean: number | null): string =>
    mean == null || mean === 0 ? NA : pct(((last.c - mean) / mean) * 100);

  const hi = Math.max(...chart.map((b) => b.h));
  const lo = Math.min(...chart.map((b) => b.l));
  const span = hi - lo;
  const recent = chart.slice(-RECENT_BARS);

  const out = [
    `bars supplied: ${chart.length} daily bars, ${first.d} to ${last.d}`,
    `last close vs SMA50: ${vsSma(last.sma50)} (SMA50 ${num(last.sma50)})`,
    `last close vs SMA200: ${vsSma(last.sma200)} (SMA200 ${num(last.sma200)})`,
    `range over the supplied bars: high ${usd(hi)} / low ${usd(lo)}; last close sits at ` +
      `${pct(span > 0 ? ((last.c - lo) / span) * 100 : null)} of that range`,
    `last ${recent.length} bars: high ${usd(Math.max(...recent.map((b) => b.h)))} / ` +
      `low ${usd(Math.min(...recent.map((b) => b.l)))}`,
  ];

  // The rung the whole ladder depends on, against the highest price this name
  // has actually printed in the window. This is the MDLZ-style argument.
  const topRung = card.ladder.length > 0 ? card.ladder[card.ladder.length - 1]! : null;
  if (topRung != null) {
    out.push(
      `highest ladder target ${usd(topRung.price)} vs the highest high in the supplied window ${usd(hi)}`,
    );
  }
  return out;
}
```

- [ ] **Step 4: Run tests and typecheck**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && npx tsx --test src/lib/advisor/critiqueContext.test.ts && npm run typecheck
```

Expected: 6 tests pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && git add src/lib/advisor/critiqueContext.ts src/lib/advisor/critiqueContext.test.ts && git commit -m "$(cat <<'EOF'
feat(advisor): render the facts sheet RAVEN argues about

Pure renderer over the AdvisorCard and the ChartBar[] already returned
beside it. No fetch, no recomputation: the numbers in the sheet are the
numbers on the owner's screen. Nulls render an explicit n/a, because an
absent line reads to a model as a fact that does not exist.

The position-in-range block is labelled by the window it measured rather
than as "52-week": chartSeries() hands back about six months.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The guard (pure)

**Files:**
- Modify: `src/lib/advisor/critiqueContext.ts` (append; do not touch `renderCritiqueContext`)
- Test: `src/lib/advisor/critiqueContext.test.ts` (append)

**Interfaces:**
- Consumes: `Objection` from Task 1.
- Produces: `export function guardObjections(objections: Objection[]): { kept: Objection[]; stripped: string[] }`

A stripped entry is formatted `` `${claim} — ${evidence}` `` (em dash, spaces either side). Task 3 and Task 5 both rely on that exact shape only to display it, never to parse it.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/advisor/critiqueContext.test.ts`:

```ts
import { guardObjections, type Objection } from "@/lib/advisor/critiqueContext";

function obj(claim: string, evidence = "some number"): Objection {
  return { claim, evidence, severity: "concern" };
}

test("the guard strips English directional vocabulary and records it verbatim", () => {
  const { kept, stripped } = guardObjections([obj("You should buy this here")]);
  assert.equal(kept.length, 0);
  assert.equal(stripped.length, 1);
  assert.match(stripped[0]!, /You should buy this here — some number/);
});

test("the guard strips the negated form too — a negated verdict is still a verdict", () => {
  const { kept, stripped } = guardObjections([obj("You should not buy this")]);
  assert.equal(kept.length, 0);
  assert.equal(stripped.length, 1);
});

test("the guard strips Thai recommendation language by substring", () => {
  const { kept, stripped } = guardObjections([obj("ราคานี้ไม่ควรเข้า", "เกิน SMA50 อยู่ 26%")]);
  assert.equal(kept.length, 0);
  assert.equal(stripped.length, 1);
});

test("the guard matches directional words in the evidence field, not only the claim", () => {
  const { kept, stripped } = guardObjections([obj("The structure is stretched", "so avoid it")]);
  assert.equal(kept.length, 0);
  assert.equal(stripped.length, 1);
});

test("the guard leaves a clean structural objection untouched", () => {
  const clean = obj("The last close sits 26.7% above its SMA50", "SMA50 178.90, close 226.40");
  const { kept, stripped } = guardObjections([clean]);
  assert.deepEqual(kept, [clean]);
  assert.deepEqual(stripped, []);
});

test("the guard is word-boundary anchored in English — 'entered' and 'shortfall' survive", () => {
  const a = obj("Price entered this range only four bars ago", "bars 36-40");
  const b = obj("There is a shortfall between the budget and one share", "budget $100, share $226.40");
  const { kept, stripped } = guardObjections([a, b]);
  assert.equal(kept.length, 2);
  assert.deepEqual(stripped, []);
});

test("the guard preserves order and mixes kept with stripped correctly", () => {
  const clean = obj("ATR is 1.8% of entry", "4.12 on 226.40");
  const { kept, stripped } = guardObjections([obj("recommend waiting"), clean, obj("sell into strength")]);
  assert.deepEqual(kept, [clean]);
  assert.equal(stripped.length, 2);
});
```

Note the import line: if the file already imports from `@/lib/advisor/critiqueContext`, merge the new names into that existing import statement rather than adding a second one.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && npx tsx --test src/lib/advisor/critiqueContext.test.ts
```

Expected: FAIL — `guardObjections is not a function` / TS2305 export not found.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/advisor/critiqueContext.ts`:

```ts
// ---------------------------------------------------------------------------
// The guard, and the reason ADVISOR_NO_EDGE_CLAIM survives having an AI on the
// same screen.
//
// The system prompt also forbids this language. The guard exists because a
// prompt is not an enforcement mechanism. Presence of the vocabulary is the
// whole test — no sentiment analysis, so "you should not buy this" is stripped
// exactly like "you should buy this", because a negated verdict is a verdict.
// A false strip costs one objection, which is cheap; a leaked recommendation
// costs the claim printed four lines below it.
// ---------------------------------------------------------------------------

/** Word-boundary matched, case-insensitive. */
const GUARD_WORDS_EN: readonly string[] = [
  "buy",
  "buying",
  "sell",
  "selling",
  "long",
  "short",
  "enter",
  "entering",
  "avoid",
  "recommend",
  "recommendation",
  "suggest",
  "should",
  "worth it",
  "take this trade",
];

/**
 * Plain substring matched. Thai is written without spaces, so a \b anchor
 * never fires against it and would silently disable this entire half of the
 * list while still looking like it worked.
 */
const GUARD_WORDS_TH: readonly string[] = [
  "ควรซื้อ",
  "น่าซื้อ",
  "ควรเข้า",
  "น่าเข้า",
  "ควรขาย",
  "ไม่ควร",
  "แนะนำ",
  "น่าลงทุน",
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** No /g flag: a global regex carries lastIndex between .test() calls. */
const GUARD_RE_EN = new RegExp(`\\b(?:${GUARD_WORDS_EN.map(escapeRe).join("|")})\\b`, "i");

/** Exported for the tests and for anything that wants to explain a strip. */
export function isDirectional(text: string): boolean {
  if (GUARD_RE_EN.test(text)) return true;
  return GUARD_WORDS_TH.some((w) => text.includes(w));
}

/**
 * Remove every objection that recommends rather than objects.
 *
 * Stripping is visible, never silent: the removed text is returned verbatim so
 * the UI can say how many times the model had to be muzzled. A model that has
 * to be muzzled is information about the model.
 */
export function guardObjections(objections: Objection[]): { kept: Objection[]; stripped: string[] } {
  const kept: Objection[] = [];
  const stripped: string[] = [];
  for (const o of objections) {
    if (isDirectional(`${o.claim} ${o.evidence}`)) {
      stripped.push(`${o.claim} — ${o.evidence}`);
    } else {
      kept.push(o);
    }
  }
  return { kept, stripped };
}
```

- [ ] **Step 4: Run tests and typecheck**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && npx tsx --test src/lib/advisor/critiqueContext.test.ts && npm run typecheck
```

Expected: 13 tests pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && git add src/lib/advisor/critiqueContext.ts src/lib/advisor/critiqueContext.test.ts && git commit -m "$(cat <<'EOF'
feat(advisor): strip directional language out of RAVEN's objections

Presence of the vocabulary is the whole test: no sentiment analysis, so a
negated verdict is stripped like a plain one. English is word-boundary
matched so "entered" and "shortfall" survive; Thai is substring matched,
because \b never fires against a script written without spaces.

Stripped text is returned verbatim. A model that has to be muzzled is
information about the model, and the UI prints it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The AI call

**Files:**
- Create: `src/lib/critic/advisorCritic.ts`
- Test: `src/lib/critic/advisorCritic.test.ts`

**Interfaces:**
- Consumes: `guardObjections`, `Objection`, `Severity`, `CritiqueResult` from `@/lib/advisor/critiqueContext`; `callAgentJSON`, `aiBackend`, `aiOutageReason`, `AiUnavailableError` from `@/lib/anthropic`.
- Produces: `export async function critiqueCard(facts: string): Promise<CritiqueResult>` — **never throws**.

**Reference — the existing AI layer** (`src/lib/anthropic.ts`; do not modify it):

```ts
export type ModelTier = "haiku" | "sonnet" | "opus";
export type AiBackend = "api" | "cli" | "mock";
export function aiBackend(): AiBackend;
export function aiOutageReason(): string | null;
export class AiUnavailableError extends Error {}
export interface CallOptions {
  tier?: ModelTier; system?: string; prompt: string;
  maxTokens?: number; jsonSchema?: Record<string, unknown>;
}
export interface AgentResult {
  text: string; model: string; tier: ModelTier;
  costUsd: number; inputTokens: number; outputTokens: number;
}
export async function callAgentJSON<T>(opts: CallOptions): Promise<{ data: T } & AgentResult>;
```

`.env` carries `ANTHROPIC_API_KEY=` with an empty value, so `callAgent` takes the `callAgentCli` path — `claude -p --output-format json --model sonnet` against the owner's **subscription**, reporting `costUsd: 0`. `jsonSchema` is used only by the API path; the CLI path returns free text that `parseJsonLoose` recovers, which is why the shape check below is hand-written rather than trusted to a schema.

- [ ] **Step 1: Write the failing test**

Create `src/lib/critic/advisorCritic.test.ts`:

```ts
// critiqueCard never throws. Every failure mode the AI layer has — no backend
// configured, a CLI timeout, malformed JSON, a response that does not match the
// shape — resolves to { degraded: true, objections: [] } with a note saying
// why, because the card above it is already complete and correct and must not
// be taken down by a decoration.
//
// No dotenv import: anthropic.ts imports db lazily, inside persistOutage() and
// aiOutageStatus(), so nothing here touches prisma at module scope (contrast
// src/lib/trading/hawk.test.ts, which needs it).
//
// No network: the mock-backend path is reached by clearing both credentials,
// and the shape/guard paths are tested through the exported pure helpers.

import { test } from "node:test";
import assert from "node:assert/strict";

import { critiqueCard, normalizeCritique } from "@/lib/critic/advisorCritic";

test("with no backend configured, critiqueCard degrades instead of throwing", async () => {
  const key = process.env.ANTHROPIC_API_KEY;
  const path = process.env.PATH;
  process.env.ANTHROPIC_API_KEY = "";
  process.env.PATH = "";
  try {
    const r = await critiqueCard("[head]\nticker: AAPL");
    assert.equal(r.degraded, true);
    assert.deepEqual(r.objections, []);
    assert.deepEqual(r.stripped, []);
    assert.ok(r.note.length > 0, "a degraded result must say why");
    assert.equal(r.costUsd, 0);
  } finally {
    if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = key;
    if (path === undefined) delete process.env.PATH;
    else process.env.PATH = path;
  }
});

test("an all-directional response comes back empty with a populated stripped list", () => {
  const r = normalizeCritique(
    {
      objections: [
        { claim: "You should buy this", evidence: "the trend is up", severity: "serious" },
        { claim: "Better to sell into strength", evidence: "resistance at 240", severity: "note" },
      ],
      blindSpots: ["earnings date is not on the card"],
    },
    { model: "claude-sonnet-5", costUsd: 0 },
  );
  assert.deepEqual(r.objections, []);
  assert.equal(r.stripped.length, 2);
  assert.equal(r.degraded, false);
  assert.deepEqual(r.blindSpots, ["earnings date is not on the card"]);
});

test("normalizeCritique caps objections at four", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({
    claim: `structural problem ${i}`,
    evidence: `number ${i}`,
    severity: "concern",
  }));
  const r = normalizeCritique({ objections: many }, { model: "m", costUsd: 0 });
  assert.equal(r.objections.length, 4);
});

test("normalizeCritique survives junk: wrong types, missing fields, bad severity", () => {
  const r = normalizeCritique(
    {
      objections: [
        null,
        "a bare string",
        { claim: "", evidence: "x", severity: "concern" },
        { claim: "the ladder top is above every high in the window", evidence: "238.76 vs 236.00", severity: "APOCALYPSE" },
        { claim: "ATR is 1.8% of entry", evidence: 4.12 },
      ],
      blindSpots: [null, "news", 7],
    },
    { model: "m", costUsd: 0 },
  );
  assert.equal(r.objections.length, 2);
  assert.equal(r.objections[0]!.severity, "note", "an unknown severity falls back to the mildest");
  assert.equal(r.objections[1]!.evidence, "", "a non-string evidence becomes an empty string, never 4.12");
  assert.deepEqual(r.blindSpots, ["news"]);
  assert.equal(r.degraded, false);
});

test("normalizeCritique treats a missing objections array as zero objections, not an error", () => {
  const r = normalizeCritique({}, { model: "m", costUsd: 0 });
  assert.deepEqual(r.objections, []);
  assert.deepEqual(r.blindSpots, []);
  assert.equal(r.degraded, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && npx tsx --test src/lib/critic/advisorCritic.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/critic/advisorCritic'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/critic/advisorCritic.ts`:

```ts
// RAVEN — the only AI role this project's own record supports.
//
// HAWK, a directional vote, produced 51 Counterfactual rows and 0 fills here.
// SAGE, a reviewer that may only object, produced six genuine structural
// arguments in one session. §5 of the advisory spec stands: live trading cannot
// measure an edge, so the AI's value must not depend on one — which a vote's
// value entirely does, and an objection's does not.
//
// This module is impure (it spawns a subprocess through anthropic.ts), which is
// why it sits here and not in src/lib/advisor/. It mirrors src/lib/trading/sage.ts.
//
// critiqueCard NEVER throws. The card above it is already complete and correct.

import {
  guardObjections,
  type CritiqueResult,
  type Objection,
  type Severity,
} from "@/lib/advisor/critiqueContext";
import { AiUnavailableError, aiBackend, aiOutageReason, callAgentJSON } from "@/lib/anthropic";

/** Spec §1.2: 0-4. Zero is a legitimate answer. */
const MAX_OBJECTIONS = 4;

const SEVERITIES: readonly Severity[] = ["note", "concern", "serious"];

const CRITIQUE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    objections: {
      type: "array",
      maxItems: MAX_OBJECTIONS,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claim: { type: "string" },
          evidence: { type: "string" },
          severity: { type: "string", enum: [...SEVERITIES] },
        },
        required: ["claim", "evidence", "severity"],
      },
    },
    blindSpots: { type: "array", items: { type: "string" } },
  },
  required: ["objections", "blindSpots"],
};

const SYSTEM =
  "You are RAVEN, an independent critic on a trading desk. You are shown a " +
  "structure-and-risk card for a stock the owner has ALREADY chosen. Your only job " +
  "is to name what is wrong with the structure, and what the card cannot see. " +
  "You NEVER say whether to take the trade, never say buy, sell, enter, avoid, " +
  "skip or wait, never score it and never rank it, because neither you nor this " +
  "desk has any measured edge — a recommendation from you would be a claim this " +
  "desk cannot support. Argue only against the numbers in front of you, and quote " +
  "the specific number that supports each objection. Return at most " +
  `${MAX_OBJECTIONS} objections. Returning ZERO objections is a valid and useful ` +
  "answer; do not invent one to fill space. Also list what the card is blind to " +
  "(earnings dates, news, sector-wide moves) as short phrases. " +
  'Return JSON {"objections":[{"claim","evidence","severity":"note"|"concern"|"serious"}],"blindSpots":[string]}.';

/** The unvalidated shape the model may or may not have returned. */
export interface RawCritique {
  objections?: unknown;
  blindSpots?: unknown;
}

export async function critiqueCard(facts: string): Promise<CritiqueResult> {
  if (aiBackend() === "mock") {
    return degraded(aiOutageReason() ?? "no AI backend is configured");
  }
  try {
    const r = await callAgentJSON<RawCritique>({
      tier: "sonnet", // judgment work; a cheaper tier produces the generic
      // objections that made HAWK's votes worthless.
      system: SYSTEM,
      prompt: facts,
      maxTokens: 1200,
      jsonSchema: CRITIQUE_SCHEMA,
    });
    return normalizeCritique(r.data, { model: r.model, costUsd: r.costUsd });
  } catch (err) {
    // AiUnavailableError, a CLI timeout, malformed JSON and a shape mismatch
    // all land here and all mean the same thing to the owner: no critique this
    // time, and here is why.
    const reason =
      err instanceof AiUnavailableError || err instanceof Error ? err.message : String(err);
    return degraded(reason);
  }
}

/**
 * Turn whatever came back into a CritiqueResult, then run the guard.
 *
 * The guard runs HERE and not only in the UI: every caller of critiqueCard gets
 * the muzzled result, so a future caller cannot forget to apply it.
 *
 * Exported for the tests, which must not spawn a subprocess.
 */
export function normalizeCritique(
  raw: RawCritique,
  meta: { model: string; costUsd: number },
): CritiqueResult {
  const { kept, stripped } = guardObjections(readObjections(raw.objections));
  return {
    objections: kept.slice(0, MAX_OBJECTIONS),
    blindSpots: readStrings(raw.blindSpots),
    degraded: false,
    note: "",
    stripped,
    model: meta.model,
    costUsd: meta.costUsd,
  };
}

function degraded(note: string): CritiqueResult {
  return {
    objections: [],
    blindSpots: [],
    degraded: true,
    note,
    stripped: [],
    model: "",
    costUsd: 0,
  };
}

function readObjections(value: unknown): Objection[] {
  if (!Array.isArray(value)) return [];
  const out: Objection[] = [];
  for (const item of value) {
    if (item == null || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const claim = typeof row.claim === "string" ? row.claim.trim() : "";
    if (claim === "") continue; // an objection with no claim is not an objection
    const severity = SEVERITIES.find((s) => s === row.severity) ?? "note";
    out.push({
      claim,
      evidence: typeof row.evidence === "string" ? row.evidence : "",
      severity,
    });
  }
  return out;
}

function readStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
}
```

- [ ] **Step 4: Run tests and typecheck**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && npx tsx --test src/lib/critic/advisorCritic.test.ts && npm run typecheck
```

Expected: 5 tests pass, typecheck clean. If the first test does NOT see `degraded: true`, the environment resolved a backend anyway — check that both `ANTHROPIC_API_KEY` and `PATH` were cleared before the call.

- [ ] **Step 5: Run the whole suite**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && npm test
```

Expected: no new failures against the pre-existing baseline.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && git add src/lib/critic/advisorCritic.ts src/lib/critic/advisorCritic.test.ts && git commit -m "$(cat <<'EOF'
feat(critic): RAVEN, an advisor critic that can only argue against

Sonnet through the existing callAgentJSON, which resolves to the owner's
subscription via the CLI backend. The guard runs inside critiqueCard, not
only in the UI, so no future caller can forget it.

critiqueCard never throws: AiUnavailableError, a CLI timeout, malformed
JSON and a shape mismatch all resolve to degraded:true with a note. The
card above it is already complete and must not be taken down by a
decoration.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The route

**Files:**
- Create: `src/app/api/advisor/critique/route.ts`

**Interfaces:**
- Consumes: `renderCritiqueContext` from `@/lib/advisor/critiqueContext`; `critiqueCard` from `@/lib/critic/advisorCritic`; `AdvisorCard` from `@/lib/advisor/types`; `ChartBar` from `@/lib/advisor/chartSeries`.
- Produces: `POST /api/advisor/critique`, body `{ card: AdvisorCard; chart: ChartBar[] | null }`, responding `200` with a `CritiqueResult` or `400` with `{ ok: false, error: string }`.

No test file: `src/app/` carries no tests by project convention (spec §8).

**Reference — the idiom to mirror** (`src/app/api/advisor/route.ts`):

```ts
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
return Response.json({ ok: false, error: "…" }, { status: 400 });
```

- [ ] **Step 1: Write the route**

Create `src/app/api/advisor/critique/route.ts`:

```ts
// POST /api/advisor/critique — the RAVEN boundary.
//
// The body is server-produced data making a round trip through the browser: the
// card the /api/advisor route just returned, and the bars it returned beside it.
// A mangled body yields a nonsense critique, and since nothing here is
// persisted, sized, or traded on, a shape check is the proportionate defence —
// not a full re-validation of every field.
//
// Nothing is written to the database in this version. Persistence belongs to
// the decision-journal work, which is a separate design.

import type { ChartBar } from "@/lib/advisor/chartSeries";
import { renderCritiqueContext } from "@/lib/advisor/critiqueContext";
import type { AdvisorCard } from "@/lib/advisor/types";
import { critiqueCard } from "@/lib/critic/advisorCritic";

export const dynamic = "force-dynamic";

/**
 * Longer than the 240s hard timeout inside callAgentCli, and longer than the
 * advisor route's own 120.
 *
 * The CLI spawns a subprocess behind a 3-way concurrency gate, so a realistic
 * round trip is 10-40s and a queued one is longer. If the platform kills the
 * request first, the owner gets a raw 504 that the UI cannot explain; if the
 * CLI's own timeout fires first, critiqueCard returns a degraded result with a
 * note, which the UI can.
 */
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const card = body.card;
  if (card == null || typeof card !== "object") {
    return Response.json({ ok: false, error: "body.card is required" }, { status: 400 });
  }
  const c = card as Record<string, unknown>;

  if (typeof c.ticker !== "string" || c.ticker.trim() === "") {
    return Response.json({ ok: false, error: "card.ticker is required" }, { status: 400 });
  }
  if (typeof c.entry !== "number" || !Number.isFinite(c.entry)) {
    return Response.json({ ok: false, error: "card.entry must be a number" }, { status: 400 });
  }
  if (typeof c.stop !== "number" || !Number.isFinite(c.stop)) {
    return Response.json({ ok: false, error: "card.stop must be a number" }, { status: 400 });
  }
  if (c.sizing == null || typeof c.sizing !== "object") {
    return Response.json({ ok: false, error: "card.sizing is required" }, { status: 400 });
  }
  if (!Array.isArray(c.ladder)) {
    return Response.json({ ok: false, error: "card.ladder must be an array" }, { status: 400 });
  }

  // chart may legitimately be null: the position-in-range block then renders
  // n/a and RAVEN loses one class of argument, not the response.
  const chart = Array.isArray(body.chart) ? (body.chart as ChartBar[]) : null;

  const facts = renderCritiqueContext(card as AdvisorCard, chart);
  const result = await critiqueCard(facts);
  return Response.json(result, { status: 200 });
}
```

- [ ] **Step 2: Typecheck and lint the new file**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && npm run typecheck && npx eslint src/app/api/advisor/critique/route.ts
```

Expected: both clean.

- [ ] **Step 3: Verify the validation path without the AI**

Start the dev server through the Browser pane (`preview_start` with the `nexmind-dev-web` launch config — **never** start a dev server with Bash), then:

```bash
curl -s -X POST http://localhost:3275/api/advisor/critique -H "Content-Type: application/json" -d "{}"
```

Expected: `{"ok":false,"error":"body.card is required"}` with HTTP 400.

```bash
curl -s -X POST http://localhost:3275/api/advisor/critique -H "Content-Type: application/json" -d "{\"card\":{\"ticker\":\"AAPL\",\"entry\":226.4}}"
```

Expected: `{"ok":false,"error":"card.stop must be a number"}` with HTTP 400.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && git add src/app/api/advisor/critique/route.ts && git commit -m "$(cat <<'EOF'
feat(advisor): POST /api/advisor/critique

Shape-checks the round-tripped card, renders the facts sheet and calls
RAVEN. chart may be null — the position-in-range block then reads n/a.

maxDuration is 300, longer than callAgentCli's own 240s hard timeout: a
platform kill is a bare 504 the UI cannot explain, while the CLI timeout
produces a degraded result it can. Nothing is persisted.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The UI

**Files:**
- Create: `src/app/advisor/advisor-critique.tsx`
- Modify: `src/app/advisor/advisor-form.tsx` (three edits, all named below)

**Interfaces:**
- Consumes: `CritiqueResult`, `Objection`, `Severity` from `@/lib/advisor/critiqueContext`; `AdvisorCard` from `@/lib/advisor/types`; `ChartBar` from `@/lib/advisor/chartSeries`; `Badge`, `Button`, `Card`, `CardTitle` from `@/components/ui`.
- Produces: `export function AdvisorCritique({ card, chart }: { card: AdvisorCard; chart: ChartBar[] | null })`

**Reference — the component signatures already in `src/components/ui.tsx`:**

```tsx
export function Card({ className, children, ...props }: ComponentProps<"div">)
export function CardTitle({ children, className }: { children: ReactNode; className?: string })
export function Button({ className, variant = "default", size = "md", ...props }:
  ComponentProps<"button"> & { variant?: "default"|"ghost"|"outline"|"danger"; size?: "sm"|"md" })
export function Badge({ children, tone = "neutral", className, title }:
  { children: ReactNode; tone?: "neutral"|"positive"|"negative"|"warning"|"info"; className?: string; title?: string })
```

- [ ] **Step 1: Write the component**

Create `src/app/advisor/advisor-critique.tsx`:

```tsx
"use client";

// RAVEN's block on the advisor card.
//
// It is decoration on a card that is already complete: if the button is never
// pressed, or the backend is down, everything above and below this block is
// unchanged and still correct. Which is why it never runs on submit — the wait
// is 10-40s behind a 3-way subprocess queue, and the card must render first.

import { useState } from "react";

import { Badge, Button, Card, CardTitle } from "@/components/ui";
import type { ChartBar } from "@/lib/advisor/chartSeries";
import type { CritiqueResult, Severity } from "@/lib/advisor/critiqueContext";
import type { AdvisorCard } from "@/lib/advisor/types";

/** `serious` is a stronger argument, not an alarm. No red. */
const SEVERITY_TONE: Record<Severity, "neutral" | "info" | "warning"> = {
  note: "neutral",
  concern: "info",
  serious: "warning",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  note: "note",
  concern: "concern",
  serious: "serious",
};

export function AdvisorCritique({ card, chart }: { card: AdvisorCard; chart: ChartBar[] | null }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CritiqueResult | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/advisor/critique", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card, chart }),
      });
      const json = (await res.json()) as CritiqueResult | { ok: false; error: string };
      if ("ok" in json && json.ok === false) {
        setError(json.error);
      } else {
        setResult(json as CritiqueResult);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-5 space-y-3">
      <CardTitle>RAVEN</CardTitle>
      <p className="text-xs text-(--color-muted)">
        RAVEN โต้แย้งได้อย่างเดียว — ไม่บอกให้ซื้อ ไม่บอกให้ขาย ไม่ให้คะแนน
      </p>

      <div className="flex items-center gap-3">
        <Button type="button" onClick={run} disabled={loading}>
          {loading ? "กำลังหา…" : "หาข้อโต้แย้ง"}
        </Button>
        {loading ? <span className="text-xs text-(--color-muted)">อาจใช้เวลา 10-40 วินาที</span> : null}
      </div>

      {error ? <p className="text-sm text-rose-400">{error}</p> : null}

      {result ? <CritiqueBody result={result} /> : null}
    </Card>
  );
}

function CritiqueBody({ result }: { result: CritiqueResult }) {
  if (result.degraded) {
    return (
      <p className="text-sm text-(--color-muted)">
        RAVEN ไม่ได้ทำงานรอบนี้ — {result.note}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {result.objections.length === 0 ? (
        <p className="text-sm">RAVEN ไม่พบข้อโต้แย้งจากตัวเลขชุดนี้ — ไม่ได้แปลว่าน่าเข้า</p>
      ) : (
        <ul className="space-y-3">
          {result.objections.map((o, i) => (
            <li key={`${o.claim}-${i}`} className="space-y-1">
              <div className="flex items-start gap-2">
                <Badge tone={SEVERITY_TONE[o.severity]}>{SEVERITY_LABEL[o.severity]}</Badge>
                <span className="text-sm">{o.claim}</span>
              </div>
              <p className="text-xs text-(--color-muted) font-mono pl-1">{o.evidence}</p>
            </li>
          ))}
        </ul>
      )}

      {result.blindSpots.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs text-(--color-muted)">สิ่งที่การ์ดใบนี้มองไม่เห็นเลย</p>
          <ul className="text-xs text-(--color-muted) list-disc pl-5 space-y-1">
            {result.blindSpots.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* A model that had to be muzzled is a fact about the model, so the count
          and the text are both shown rather than quietly dropped. */}
      {result.stripped.length > 0 ? (
        <details className="text-xs text-(--color-muted)">
          <summary>
            RAVEN พยายามให้คำแนะนำซื้อ/ขาย {result.stripped.length} ครั้ง — ตัดออกแล้ว
          </summary>
          <ul className="mt-2 list-disc pl-5 space-y-1">
            {result.stripped.map((s, i) => (
              <li key={`${s}-${i}`}>{s}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {/* costUsd is 0 on the subscription backend. A printed "$0.00" reads as a
          bug, so the word is printed instead. */}
      <p className="text-xs text-(--color-muted)">
        {result.model ? `${result.model} · ` : ""}subscription
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the card — edit 1 of 3, the import**

In `src/app/advisor/advisor-form.tsx`, add to the import block at the top (keep the existing `import { AdvisorChart } from "./advisor-chart";` line and place this beside it):

```tsx
import { AdvisorCritique } from "./advisor-critique";
```

- [ ] **Step 3: Edit 2 of 3 — clear the critique when any form input changes**

An objection about a $340 entry must not sit under a card that now says $326. `onSubmit` already clears `card` and `chart`, so a fresh read always remounts; this covers the case where the owner edits a field *without* re-reading.

React's `onChange` bubbles, so one handler on the `<form>` catches all six fields — no change to any `Field` call site.

Add the state next to the other `useState` calls in `AdvisorForm`:

```tsx
  // Bumped by any keystroke in the form. Used as AdvisorCritique's key, so an
  // edit unmounts a critique that was argued against numbers that no longer
  // match the card. React's onChange bubbles, so one handler covers every field.
  const [formEpoch, setFormEpoch] = useState(0);
```

Then change the form's opening tag from:

```tsx
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-3">
```

to:

```tsx
        <form
          onSubmit={onSubmit}
          onChange={() => setFormEpoch((n) => n + 1)}
          className="grid gap-4 sm:grid-cols-3"
        >
```

And pass it down — change:

```tsx
      {card ? <ResultCard card={card} chart={chart} onPickEntry={pickEntry} /> : null}
```

to:

```tsx
      {card ? (
        <ResultCard card={card} chart={chart} onPickEntry={pickEntry} critiqueKey={formEpoch} />
      ) : null}
```

- [ ] **Step 4: Edit 3 of 3 — mount the block above the no-edge claim**

Change `ResultCard`'s signature from:

```tsx
function ResultCard({
  card,
  chart,
  onPickEntry,
}: {
  card: AdvisorCard;
  chart: ChartBar[] | null;
  onPickEntry: (price: number, date: string) => void;
}) {
```

to:

```tsx
function ResultCard({
  card,
  chart,
  onPickEntry,
  critiqueKey,
}: {
  card: AdvisorCard;
  chart: ChartBar[] | null;
  onPickEntry: (price: number, date: string) => void;
  /** Changes on any form edit; remounting AdvisorCritique is how it clears. */
  critiqueKey: number;
}) {
```

Then, at the very end of `ResultCard`'s JSX, insert the block **immediately above** the no-edge claim paragraph — the claim stays last:

```tsx
      <AdvisorCritique key={critiqueKey} card={card} chart={chart} />

      <p className="text-xs text-(--color-muted) border-l-2 border-(--color-border) pl-4">{card.noEdgeClaim}</p>
```

- [ ] **Step 5: Typecheck and lint the touched files**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && npm run typecheck && npx eslint src/app/advisor/advisor-critique.tsx src/app/advisor/advisor-form.tsx
```

Expected: both clean. (Repo-wide `npm run lint` has a ~263-problem pre-existing baseline; scope the check to these two files.)

- [ ] **Step 6: Verify in the browser**

Using the Browser pane (`preview_start` with `nexmind-dev-web`; **never** a Bash dev server), open `http://localhost:3275/advisor`, read a ticker, and confirm:

1. The card renders with no AI call — check `read_network_requests` shows no `/api/advisor/critique` until the button is pressed.
2. `หาข้อโต้แย้ง` is present below the warnings block and above the no-edge claim.
3. Pressing it disables the button and shows `อาจใช้เวลา 10-40 วินาที`.
4. The result renders: objections with severity chips, or the zero-objection sentence.
5. Typing in any form field makes the critique block reset to just the button.
6. `read_console_messages` shows no errors.

Take a screenshot for the owner.

- [ ] **Step 7: Run the full suite**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && npm test
```

Expected: no new failures against the pre-existing baseline.

- [ ] **Step 8: Commit**

```bash
cd "C:/Users/Kannithi/CLAUDE WEB/nexmind" && git add src/app/advisor/advisor-critique.tsx src/app/advisor/advisor-form.tsx && git commit -m "$(cat <<'EOF'
feat(advisor): RAVEN's block on the card, behind a button

Never auto-runs: the wait is 10-40s behind a 3-way subprocess queue and
the card must render first. Zero objections renders as a sentence that
says so out loud, because blank space is the single most likely thing to
be misread as approval.

Stripped recommendations are shown with their count. costUsd prints as
"subscription", not "$0.00". Any form edit remounts the block, so an
objection about a $340 entry cannot sit under a card that says $326.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task |
|---|---|
| §1.1 inputs — card + chart, no new fetch | 1 (renderer signature), 4 (route passes both through) |
| §1.2 output contract, no `approved`/`score`/`side`/`confidence` | 1 (`CritiqueResult`), enforced by Global Constraints |
| §2 file table | File Structure; Ruling 3 moves the types into the pure module |
| §3 facts-sheet blocks head/risk/sizing/ladder/portfolio/regime/position-in-range/warnings, explicit `n/a` | 1 |
| §4 guard, exact vocabulary, visible stripping, negated forms | 2 |
| §5 `critiqueCard`, sonnet tier, CLI backend, never throws | 3 |
| §6 route, 400 on the five required card fields, `chart` may be null, no GET, nothing persisted | 4 |
| §7 UI — button, wait copy, zero-objection sentence, blind spots, stripped note, degraded inline, input clears | 5 |
| §8 testing — all five `critiqueContext` cases, both `advisorCritic` cases, no network | 1, 2, 3 |
| §9 out of scope — no persistence, no auto-run, nothing touched in HAWK/SAGE/research/gold | honoured throughout |

No gaps. Spec §5's "`aiOutageReason()` supplies the note when the backend is simply not configured" is Task 3's `degraded(aiOutageReason() ?? …)` line.

**2. Placeholder scan** — no TBD, no "add error handling", no "similar to Task N", no "write tests for the above". Every code step carries the code.

**3. Type consistency** — `renderCritiqueContext(card, chart)` and `guardObjections(objections) → { kept, stripped }` are spelled identically in Tasks 1-4. `critiqueCard(facts: string)` and `normalizeCritique(raw, meta)` match between Task 3's implementation and its tests. `CritiqueResult`'s seven fields are constructed in exactly two places (`normalizeCritique` and `degraded`) and consumed in one (`CritiqueBody`), with the same names in all three. `AdvisorCritique`'s props match its call site in Task 5 Step 4. `critiqueKey` is spelled the same in the state, the prop type and the `key`.
