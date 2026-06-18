# MEMO Lessons Learned Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Reports page "🧠 Lessons learned" section actually populate — MEMO distills a one-sentence lesson from every losing paper trade (going forward + backfilled for the 37 existing losses).

**Architecture:** New `src/lib/trading/memo.ts` mirrors the existing `sage.ts` agent pattern (real Claude via `callAgentJSON`, or a deterministic `mockLesson` when `aiEnabled()` is false). `manage.ts` calls it when a trade closes as a loss and writes to the `Lesson` table via a new `tradeId @unique` constraint (idempotent via Prisma's `P2002` duplicate-key error). A one-time `scripts/backfill-lessons.ts` does the same for already-closed losses.

**Tech Stack:** Next.js 16 / TypeScript / Prisma 7 (SQLite, better-sqlite3 adapter) / `node:test` / `tsx`.

Spec: `docs/superpowers/specs/2026-06-13-memo-lessons-design.md`

---

### Task 1: Schema — make `Lesson.tradeId` unique

**Files:**
- Modify: `prisma/schema.prisma:112-118`

- [ ] **Step 1: Edit the `Lesson` model**

Current (lines 112-118):

```prisma
model Lesson {
  id        Int      @id @default(autoincrement())
  tradeId   Int?
  text      String
  tags      String   @default("[]")
  createdAt DateTime @default(now())
}
```

Change `tradeId   Int?` to:

```prisma
model Lesson {
  id        Int      @id @default(autoincrement())
  tradeId   Int?     @unique
  text      String
  tags      String   @default("[]")
  createdAt DateTime @default(now())
}
```

- [ ] **Step 2: Push the schema change and regenerate the client**

Run: `npm run db:push -- --url "file:./dev.db"`
Expected: prompt-free success message ending with "Your database is now in
sync with your Prisma schema" (or "already in sync" if it had already been
applied) and a "Generated Prisma Client" line. The `Lesson` table currently
has 0 rows, so no duplicate-`NULL` conflicts are possible.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: make Lesson.tradeId unique for MEMO idempotency"
```

(The regenerated `src/generated/prisma/**` is typically gitignored — check
`git status`; if tracked, add it too.)

---

### Task 2: `src/lib/trading/memo.ts` — MEMO agent (TDD)

**Files:**
- Create: `src/lib/trading/memo.ts`
- Create: `src/lib/trading/memo.test.ts`

This task follows TDD: write the test first against a module that doesn't
exist yet (fails), then implement the module (passes). The test only covers
`mockLesson` — it's a pure function. `generateLesson`'s AI branch is **not**
unit-tested here: on this machine `aiEnabled()` returns `true` (Claude Code
CLI is installed), so calling `generateLesson` in a test would shell out to
the real CLI (slow, subscription-dependent). That's exercised live via Task 6
(backfill run), not in `npm test`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/trading/memo.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mockLesson } from "./memo";
import type { Trade } from "@/generated/prisma/client";

const trade = { symbol: "BTC-USD", side: "short" } as unknown as Trade;

test("mockLesson is deterministic and identifiable as a mock", () => {
  const result = mockLesson(trade, { outcome: "loss", exit: 64000, pnl: -120, rMultiple: -1.2 });
  assert.match(result.text, /BTC-USD/);
  assert.match(result.text, /short/);
  assert.match(result.text, /\(mock\)/);
  assert.equal(result.costUsd, 0);
});

test("mockLesson includes the R multiple when known", () => {
  const result = mockLesson(trade, { outcome: "loss", exit: 64000, pnl: -120, rMultiple: -1.2 });
  assert.match(result.text, /-1\.20/);
});

test("mockLesson omits R detail when unknown", () => {
  const result = mockLesson(trade, { outcome: "loss", exit: null, pnl: null, rMultiple: null });
  assert.doesNotMatch(result.text, /\(R /);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test src/lib/trading/memo.test.ts`
Expected: FAIL — `Cannot find module './memo'` (or similar module-not-found
error), since `memo.ts` doesn't exist yet.

- [ ] **Step 3: Implement `src/lib/trading/memo.ts`**

```ts
// MEMO — the memory keeper. After a losing paper trade, distills a short,
// actionable lesson that future HAWK/SAGE prompts will see via
// engine.ts's latestLessons().

import { callAgentJSON, aiEnabled } from "@/lib/anthropic";
import type { Trade } from "@/generated/prisma/client";

export interface LessonInput {
  outcome: "loss";
  exit: number | null; // null = unknown (e.g. backfill couldn't recover it)
  pnl: number | null;
  rMultiple: number | null;
}

export interface LessonResult {
  text: string;
  costUsd: number;
}

const LESSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    lesson: { type: "string" },
  },
  required: ["lesson"],
};

const SYSTEM =
  "You are MEMO, the memory keeper for a trading desk. After a losing paper trade, " +
  "distill ONE actionable, specific sentence a future analyst should keep in mind. " +
  "Respond with strict JSON matching the schema only — no conversational filler, no " +
  "introductory text (e.g. 'Here is the lesson:'), no markdown code fences. The `lesson` " +
  "field must be a single, concise, actionable sentence (max ~200 chars) grounded in the " +
  "numbers given — do not invent prices or outcomes not present in the input.";

/** Distill a lesson from a losing trade. Falls back to a deterministic mock when no AI backend is available. */
export async function generateLesson(trade: Trade, close: LessonInput): Promise<LessonResult> {
  if (!aiEnabled()) return mockLesson(trade, close);

  const r = await callAgentJSON<{ lesson: string }>({
    tier: "haiku",
    system: SYSTEM,
    prompt: buildPrompt(trade, close),
    maxTokens: 200,
    jsonSchema: LESSON_SCHEMA,
  });

  return { text: r.data.lesson, costUsd: r.costUsd };
}

