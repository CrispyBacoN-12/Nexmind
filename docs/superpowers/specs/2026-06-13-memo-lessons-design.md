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
`reports/page.tsx` (already renders `l.text`).

## 0. Schema change — `Lesson.tradeId` becomes unique

```prisma
model Lesson {
  id        Int      @id @default(autoincrement())
  tradeId   Int?     @unique
  text      String
  tags      String   @default("[]")
  createdAt DateTime @default(now())
}
```

SQLite allows multiple `NULL`s under a unique constraint, so this only
constrains rows that *do* have a `tradeId` (every row written by this
feature). This lets §2/§3 rely on the database for idempotency instead of a
`findFirst` read-then-write (see below). Run `npm run db:push -- --url
"file:./dev.db"` after the schema edit.

## 1. `src/lib/trading/memo.ts` (new)

Mirrors the `sage.ts` pattern (`runSage` / `mockSage`):

```ts
export interface LessonInput {
  outcome: "loss";
  exit: number | null; // null = unknown (backfill couldn't recover it)
  pnl: number | null;
  rMultiple: number | null;
}

export interface LessonResult {
  text: string;
  costUsd: number;
}

export async function generateLesson(trade: Trade, close: LessonInput): Promise<LessonResult>
function mockLesson(trade: Trade, close: LessonInput): LessonResult
```

(`manage.ts`'s live `CloseResult` already has `exit`/`pnl` as numbers and
satisfies `LessonInput`; the backfill script builds a `LessonInput` directly
from stored `Trade` fields per §3.)

- `generateLesson`: if `aiEnabled()`, call `callAgentJSON({ tier: "haiku", ... })`
  with JSON schema `{ lesson: string }` (required). Else call `mockLesson`.
- **System prompt** establishes MEMO's role ("distill ONE actionable, specific
  sentence from this losing trade that a future analyst should keep in
  mind") *and* an explicit strict-output constraint, to counter Haiku's
  tendency to add conversational filler or break JSON formatting:
  > "Respond with strict JSON matching the schema only — no conversational
  > filler, no introductory text (e.g. 'Here is the lesson:'), no markdown
  > code fences. The `lesson` field must be a single, concise, actionable
  > sentence (max ~200 chars) grounded in the numbers given — do not invent
  > prices or outcomes not present in the input."
- Prompt context assembled from the trade + `LessonInput`: symbol, side,
  entry/sl/tp1/tp2, outcome, **pnl and rMultiple (always real numbers — the
  primary analysis signal)**, and exit price rendered as
  `Exit price: ${exit.toFixed(4)}` or literally `Exit price: unknown` when
  `exit === null`. Plus a short summary of `hawkVotes` (parsed JSON,
  persona+vote+reason) and `sageVerdict` if present. `decisionLog` entries
  included as a compact list (stage: note), capped to the last 6 to keep the
  haiku call cheap.
- `mockLesson` returns a deterministic sentence, e.g.
  `` `Loss on ${trade.symbol} ${trade.side}: re-examine entry timing vs SL placement (mock).` ``
  — same "(mock)" convention as `mockHawk`/`mockSage` so it's identifiable.

## 2. `manage.ts` — write on close

After the existing full-close `prisma.trade.update(...)` call for
`action.outcome === "loss"` succeeds, call a new helper:

```ts
async function recordLesson(trade: Trade, close: CloseResult): Promise<void>
```

(`CloseResult` already has `exit`/`pnl`/`outcome` and structurally satisfies
`LessonInput` from §1 — `rMultiple` is read off the freshly-updated `trade`
record instead.)

- Skip if `close.outcome !== "loss"`.
- Otherwise: `generateLesson(...)` then `prisma.lesson.create({ data: { tradeId: trade.id, text } })`.
- The whole thing wrapped in one try/catch. A MEMO failure (AI error) *or* a
  duplicate-lesson collision is caught, logged (console.error/info), and does
  not interrupt `manageOpenTrades`'s loop over other positions. Idempotency
  relies on the `Lesson.tradeId @unique` constraint from §0: a duplicate
  `create` throws `PrismaClientKnownRequestError` with `code === "P2002"`,
  which is caught and treated as "already recorded, nothing to do" (not
  logged as an error). This avoids a `findFirst` round-trip before every
  write.

## 3. Backfill script `scripts/backfill-lessons.ts`

One-time (re-runnable) script:

- `prisma.trade.findMany({ where: { status: "closed", outcome: "loss" } })`.
- Reconstruct a `CloseResult`-shaped object from the trade's stored fields.
  `pnl` and `rMultiple` are stored directly on `Trade` and are **real,
  trustworthy numbers** — these are the primary signal for MEMO's analysis.
  Exit price is *not* stored separately; attempt to recover it via regex from
  the last `decisionLog` entry with `stage === "manage"` (format:
  `` `${outcome} — exit ${exit} (price ${cur})...` `` from `manage.ts:102`).
  If that entry is missing or doesn't match, **do not guess** from `tp1`/`sl`
  — pass `exit: null` through, and have the prompt builder (§1) render it as
  `Exit price: unknown` rather than fabricating a number. The prompt always
  includes the real `pnl`/`rMultiple` regardless, so MEMO has solid ground
  truth even when exit price is unknown.
- Call `generateLesson` + `prisma.lesson.create`, sequentially (haiku via CLI
  is cheap; `callAgent`'s CLI semaphore caps concurrency anyway). Each
  `create` is wrapped the same try/catch as §2 — a `P2002` means this trade
  already has a lesson (e.g. re-running the script), skip and continue.
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
