# MEMO Lessons Learned — Design Spec

Date: 2026-06-13
Status: approved by user (chat), implementing

## Goal

The Reports page has a "🧠 Lessons learned (from losing trades)" section
([reports/page.tsx:97](../../../src/app/reports/page.tsx)) that reads from the
`Lesson` Prisma model. The model exists and `engine.ts` already reads
`latestLessons()` to feed SAGE, but **nothing ever writes to it** — MEMO is
registered in the agent roster but has no implementation. Result: the section
is permanently empty even though 37 of 51 closed paper trades are losses.

This spec adds the missing write path: MEMO distills a one-sentence lesson
from each losing trade, going forward and via a one-time backfill for the
existing 37 losses.

Out of scope: tags field on `Lesson` (stays default `"[]"`), UI changes to
`reports/page.tsx` (already renders `l.text`), schema changes (model is
already complete).

## 1. `src/lib/trading/memo.ts` (new)

Mirrors the `sage.ts` pattern (`runSage` / `mockSage`):

```ts
export interface LessonResult {
  text: string;
  costUsd: number;
}

export async function generateLesson(trade: Trade, close: CloseResult): Promise<LessonResult>
function mockLesson(trade: Trade, close: CloseResult): LessonResult
```

- `generateLesson`: if `aiEnabled()`, call `callAgentJSON({ tier: "haiku", ... })`
  with a system prompt establishing MEMO's role ("distill ONE actionable,
  specific sentence from this losing trade that a future analyst should keep
  in mind"), JSON schema `{ lesson: string }` (required). Else call
  `mockLesson`.
- Prompt context assembled from the trade + close result: symbol, side,
  entry/sl/tp1/tp2, exit price, pnl, rMultiple, outcome, plus a short summary
  of `hawkVotes` (parsed JSON, persona+vote+reason) and `sageVerdict` if
  present. `decisionLog` entries included as a compact list (stage: note).
- `mockLesson` returns a deterministic sentence, e.g.
  `` `Loss on ${trade.symbol} ${trade.side}: re-examine entry timing vs SL placement (mock).` ``
  — same "(mock)" convention as `mockHawk`/`mockSage` so it's identifiable.
- Truncate/limit prompt inputs (e.g. last 6 decisionLog entries) to keep the
  haiku call cheap.

## 2. `manage.ts` — write on close

After the existing full-close `prisma.trade.update(...)` call for
`action.outcome === "loss"` succeeds, call a new helper:

```ts
async function recordLesson(trade: Trade, close: CloseResult): Promise<void>
```

- Skip if `close.outcome !== "loss"`.
- Skip if a `Lesson` with this `tradeId` already exists
  (`prisma.lesson.findFirst({ where: { tradeId } })`) — idempotency guard,
  shared with the backfill script.
- Otherwise: `generateLesson(...)` then `prisma.lesson.create({ data: { tradeId: trade.id, text } })`.
- Wrapped in try/catch — a MEMO failure is logged (console.error) and does
  not interrupt `manageOpenTrades`'s loop over other positions.

## 3. Backfill script `scripts/backfill-lessons.ts`

One-time (re-runnable) script:

- `prisma.trade.findMany({ where: { status: "closed", outcome: "loss" } })`.
- For each trade, skip if a `Lesson` with that `tradeId` already exists
  (same guard as §2).
- Reconstruct a `CloseResult`-shaped object from the trade's stored fields
  (`pnl`, `rMultiple`, exit price isn't stored separately — derive from the
  last `decisionLog` "manage" entry's note, or fall back to `tp1`/`sl`
  depending on outcome — good enough for lesson context, doesn't need to be
  exact).
- Call `generateLesson` + `prisma.lesson.create`, sequentially (haiku via CLI
  is cheap; `callAgent`'s CLI semaphore caps concurrency anyway).
- Log progress (`symbol — lesson text`) per trade and a final count.
- Add `"backfill-lessons": "tsx scripts/backfill-lessons.ts"` to
  `package.json` scripts. Run once now for the 37 existing losses.

## 4. Tests

Add `src/lib/trading/memo.test.ts` (node:test, mirrors `positionRules.test.ts`
style):

- `mockLesson` returns non-empty text containing the symbol and "(mock)".
- `generateLesson` falls back to `mockLesson` when `aiEnabled()` is false
  (no API key / no CLI in test env — this is the default test environment).

`npm test` must stay green (currently 26 tests; this adds a couple more).

## Data flow recap

```
manage.ts: trade closes as "loss"
  -> recordLesson(trade, close)
     -> generateLesson (MEMO, haiku, or mock)
     -> prisma.lesson.create({ tradeId, text })

reports/page.tsx: prisma.lesson.findMany(take 12, desc)  [already wired]
engine.ts: latestLessons() -> SAGE prompt                [already wired]
```