function buildPrompt(trade: Trade, close: LessonInput): string {
  const votes = summarizeHawkVotes(trade.hawkVotes);
  const log = summarizeDecisionLog(trade.decisionLog);
  return [
    `${trade.side.toUpperCase()} ${trade.symbol}: entry ${trade.entry.toFixed(4)}, SL ${trade.sl.toFixed(4)}, ` +
      `TP1 ${trade.tp1.toFixed(4)}${trade.tp2 != null ? `, TP2 ${trade.tp2.toFixed(4)}` : ""}.`,
    `Outcome: loss. Exit price: ${close.exit != null ? close.exit.toFixed(4) : "unknown"}.`,
    `P/L: ${close.pnl != null ? close.pnl.toFixed(2) : "unknown"}. R multiple: ${close.rMultiple != null ? close.rMultiple.toFixed(2) : "unknown"}.`,
    votes ? `Analyst votes: ${votes}` : "",
    trade.sageVerdict ? `Risk verdict: ${trade.sageVerdict}` : "",
    log ? `Decision log: ${log}` : "",
    "What should a future analyst learn from this loss?",
  ]
    .filter(Boolean)
    .join("\n");
}

function summarizeHawkVotes(raw: string): string {
  try {
    const votes = JSON.parse(raw) as { persona: string; vote: string; reason: string }[];
    if (!Array.isArray(votes) || votes.length === 0) return "";
    return votes.map((v) => `${v.persona}=${v.vote} (${v.reason})`).join("; ");
  } catch {
    return "";
  }
}

function summarizeDecisionLog(raw: string): string {
  try {
    const log = JSON.parse(raw) as { stage: string; note: string }[];
    if (!Array.isArray(log) || log.length === 0) return "";
    return log.slice(-6).map((e) => `${e.stage}: ${e.note}`).join("; ");
  } catch {
    return "";
  }
}

