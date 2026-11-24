# Fractional shares in /journal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** /journal accepts and stores fractional share counts.
**Architecture:** Schema Int→Float, input validation relaxed, display formatting.
**Tech Stack:** Prisma 7 + Neon HTTPS driver, node:test, Next.js 16.
**Spec:** `docs/superpowers/specs/2026-11-25-journal-fractional-shares-design.md`

## Global Constraints

- Port 5432 blocked: never `prisma db push`; apply SQL via the Neon HTTPS driver. No `prisma.$transaction`.
- The dev DB is the live DB: the only write is the ALTER COLUMN; no test rows.
- Stage files by path; never commit `obsidian-vault/`.

## Review Focus

1. "0", negative, "abc", "" for shares → rejected with a Thai/English error, never stored.
2. A value like "2.50" → 2.5 stored; "1e3" accepted as 1000 (finite number) — acceptable.

---

### Task 1: Accept fractional shares in parseOpenTrade

**Files:** Modify `src/lib/portfolio/journalInput.ts:44`; Test: `src/lib/portfolio/journalInput.test.ts` (create or extend)

- [ ] Step 1: failing tests — `parseOpenTrade({... shares: "2.5" ...})` ok with `shares === 2.5`; `shares: "0"` and `"-1"` and `"abc"` → `ok: false`.
- [ ] Step 2: run `npx tsx --test src/lib/portfolio/journalInput.test.ts` → FAIL on 2.5.
- [ ] Step 3: drop `integer: true` for shares; require `> 0`.
- [ ] Step 4: run → PASS. Commit.

### Task 2: Schema Int→Float, applied to Neon

**Files:** Modify `prisma/schema.prisma:355`

- [ ] Step 1: change `shares Int` → `shares Float`; `npx prisma migrate diff --from-schema <old copy> --to-schema prisma/schema.prisma --script` → Expected: one `ALTER COLUMN "shares" SET DATA TYPE DOUBLE PRECISION`.
- [ ] Step 2: apply that one statement via `@neondatabase/serverless` HTTPS; verify with `information_schema.columns` → `double precision`.
- [ ] Step 3: `npx prisma generate`, `npx tsc --noEmit` clean. Commit.

### Task 3: Display + browser check

**Files:** `src/app/journal/journal-panel.tsx`, `src/app/journal/hedge-section.tsx`

- [ ] Step 1: render shares with `fmtNumber(shares, 4)`.
- [ ] Step 2: `npm test`, `tsc`, eslint clean; preview `/journal` loads with no console errors. Commit.