/** Deterministic lesson used when no AI backend is available (matches mockHawk/mockSage's "(mock)" convention). */
export function mockLesson(trade: Trade, close: LessonInput): LessonResult {
  const detail = close.rMultiple != null ? ` (R ${close.rMultiple.toFixed(2)})` : "";
  return {
    text: `Loss on ${trade.symbol} ${trade.side}${detail}: re-examine entry timing vs SL placement (mock).`,
    costUsd: 0,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test src/lib/trading/memo.test.ts`
Expected: PASS, 3/3 tests.

- [ ] **Step 5: Run the full suite to confirm nothing else broke**

Run: `npm test`
Expected: PASS, 29 tests (26 existing + 3 new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/trading/memo.ts src/lib/trading/memo.test.ts
git commit -m "feat: add MEMO lesson generator (memo.ts)"
```

---

### Task 3: `manage.ts` — record a lesson on every loss

**Files:**
- Modify: `src/lib/trading/manage.ts`

- [ ] **Step 1: Add imports**

In `src/lib/trading/manage.ts`, the current imports are:

```ts
import { prisma } from "@/lib/db";
import { fetchYahooCandles } from "@/lib/yahoo";
import { decideAction, type LadderState } from "./positionRules";
```

Add two more imports below them:

```ts
import { prisma } from "@/lib/db";
import { fetchYahooCandles } from "@/lib/yahoo";
import { decideAction, type LadderState } from "./positionRules";
import { generateLesson, type LessonInput } from "./memo";
import { Prisma, type Trade } from "@/generated/prisma/client";
```

- [ ] **Step 2: Call `recordLesson` after a loss closes**

Find the full-close block (currently ends with `closed.push(...)`):

```ts
    await prisma.trade.update({
      where: { id: t.id },
      data: {
        status: "closed",
        outcome: action.outcome,
        pnl,
        rMultiple,
        closedAt: new Date(),
        decisionLog: JSON.stringify(log),
        stagedTp: JSON.stringify(ladder),
      },
    });
    closed.push({ id: t.id, symbol: t.symbol, outcome: action.outcome, exit: action.exit, price: cur, pnl });
  }
```

Change it to (adding the `if` block before the closing `}`):

```ts
    await prisma.trade.update({
      where: { id: t.id },
      data: {
        status: "closed",
        outcome: action.outcome,
        pnl,
        rMultiple,
        closedAt: new Date(),
        decisionLog: JSON.stringify(log),
        stagedTp: JSON.stringify(ladder),
      },
    });
    closed.push({ id: t.id, symbol: t.symbol, outcome: action.outcome, exit: action.exit, price: cur, pnl });

    if (action.outcome === "loss") {
      await recordLesson(t, { outcome: "loss", exit: action.exit, pnl, rMultiple });
    }
  }
```

- [ ] **Step 3: Add the `recordLesson` helper**

Add this new function next to `safeParse` at the bottom of the file (after
`manageOpenTrades`'s closing brace):

```ts
/** MEMO distills a lesson for a loss. Lesson.tradeId is unique, so a P2002 just means it's already recorded. */
async function recordLesson(trade: Trade, close: LessonInput): Promise<void> {
  try {
    const { text } = await generateLesson(trade, close);
    await prisma.lesson.create({ data: { tradeId: trade.id, text } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return;
    console.error(`MEMO: failed to record lesson for trade ${trade.id}`, e);
  }
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors related to `manage.ts` or `memo.ts`. (Pre-existing
unrelated errors, if any, are out of scope — but there shouldn't be any on a
clean tree.)

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS, 29 tests (unchanged from Task 2 — `manage.ts` has no direct
unit tests, it's exercised live).

- [ ] **Step 6: Commit**

```bash
git add src/lib/trading/manage.ts
git commit -m "feat: record a MEMO lesson when a paper trade closes as a loss"
```

---

### Task 4: Backfill script for the 37 existing losses

**Files:**
- Create: `scripts/backfill-lessons.ts`
- Modify: `package.json`

- [ ] **Step 1: Create `scripts/backfill-lessons.ts`**

```ts
// One-time (re-runnable) backfill: MEMO distills a lesson for every closed
// losing trade that doesn't have one yet. Lesson.tradeId is unique — a
// P2002 on create means this trade already has a lesson; skip it.
//
// Usage: npm run backfill-lessons

import "dotenv/config";
import { prisma } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { generateLesson, type LessonInput } from "../src/lib/trading/memo";

// Recovers the exit price from manage.ts's close note, e.g.
// "loss — exit 64000.0000 (price 63990.0000)".
const EXIT_RE = /exit (-?\d+(?:\.\d+)?)/;

function recoverExit(decisionLog: string): number | null {
  try {
    const log = JSON.parse(decisionLog) as { stage: string; note: string }[];
    const manageEntry = [...log].reverse().find((e) => e.stage === "manage");
    if (!manageEntry) return null;
    const m = manageEntry.note.match(EXIT_RE);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

async function main() {
  const trades = await prisma.trade.findMany({ where: { status: "closed", outcome: "loss" } });
  let created = 0;
  let skipped = 0;

  for (const trade of trades) {
    const close: LessonInput = {
      outcome: "loss",
      exit: recoverExit(trade.decisionLog),
      pnl: trade.pnl,
      rMultiple: trade.rMultiple,
    };

    try {
      const { text } = await generateLesson(trade, close);
      await prisma.lesson.create({ data: { tradeId: trade.id, text } });
      console.log(`${trade.symbol} (#${trade.id}) — ${text}`);
      created++;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        skipped++;
        continue;
      }
      throw e;
    }
  }

  console.log(`\nDone. ${created} lesson(s) created, ${skipped} already had one.`);
}

main().finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Add the npm script**

In `package.json`, the `scripts` block currently ends:

```json
    "bot": "tsx scripts/bot.ts",
    "test": "tsx --test \"src/**/*.test.ts\"",
    "backtest": "tsx scripts/backtest.ts"
```

Add `backfill-lessons` after `backtest`:

```json
    "bot": "tsx scripts/bot.ts",
    "test": "tsx --test \"src/**/*.test.ts\"",
    "backtest": "tsx scripts/backtest.ts",
    "backfill-lessons": "tsx scripts/backfill-lessons.ts"
```

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-lessons.ts package.json
git commit -m "feat: add MEMO lessons backfill script"
```

---

### Task 5: Run the backfill and verify the Reports page

**Files:** none (operational task)

- [ ] **Step 1: Run the backfill**

Run: `npm run backfill-lessons`
Expected: one line per losing trade (`SYMBOL (#id) — lesson text`), ending
with `Done. 37 lesson(s) created, 0 already had one.` (counts may differ
slightly if more trades have closed since the spec was written — that's
fine). Since `aiEnabled()` is true on this machine (Claude Code CLI), these
are real MEMO calls — allow it a few minutes (haiku via CLI, `CLI_CONCURRENCY`
caps it at 3 concurrent, but this script runs sequentially).

If any line ends with `(mock)`, the CLI wasn't detected for that call —
check `claude --version` works in this shell; it doesn't block the backfill
(mock lessons are still valid rows), but real ones are preferred.

- [ ] **Step 2: Re-run to confirm idempotency**

Run: `npm run backfill-lessons`
Expected: `Done. 0 lesson(s) created, 37 already had one.` (all skipped via
`P2002`).

- [ ] **Step 3: Verify in the app**

Start the dev server if not running: `npm run dev` (port 3275).
Open `http://localhost:3275/reports` and confirm the "🧠 Lessons learned
(from losing trades)" section now shows up to 12 entries instead of the
"No lessons yet" empty state.

- [ ] **Step 4: No commit needed**

This task only writes rows to `dev.db` (not tracked by git) — nothing to
commit. Confirm `git status` is clean.

---

### Task 6: Final review

**Files:** none

- [ ] **Step 1: Run the full test suite one more time**

Run: `npm test`
Expected: PASS, 29 tests.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: no new errors/warnings in `src/lib/trading/memo.ts`,
`src/lib/trading/manage.ts`, or `scripts/backfill-lessons.ts`.

- [ ] **Step 3: Confirm git status is clean**

Run: `git status`
Expected: working tree clean (everything from Tasks 1-4 committed; Task 5
only touched the untracked `dev.db`).
