# Multi-Portfolio Foundation (Phase 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make NEXMIND run several independent paper portfolios at once — each with its own balance, risk settings, watchlist, and kill switch — plus a manual global trading halt and an active/archived portfolio status, with a lean switcher + overview UI.

**Architecture:** A new `Portfolio` row owns the risk config that is currently global. `Trade`/`Signal`/`Watchlist` gain a required `portfolioId`. The trading core (engine, manage, circuitBreaker) takes a `portfolioId` and scopes every query and kill-switch/drawdown decision to it. Two global guards sit above per-portfolio risk: a manual `globalTradingHalt` flag and an enforced `archived` status. All portfolios share the existing swing engine — they differ only by config and watchlist.

**Tech Stack:** TypeScript, Next.js 16 (App Router), Prisma 7 + SQLite (better-sqlite3 adapter), `node:test` + `node:assert/strict` (run via `npm test` = `tsx --test "src/**/*.test.ts"`). DB commands: `npm run db:push`, `npm run db:seed`. Tests in this repo are pure (no DB); DB-touching tasks are verified with `npx tsc --noEmit`, `npm run db:push`, a backfill script run, and a curl smoke check.

---

## File Structure

- **Create** `src/lib/trading/portfolioStats.ts` (+ test) — pure stats aggregation per portfolio.
- **Modify** `src/lib/trading/ironRules.ts` (+ existing test) — add `globalTradingHalt` gate.
- **Create** `src/lib/portfolioGuards.ts` (+ test) — pure `canPortfolioTrade(status)`.
- **Modify** `prisma/schema.prisma` — add `Portfolio`; add `portfolioId` to `Trade`/`Signal`/`Watchlist`.
- **Create** `scripts/backfill-portfolios.ts` — one-time backfill of existing rows + global settings → Default portfolio.
- **Modify** `prisma/seed.ts` — create Default portfolio, attach seeded trades/watchlist.
- **Modify** `src/lib/settings.ts` — per-portfolio getters read the `Portfolio` row; add `isGlobalTradingHalt`.
- **Modify** `src/lib/trading/circuitBreaker.ts` — `getCurrentDrawdownPct(portfolioId)`.
- **Modify** `src/lib/trading/manage.ts` — `manageOpenTrades(portfolioId)`.
- **Modify** `src/lib/trading/engine.ts` — `runTradeTick(symbol, portfolioId, opts)`, global-halt + per-portfolio scoping.
- **Modify** `src/lib/trading/watchlist.ts` — `getWatchlist(portfolioId)`.
- **Create** `src/app/api/portfolios/route.ts` — GET list+stats, POST create.
- **Create** `src/app/api/portfolios/[id]/route.ts` — PATCH settings/killSwitch/status.
- **Modify** `src/app/api/trade-tick/route.ts`, `src/app/api/scan-all/route.ts`, `src/app/api/manage/route.ts` — accept `portfolioId`.
- **Modify** `src/app/api/settings/route.ts` — slim to global (fearGreed + globalTradingHalt).
- **Modify** `src/app/command/safety-panel.tsx` + War Room `src/app/page.tsx` — switcher, overview strip, global halt, new-portfolio form.

---

## Task 1: Pure portfolio-stats helper

**Files:**
- Create: `src/lib/trading/portfolioStats.ts`
- Test: `src/lib/trading/portfolioStats.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/trading/portfolioStats.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computePortfolioStats, type PortfolioTrade } from "./portfolioStats";

function t(status: string, pnl: number | null, day: string | null): PortfolioTrade {
  return { status, pnl, rMultiple: null, outcome: null, closedAt: day ? new Date(day) : null };
}

test("computePortfolioStats: empty portfolio sits at starting balance", () => {
  const s = computePortfolioStats([], 10000);
  assert.equal(s.equity, 10000);
  assert.equal(s.realizedPnl, 0);
  assert.equal(s.openCount, 0);
  assert.equal(s.currentDrawdownPct, 0);
});

test("computePortfolioStats: realized P/L and equity from closed trades; open trades counted", () => {
  const trades = [t("closed", 100, "2026-06-01"), t("closed", -40, "2026-06-02"), t("open", null, null)];
  const s = computePortfolioStats(trades, 10000);
  assert.equal(s.realizedPnl, 60);
  assert.equal(s.equity, 10060);
  assert.equal(s.openCount, 1);
});

test("computePortfolioStats: drawdown reflects peak-to-current on closed trades", () => {
  // equity path 10000 -> 10200 (peak) -> 10100: drawdown = 100/10200 ≈ 0.98%
  const trades = [t("closed", 200, "2026-06-01"), t("closed", -100, "2026-06-02")];
  const s = computePortfolioStats(trades, 10000);
  assert.ok(Math.abs(s.currentDrawdownPct - (100 / 10200) * 100) < 1e-9);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/trading/portfolioStats.test.ts`
Expected: FAIL — `Cannot find module './portfolioStats'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/trading/portfolioStats.ts
// Pure per-portfolio aggregation over a portfolio's trades. No DB access — the
// caller supplies the trade rows and the portfolio's starting balance.

import { currentDrawdownPct } from "./circuitBreaker";
import type { ClosedTrade } from "./stats";

export interface PortfolioTrade {
  status: string;
  pnl: number | null;
  rMultiple: number | null;
  outcome: string | null;
  closedAt: Date | null;
}

export interface PortfolioStats {
  equity: number;        // startingBalance + realized P/L
  realizedPnl: number;   // sum of closed-trade pnl
  openCount: number;     // number of open trades
  currentDrawdownPct: number; // non-negative % below the all-time equity peak
}

export function computePortfolioStats(trades: PortfolioTrade[], startingBalance: number): PortfolioStats {
  const closed = trades.filter((t) => t.status === "closed");
  const realizedPnl = closed.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const openCount = trades.filter((t) => t.status === "open").length;
  const closedForDd: ClosedTrade[] = closed.map((t) => ({
    pnl: t.pnl ?? 0, rMultiple: t.rMultiple, outcome: t.outcome, closedAt: t.closedAt,
  }));
  return {
    equity: startingBalance + realizedPnl,
    realizedPnl,
    openCount,
    currentDrawdownPct: currentDrawdownPct(closedForDd, startingBalance),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/trading/portfolioStats.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit` (expect clean), then:
```bash
git add src/lib/trading/portfolioStats.ts src/lib/trading/portfolioStats.test.ts
git commit -m "feat: add pure per-portfolio stats helper"
```

---

## Task 2: Iron Rules global trading halt

**Files:**
- Modify: `src/lib/trading/ironRules.ts`
- Test: `src/lib/trading/ironRules.test.ts` (existing file — append)

- [ ] **Step 1: Write the failing test**

Append to `src/lib/trading/ironRules.test.ts`:

```ts
test("applyIronRules: global trading halt blocks every new trade", () => {
  const t = { symbol: "AAPL", side: "long" as const, entry: 100, sl: 98, tp1: 106, lot: 0.1 };
  const acc = {
    dailyLossUsd: 0, dailyLossCapUsd: 200, maxLotPerTrade: 0.2,
    minRiskReward: 1.5, pipValueUsdPerLot: 1, globalTradingHalt: true,
  };
  const v = applyIronRules(t, acc);
  assert.equal(v.passed, false);
  assert.ok(v.failures.some((f) => /global trading halt/i.test(f)));
});
```

(If the existing test file does not already import `applyIronRules`/`assert`/`test`, reuse the imports already at the top of that file — do not duplicate them.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/trading/ironRules.test.ts`
Expected: FAIL — the new trade passes because `globalTradingHalt` is not yet checked (no failure containing "global trading halt").

- [ ] **Step 3: Implement the gate**

In `src/lib/trading/ironRules.ts`, add the field to `AccountState` (after the `killSwitch` line, around line 21):

```ts
  killSwitch?: boolean; // per-portfolio halt — blocks every new trade
  globalTradingHalt?: boolean; // manual global emergency brake — blocks all portfolios
```

And add the check at the very top of `applyIronRules`'s body, immediately before the existing `if (acc.killSwitch)` line:

```ts
  if (acc.globalTradingHalt) failures.push("global trading halt engaged — all trading stopped");
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/trading/ironRules.test.ts`
Expected: PASS (all existing tests + the new one).

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit` (expect clean), then:
```bash
git add src/lib/trading/ironRules.ts src/lib/trading/ironRules.test.ts
git commit -m "feat: add global trading halt gate to Iron Rules"
```

---

## Task 3: Pure portfolio-tradeable guard

**Files:**
- Create: `src/lib/portfolioGuards.ts`
- Test: `src/lib/portfolioGuards.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/portfolioGuards.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { canPortfolioTrade } from "./portfolioGuards";

test("canPortfolioTrade: archived portfolios cannot trade", () => {
  assert.equal(canPortfolioTrade("active"), true);
  assert.equal(canPortfolioTrade("archived"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/portfolioGuards.test.ts`
Expected: FAIL — `Cannot find module './portfolioGuards'`.

- [ ] **Step 3: Implement**

```ts
// src/lib/portfolioGuards.ts
// Pure predicates about a portfolio's lifecycle status.

/** Archived portfolios are skipped by scan/tick; active ones may trade. */
export function canPortfolioTrade(status: string): boolean {
  return status !== "archived";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/portfolioGuards.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit` (expect clean), then:
```bash
git add src/lib/portfolioGuards.ts src/lib/portfolioGuards.test.ts
git commit -m "feat: add canPortfolioTrade guard"
```

---

## Task 4: Schema, backfill, and seed

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `scripts/backfill-portfolios.ts`
- Modify: `prisma/seed.ts`

This task changes the database. It is verified by `db push`, the backfill run, and `db studio`/query rather than `npm test`.

- [ ] **Step 1: Add the `Portfolio` model and NULLABLE foreign keys**

In `prisma/schema.prisma`, add the new model (place it just above `model Trade`):

```prisma
/// One isolated paper portfolio: its own balance, risk config, and kill switch.
model Portfolio {
  id               Int         @id @default(autoincrement())
  name             String
  kind             String      @default("swing")  // strategy label only in Phase 0
  status           String      @default("active")  // active | archived (enforced)
  startingBalance  Float       @default(10000)
  riskPctPerTrade  Float       @default(1)
  maxOpenPositions Int         @default(5)
  drawdownHaltPct  Float       @default(10)
  killSwitch       Boolean     @default(false)
  killSwitchReason String      @default("")
  sort             Int         @default(0)
  createdAt        DateTime    @default(now())
  trades           Trade[]
  signals          Signal[]
  watchlist        Watchlist[]
}
```

On `model Trade`, add (after the `id` line):
```prisma
  portfolio       Portfolio? @relation(fields: [portfolioId], references: [id])
  portfolioId     Int?
```

On `model Signal`, add (after the `id` line):
```prisma
  portfolio  Portfolio? @relation(fields: [portfolioId], references: [id])
  portfolioId Int?
```

On `model Watchlist`, add (after the `id` line) and change the uniqueness — remove `@unique` from the `symbol` field and add a compound unique:
```prisma
  portfolio  Portfolio? @relation(fields: [portfolioId], references: [id])
  portfolioId Int?
```
Change `symbol    String   @unique` to `symbol    String` and add at the end of the model block:
```prisma
  @@unique([portfolioId, symbol])
```

- [ ] **Step 2: Push the nullable schema and regenerate the client**

Run: `npm run db:push` then `npm run db:generate`
Expected: schema syncs; Prisma client regenerates with the new `portfolio` model and nullable `portfolioId` fields.

- [ ] **Step 3: Write the backfill script**

```ts
// scripts/backfill-portfolios.ts
// One-time: create a Default portfolio from the current global Setting values,
// then attach every existing Trade/Signal/Watchlist row to it. Idempotent.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" });
const prisma = new PrismaClient({ adapter });

async function getSetting(key: string, fallback: string): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? fallback;
}

async function main() {
  // Reuse an existing Default portfolio if this script already ran.
  let def = await prisma.portfolio.findFirst({ where: { name: "Default" }, orderBy: { id: "asc" } });
  if (!def) {
    def = await prisma.portfolio.create({
      data: {
        name: "Default",
        kind: "swing",
        status: "active",
        startingBalance: parseFloat(await getSetting("startingBalance", "10000")) || 10000,
        riskPctPerTrade: parseFloat(await getSetting("riskPctPerTrade", "1")) || 1,
        maxOpenPositions: parseInt(await getSetting("maxOpenPositions", "5"), 10) || 5,
        drawdownHaltPct: parseFloat(await getSetting("drawdownHaltPct", "10")) || 10,
        killSwitch: (await getSetting("killSwitch", "false")) === "true",
        killSwitchReason: await getSetting("killSwitchReason", ""),
        sort: 0,
      },
    });
  }

  const t = await prisma.trade.updateMany({ where: { portfolioId: null }, data: { portfolioId: def.id } });
  const s = await prisma.signal.updateMany({ where: { portfolioId: null }, data: { portfolioId: def.id } });
  const w = await prisma.watchlist.updateMany({ where: { portfolioId: null }, data: { portfolioId: def.id } });
  console.log(`Backfill → portfolio #${def.id}: trades ${t.count}, signals ${s.count}, watchlist ${w.count}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Run the backfill**

Run: `npx tsx scripts/backfill-portfolios.ts`
Expected: prints `Backfill → portfolio #1: trades N, signals M, watchlist K` with no nulls remaining.

- [ ] **Step 5: Make the foreign keys REQUIRED**

In `prisma/schema.prisma`, change all three `portfolioId Int?` to `portfolioId Int` and the three `portfolio Portfolio?` relations to `portfolio Portfolio` (drop the `?`). Then:

Run: `npm run db:push` then `npm run db:generate`
Expected: succeeds (all rows already have a `portfolioId`). If `db push` warns about required columns, the backfill in Step 4 did not run — re-run it before retrying.

- [ ] **Step 6: Update the seed to create the Default portfolio**

In `prisma/seed.ts`, before the demo-trades block ("---- Demo trades..."), add:

```ts
  // ---- Default portfolio (all demo trades/watchlist belong to it) ----
  const defaultPortfolio =
    (await prisma.portfolio.findFirst({ where: { name: "Default" }, orderBy: { id: "asc" } })) ??
    (await prisma.portfolio.create({ data: { name: "Default", kind: "swing", sort: 0 } }));
```

Then, in every `prisma.trade.create({ data: { ... } })` call in the seed, add `portfolioId: defaultPortfolio.id,` to the `data` object. If the seed seeds watchlist rows, add `portfolioId: defaultPortfolio.id` there too. (Search the file for `prisma.trade.create` and `prisma.watchlist` to find them all.)

- [ ] **Step 7: Verify the seed runs clean**

Run: `npm run db:seed`
Expected: completes with no Prisma validation error; a Default portfolio exists and demo trades carry its `portfolioId`. Confirm with: `npx tsx -e "import('./src/lib/db.js')" ` is not needed — instead spot-check via `npm run db:studio` (open Trade table, confirm `portfolioId` populated) or trust the absence of errors.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma scripts/backfill-portfolios.ts prisma/seed.ts
git commit -m "feat: add Portfolio model, backfill existing rows, seed Default portfolio"
```

---

## Task 5: Per-portfolio settings + global halt getter

**Files:**
- Modify: `src/lib/settings.ts`

After this task `src/lib/settings.ts` will not type-check against its callers until Tasks 6–8 update them. That is expected; this task's gate is that the FILE itself is internally consistent. Run the per-file check noted in Step 3.

- [ ] **Step 1: Rewrite the per-portfolio getters to read the Portfolio row**

Replace the body of `src/lib/settings.ts` from the `isKillSwitchOn` function through `getKillSwitchReason` with portfolio-scoped versions, and add a global-halt getter. The final file reads:

```ts
// Typed access to per-portfolio risk config (from the Portfolio row) and to
// genuinely global state (the Setting key-value table).

import { prisma } from "@/lib/db";

export async function getSetting(key: string, fallback: string): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? fallback;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

/** Load a portfolio row or throw — the trading core must never fall back to defaults. */
export async function getPortfolio(portfolioId: number) {
  const p = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!p) throw new Error(`portfolio ${portfolioId} not found`);
  return p;
}

export async function isKillSwitchOn(portfolioId: number): Promise<boolean> {
  return (await getPortfolio(portfolioId)).killSwitch;
}

export async function getKillSwitchReason(portfolioId: number): Promise<string> {
  return (await getPortfolio(portfolioId)).killSwitchReason;
}

export async function getMaxOpenPositions(portfolioId: number): Promise<number> {
  const n = (await getPortfolio(portfolioId)).maxOpenPositions;
  return Number.isFinite(n) && n > 0 ? n : 5;
}

export async function getStartingBalance(portfolioId: number): Promise<number> {
  const n = (await getPortfolio(portfolioId)).startingBalance;
  return Number.isFinite(n) && n > 0 ? n : 10000;
}

export async function getRiskPctPerTrade(portfolioId: number): Promise<number> {
  const n = (await getPortfolio(portfolioId)).riskPctPerTrade;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export async function getDrawdownHaltPct(portfolioId: number): Promise<number> {
  const n = (await getPortfolio(portfolioId)).drawdownHaltPct;
  return Number.isFinite(n) && n > 0 ? n : 10;
}

/** Manual global emergency brake — blocks new entries across every portfolio. */
export async function isGlobalTradingHalt(): Promise<boolean> {
  return (await getSetting("globalTradingHalt", "false")) === "true";
}

export interface FearGreed { value: number; label: string; fetchedAt: string }

export async function getFearGreed(): Promise<FearGreed | null> {
  try {
    return JSON.parse(await getSetting("fearGreed", "null")) as FearGreed | null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: (No new unit test)** — these getters are thin DB reads; their numeric fallbacks mirror the previously-tested behavior and are exercised end-to-end via the API smoke check in Task 8.

- [ ] **Step 3: Per-file type-check note**

A full `npx tsc --noEmit` will now report errors in `engine.ts`, `manage.ts`, `circuitBreaker.ts`, and `api/settings/route.ts` because their calls don't yet pass `portfolioId`. That is expected and is fixed in Tasks 6–8. Confirm the errors are ONLY "Expected 1 arguments, but got 0" (or similar) on those four files — no errors inside `settings.ts` itself.

- [ ] **Step 4: Commit**

```bash
git add src/lib/settings.ts
git commit -m "feat: scope risk settings to a portfolio; add global halt getter"
```

---

## Task 6: Scope circuitBreaker and manage to a portfolio

**Files:**
- Modify: `src/lib/trading/circuitBreaker.ts`
- Modify: `src/lib/trading/manage.ts`

- [ ] **Step 1: Update `getCurrentDrawdownPct` to take a portfolioId**

In `src/lib/trading/circuitBreaker.ts`, replace the `getCurrentDrawdownPct` function with:

```ts
/** Loads a portfolio's closed trades and computes its drawdown vs. its peak. */
export async function getCurrentDrawdownPct(portfolioId: number): Promise<number> {
  const { getStartingBalance } = await import("@/lib/settings");
  const startingBalance = await getStartingBalance(portfolioId);
  const closed = await prisma.trade.findMany({
    where: { status: "closed", portfolioId },
    orderBy: { closedAt: "asc" },
    select: { pnl: true, rMultiple: true, outcome: true, closedAt: true },
  });
  return currentDrawdownPct(closed.map((t) => ({ ...t, pnl: t.pnl ?? 0 })), startingBalance);
}
```

(The dynamic `import("@/lib/settings")` avoids a circular import, since `settings.ts` and `circuitBreaker.ts` may otherwise reference each other through the trading barrel. If your editor confirms no cycle, a top-level `import { getStartingBalance } from "@/lib/settings";` is equivalent — prefer the top-level import if it type-checks cleanly.)

- [ ] **Step 2: Scope `manageOpenTrades` to a portfolio**

In `src/lib/trading/manage.ts`:

Change the imports line:
```ts
import { isKillSwitchOn, getStartingBalance, getDrawdownHaltPct, setSetting } from "@/lib/settings";
```
to:
```ts
import { isKillSwitchOn, getDrawdownHaltPct } from "@/lib/settings";
```

Change the signature:
```ts
export async function manageOpenTrades(): Promise<ManageSummary> {
  const open = await prisma.trade.findMany({ where: { status: "open" } });
```
to:
```ts
export async function manageOpenTrades(portfolioId: number): Promise<ManageSummary> {
  const open = await prisma.trade.findMany({ where: { status: "open", portfolioId } });
```

Replace the drawdown auto-trip block (currently):
```ts
  const killSwitchOn = await isKillSwitchOn();
  if (!killSwitchOn) {
    const [startingBalance, haltPct] = await Promise.all([getStartingBalance(), getDrawdownHaltPct()]);
    const dd = await getCurrentDrawdownPct(startingBalance);
    if (dd >= haltPct) {
      await setSetting("killSwitch", "true");
      await setSetting(
        "killSwitchReason",
        `Auto-halted: drawdown -${dd.toFixed(1)}% exceeded ${haltPct}% limit at ${new Date().toISOString()}`,
      );
    }
  }
```
with:
```ts
  const killSwitchOn = await isKillSwitchOn(portfolioId);
  if (!killSwitchOn) {
    const haltPct = await getDrawdownHaltPct(portfolioId);
    const dd = await getCurrentDrawdownPct(portfolioId);
    if (dd >= haltPct) {
      await prisma.portfolio.update({
        where: { id: portfolioId },
        data: {
          killSwitch: true,
          killSwitchReason: `Auto-halted: drawdown -${dd.toFixed(1)}% exceeded ${haltPct}% limit at ${new Date().toISOString()}`,
        },
      });
    }
  }
```

- [ ] **Step 3: Type-check note**

`npx tsc --noEmit` should now show the remaining errors only in `engine.ts` and `api/*` routes (callers of `manageOpenTrades`/`getCurrentDrawdownPct` not yet passing an id). No errors inside `manage.ts`/`circuitBreaker.ts` themselves.

- [ ] **Step 4: Commit**

```bash
git add src/lib/trading/circuitBreaker.ts src/lib/trading/manage.ts
git commit -m "feat: scope circuit breaker and position manager to a portfolio"
```

---

## Task 7: Scope the engine, scanner watchlist, and add global/archived guards

**Files:**
- Modify: `src/lib/trading/engine.ts`
- Modify: `src/lib/trading/watchlist.ts`

- [ ] **Step 1: Scope the watchlist**

In `src/lib/trading/watchlist.ts`, replace `getWatchlist` with a portfolio-scoped version:

```ts
/** Return a portfolio's watchlist, seeding defaults the first time it's empty. */
export async function getWatchlist(portfolioId: number) {
  const count = await prisma.watchlist.count({ where: { portfolioId } });
  if (count === 0) {
    await prisma.watchlist.createMany({
      data: DEFAULT_WATCHLIST.map((w, i) => ({ ...w, sort: i, portfolioId })),
    });
  }
  return prisma.watchlist.findMany({ where: { portfolioId }, orderBy: { sort: "asc" } });
}
```

- [ ] **Step 2: Thread `portfolioId` through `runTradeTick`**

In `src/lib/trading/engine.ts`:

Update the imports line:
```ts
import { isKillSwitchOn, getMaxOpenPositions, getFearGreed, getStartingBalance, getRiskPctPerTrade } from "@/lib/settings";
```
to:
```ts
import { isKillSwitchOn, getMaxOpenPositions, getFearGreed, getStartingBalance, getRiskPctPerTrade, isGlobalTradingHalt } from "@/lib/settings";
```

Change the signature and the scan/dedupe block:
```ts
export async function runTradeTick(
  symbol: string,
  portfolioId: number,
  opts: { range?: Range; interval?: Interval; lot?: number } = {},
): Promise<TickResult> {
```

Update the dedupe query (line ~49) to scope by portfolio:
```ts
  const existing = await prisma.trade.findFirst({
    where: { symbol, status: "open", portfolioId },
    select: { id: true },
  });
```

Update the signal create (line ~58) to include `portfolioId`:
```ts
  const signal = await prisma.signal.create({
    data: {
      symbol, timeframe: scan.timeframe, side: scan.side ?? "long", price: scan.price, atr: scan.atr,
      indicators: JSON.stringify(scan.snapshot), note: scan.note, status: "proposed",
      portfolioId,
    },
  });
```

Update the open-positions correlation query (line ~107) to scope by portfolio:
```ts
    const openPositions = await prisma.trade.findMany({
      where: { status: "open", portfolioId },
      select: { symbol: true },
    });
```

Update the risk sizing (line ~130):
```ts
    const riskUsd = ((await getStartingBalance(portfolioId)) * (await getRiskPctPerTrade(portfolioId))) / 100;
```

Replace the `account` object (lines ~141–147) with portfolio-scoped values plus the global halt:
```ts
  const account: AccountState = {
    ...DEFAULT_ACCOUNT,
    dailyLossUsd: await todaysRealizedLoss(portfolioId),
    killSwitch: await isKillSwitchOn(portfolioId),
    globalTradingHalt: await isGlobalTradingHalt(),
    openPositions: await prisma.trade.count({ where: { status: "open", portfolioId } }),
    maxOpenPositions: await getMaxOpenPositions(portfolioId),
  };
```

Update the trade create (line ~167) to include `portfolioId`:
```ts
  const trade = await prisma.trade.create({
    data: {
      signalId: signal.id, portfolioId,
      symbol, side: hawk.side, entry: levels.entry, sl: levels.sl, tp1: levels.tp1, tp2: levels.tp2,
      lot, riskReward: riskReward({ symbol, side: hawk.side, entry: levels.entry, sl: levels.sl, tp1: levels.tp1, lot }),
      status: "open", ironRulesPassed: true,
      sageVerdict: `approve — ${sage.reason}`,
      hawkVotes: JSON.stringify(hawk.votes),
      decisionLog: JSON.stringify(steps),
      stagedTp: JSON.stringify({ tp1Hit: false, slToBreakeven: false }),
    },
  });
```

Update the `todaysRealizedLoss` helper (line ~198) to scope by portfolio:
```ts
async function todaysRealizedLoss(portfolioId: number): Promise<number> {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const closed = await prisma.trade.findMany({ where: { status: "closed", closedAt: { gte: start }, portfolioId } });
  const loss = closed.reduce((s, t) => s + Math.min(0, t.pnl ?? 0), 0);
  return Math.abs(loss);
}
```

- [ ] **Step 3: Type-check note**

`npx tsc --noEmit` should now show errors only in the API routes (`trade-tick`, `scan-all`, `manage`, `settings`) — the callers fixed in Task 8. No errors inside `engine.ts`/`watchlist.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/trading/engine.ts src/lib/trading/watchlist.ts
git commit -m "feat: scope trade engine and watchlist to a portfolio; enforce global halt"
```

---

## Task 8: API routes + UI (switcher, overview, global halt, safety panel)

**Files:**
- Create: `src/app/api/portfolios/route.ts`
- Create: `src/app/api/portfolios/[id]/route.ts`
- Modify: `src/app/api/trade-tick/route.ts`, `src/app/api/scan-all/route.ts`, `src/app/api/manage/route.ts`
- Modify: `src/app/api/settings/route.ts`
- Modify: `src/app/command/safety-panel.tsx`
- Modify: `src/app/page.tsx` (War Room — mount the overview strip + switcher)

- [ ] **Step 1: Create `GET`/`POST /api/portfolios`**

```ts
// src/app/api/portfolios/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { computePortfolioStats } from "@/lib/trading/portfolioStats";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const includeArchived = new URL(req.url).searchParams.get("includeArchived") === "1";
  const portfolios = await prisma.portfolio.findMany({
    where: includeArchived ? {} : { status: "active" },
    orderBy: { sort: "asc" },
  });
  const withStats = await Promise.all(
    portfolios.map(async (p) => {
      const trades = await prisma.trade.findMany({
        where: { portfolioId: p.id },
        select: { status: true, pnl: true, rMultiple: true, outcome: true, closedAt: true },
      });
      const stats = computePortfolioStats(trades, p.startingBalance);
      return { ...p, ...stats };
    }),
  );
  return NextResponse.json(withStats);
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as {
    name?: string; kind?: string; startingBalance?: number;
    riskPctPerTrade?: number; maxOpenPositions?: number; drawdownHaltPct?: number;
  };
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (b.startingBalance != null && !(b.startingBalance > 0)) return NextResponse.json({ error: "startingBalance must be > 0" }, { status: 400 });
  if (b.riskPctPerTrade != null && !(b.riskPctPerTrade > 0)) return NextResponse.json({ error: "riskPctPerTrade must be > 0" }, { status: 400 });
  if (b.maxOpenPositions != null && !(b.maxOpenPositions > 0)) return NextResponse.json({ error: "maxOpenPositions must be > 0" }, { status: 400 });
  if (b.drawdownHaltPct != null && !(b.drawdownHaltPct > 0)) return NextResponse.json({ error: "drawdownHaltPct must be > 0" }, { status: 400 });

  const maxSort = await prisma.portfolio.aggregate({ _max: { sort: true } });
  const created = await prisma.portfolio.create({
    data: {
      name,
      kind: typeof b.kind === "string" && b.kind.trim() ? b.kind.trim() : "swing",
      startingBalance: b.startingBalance ?? 10000,
      riskPctPerTrade: b.riskPctPerTrade ?? 1,
      maxOpenPositions: b.maxOpenPositions ? Math.floor(b.maxOpenPositions) : 5,
      drawdownHaltPct: b.drawdownHaltPct ?? 10,
      sort: (maxSort._max.sort ?? 0) + 1,
    },
  });
  return NextResponse.json(created, { status: 201 });
}
```

- [ ] **Step 2: Create `PATCH /api/portfolios/[id]`**

```ts
// src/app/api/portfolios/[id]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const portfolioId = Number(id);
  if (!Number.isInteger(portfolioId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const b = (await req.json().catch(() => ({}))) as {
    killSwitch?: boolean; riskPctPerTrade?: number; maxOpenPositions?: number;
    startingBalance?: number; drawdownHaltPct?: number; status?: string; name?: string;
  };
  const data: Record<string, unknown> = {};
  if (typeof b.killSwitch === "boolean") {
    data.killSwitch = b.killSwitch;
    if (!b.killSwitch) data.killSwitchReason = "";
  }
  if (typeof b.riskPctPerTrade === "number" && b.riskPctPerTrade > 0) data.riskPctPerTrade = b.riskPctPerTrade;
  if (typeof b.maxOpenPositions === "number" && b.maxOpenPositions > 0) data.maxOpenPositions = Math.floor(b.maxOpenPositions);
  if (typeof b.startingBalance === "number" && b.startingBalance > 0) data.startingBalance = b.startingBalance;
  if (typeof b.drawdownHaltPct === "number" && b.drawdownHaltPct > 0) data.drawdownHaltPct = b.drawdownHaltPct;
  if (b.status === "active" || b.status === "archived") data.status = b.status;
  if (typeof b.name === "string" && b.name.trim()) data.name = b.name.trim();

  const updated = await prisma.portfolio.update({ where: { id: portfolioId }, data });
  return NextResponse.json(updated);
}
```

- [ ] **Step 3: Update trade-tick / scan-all / manage routes to take `portfolioId`**

`src/app/api/trade-tick/route.ts` — parse `portfolioId`, reject archived/halt, pass it:
```ts
import { runTradeTick } from "@/lib/trading/engine";
import { prisma } from "@/lib/db";
import { canPortfolioTrade } from "@/lib/portfolioGuards";
import { isGlobalTradingHalt } from "@/lib/settings";
import type { Interval, Range } from "@/lib/yahoo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const symbol = typeof body.symbol === "string" ? body.symbol.trim() : "";
  const portfolioId = Number(body.portfolioId);
  if (!symbol) return Response.json({ error: "symbol is required (e.g. GC=F, BTC-USD, EURUSD=X)" }, { status: 400 });
  if (!Number.isInteger(portfolioId)) return Response.json({ error: "portfolioId is required" }, { status: 400 });

  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) return Response.json({ error: "portfolio not found" }, { status: 404 });
  if (!canPortfolioTrade(portfolio.status)) return Response.json({ error: "portfolio is archived" }, { status: 409 });
  if (await isGlobalTradingHalt()) return Response.json({ error: "global trading halt is on" }, { status: 409 });

  try {
    const result = await runTradeTick(symbol, portfolioId, {
      range: body.range as Range | undefined,
      interval: body.interval as Interval | undefined,
      lot: typeof body.lot === "number" ? body.lot : undefined,
    });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
```

`src/app/api/scan-all/route.ts` — scope to a portfolio's watchlist, skip archived/halt:
```ts
import { runTradeTick } from "@/lib/trading/engine";
import { manageOpenTrades } from "@/lib/trading/manage";
import { getWatchlist } from "@/lib/trading/watchlist";
import { prisma } from "@/lib/db";
import { canPortfolioTrade } from "@/lib/portfolioGuards";
import { isGlobalTradingHalt } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const portfolioId = Number(body.portfolioId);
  if (!Number.isInteger(portfolioId)) return Response.json({ error: "portfolioId is required" }, { status: 400 });
  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) return Response.json({ error: "portfolio not found" }, { status: 404 });
  if (!canPortfolioTrade(portfolio.status)) return Response.json({ error: "portfolio is archived" }, { status: 409 });
  if (await isGlobalTradingHalt()) return Response.json({ error: "global trading halt is on" }, { status: 409 });

  await manageOpenTrades(portfolioId);
  const list = (await getWatchlist(portfolioId)).filter((w) => w.enabled);
  const results: { symbol: string; outcome: string; steps: number; costUsd: number; tradeId?: number; error?: string }[] = [];
  let totalCost = 0;

  for (const w of list) {
    try {
      const r = await runTradeTick(w.symbol, portfolioId);
      totalCost += r.costUsd;
      results.push({ symbol: w.symbol, outcome: r.outcome, steps: r.steps.length, costUsd: r.costUsd, tradeId: r.tradeId });
    } catch (e) {
      results.push({ symbol: w.symbol, outcome: "error", steps: 0, costUsd: 0, error: String(e) });
    }
  }

  const executed = results.filter((r) => r.outcome === "executed").length;
  return Response.json({ scanned: results.length, executed, totalCostUsd: totalCost, results });
}
```

`src/app/api/manage/route.ts` — take portfolioId:
```ts
import { manageOpenTrades } from "@/lib/trading/manage";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const portfolioId = Number(body.portfolioId);
  if (!Number.isInteger(portfolioId)) return Response.json({ error: "portfolioId is required" }, { status: 400 });
  const summary = await manageOpenTrades(portfolioId);
  return Response.json(summary);
}
```

- [ ] **Step 4: Slim `/api/settings` to global state**

Replace `src/app/api/settings/route.ts` with:
```ts
import { NextResponse } from "next/server";
import { getSetting, setSetting, getFearGreed } from "@/lib/settings";

export const dynamic = "force-dynamic";

async function snapshot() {
  return NextResponse.json({
    globalTradingHalt: (await getSetting("globalTradingHalt", "false")) === "true",
    fearGreed: await getFearGreed(),
  });
}

export async function GET() {
  return snapshot();
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { globalTradingHalt?: boolean };
  if (typeof body.globalTradingHalt === "boolean") {
    await setSetting("globalTradingHalt", String(body.globalTradingHalt));
  }
  return snapshot();
}
```

- [ ] **Step 5: Rewrite the Safety panel to operate on the selected portfolio + global halt**

Replace `src/app/command/safety-panel.tsx` with a version that takes a `portfolioId` prop, loads that portfolio from `/api/portfolios`, edits it via `PATCH /api/portfolios/[id]`, and toggles the global halt via `/api/settings`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardTitle, Button, Badge } from "@/components/ui";

interface Portfolio {
  id: number; name: string; kind: string; status: string;
  killSwitch: boolean; killSwitchReason: string;
  maxOpenPositions: number; startingBalance: number; riskPctPerTrade: number;
  drawdownHaltPct: number; currentDrawdownPct: number;
}
interface Global { globalTradingHalt: boolean; fearGreed: { value: number; label: string } | null }

export function SafetyPanel({ portfolioId }: { portfolioId: number }) {
  const [p, setP] = useState<Portfolio | null>(null);
  const [g, setG] = useState<Global | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [list, glob] = await Promise.all([
      fetch("/api/portfolios?includeArchived=1").then((r) => r.json()) as Promise<Portfolio[]>,
      fetch("/api/settings").then((r) => r.json()) as Promise<Global>,
    ]);
    setP(list.find((x) => x.id === portfolioId) ?? null);
    setG(glob);
  }, [portfolioId]);
  useEffect(() => { void load(); }, [load]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetch(`/api/portfolios/${portfolioId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      await load();
    } finally { setBusy(false); }
  }

  async function toggleGlobalHalt(next: boolean) {
    setBusy(true);
    try {
      await fetch("/api/settings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ globalTradingHalt: next }),
      });
      await load();
    } finally { setBusy(false); }
  }

  if (!p || !g) return null;
  const dd = p.currentDrawdownPct.toFixed(1);
  return (
    <Card>
      <div className="flex items-center justify-between gap-2 mb-1">
        <CardTitle>🛡️ Safety · {p.name}</CardTitle>
        {g.fearGreed && <Badge tone="info">F&G {g.fearGreed.value} · {g.fearGreed.label}</Badge>}
      </div>

      {g.globalTradingHalt && (
        <div className="mt-2 rounded-md border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          GLOBAL TRADING HALT is ON — every portfolio is blocked from new trades.
        </div>
      )}
      <div className="flex items-center justify-between gap-3 mt-2">
        <div className="text-sm font-medium">Global emergency halt</div>
        <Button size="sm" variant={g.globalTradingHalt ? "outline" : "danger"} disabled={busy}
          onClick={() => toggleGlobalHalt(!g.globalTradingHalt)}>
          {g.globalTradingHalt ? "Lift global halt" : "HALT ALL"}
        </Button>
      </div>

      {p.killSwitch && p.killSwitchReason && (
        <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          {p.killSwitchReason}
        </div>
      )}
      <div className="flex items-center justify-between gap-3 mt-2">
        <div className={`text-sm font-medium ${p.killSwitch ? "text-red-400" : ""}`}>
          {p.killSwitch ? "PORTFOLIO HALTED" : "Portfolio trading enabled"}
        </div>
        <Button size="sm" variant={p.killSwitch ? "outline" : "danger"} disabled={busy}
          onClick={() => patch({ killSwitch: !p.killSwitch })}>
          {p.killSwitch ? "Resume" : "STOP"}
        </Button>
      </div>

      <div className="flex items-center gap-2 mt-3">
        <label className="text-xs text-(--color-muted)">Max open positions</label>
        <input type="number" min={1} value={p.maxOpenPositions} disabled={busy}
          onChange={(e) => patch({ maxOpenPositions: Number(e.target.value) })}
          className="w-16 rounded-md bg-(--color-card) border border-(--color-border) px-2 py-1 text-sm" />
      </div>
      <div className="flex items-center gap-2 mt-2">
        <label className="text-xs text-(--color-muted)">Starting balance ($)</label>
        <input type="number" min={1} value={p.startingBalance} disabled={busy}
          onChange={(e) => patch({ startingBalance: Number(e.target.value) })}
          className="w-24 rounded-md bg-(--color-card) border border-(--color-border) px-2 py-1 text-sm" />
      </div>
      <div className="flex items-center gap-2 mt-2">
        <label className="text-xs text-(--color-muted)">Risk per trade (%)</label>
        <input type="number" min={0.1} step={0.1} value={p.riskPctPerTrade} disabled={busy}
          onChange={(e) => patch({ riskPctPerTrade: Number(e.target.value) })}
          className="w-16 rounded-md bg-(--color-card) border border-(--color-border) px-2 py-1 text-sm" />
      </div>
      <div className="flex items-center gap-2 mt-2">
        <label className="text-xs text-(--color-muted)">Max drawdown halt (%)</label>
        <input type="number" min={1} step={1} value={p.drawdownHaltPct} disabled={busy}
          onChange={(e) => patch({ drawdownHaltPct: Number(e.target.value) })}
          className="w-16 rounded-md bg-(--color-card) border border-(--color-border) px-2 py-1 text-sm" />
      </div>
      <div className="flex items-center justify-between gap-2 mt-2">
        <span className="text-xs text-(--color-muted)">Current drawdown</span>
        <span className="text-xs font-mono">{dd === "0.0" ? "0.0%" : `-${dd}%`}</span>
      </div>
      <div className="flex items-center justify-between gap-2 mt-3">
        <span className="text-xs text-(--color-muted)">Status: {p.status}</span>
        <Button size="sm" variant="outline" disabled={busy}
          onClick={() => patch({ status: p.status === "archived" ? "active" : "archived" })}>
          {p.status === "archived" ? "Unarchive" : "Archive"}
        </Button>
      </div>
    </Card>
  );
}
```

- [ ] **Step 6: Mount the overview strip + switcher on the War Room and pass the selected portfolio to the Safety panel**

In `src/app/page.tsx` (War Room): read the selected portfolio from the `?portfolio=<id>` search param (default to the lowest-`sort` active portfolio), render a row of portfolio cards at the top (name, kind, equity, realized P/L, open count, drawdown, kill-switch/halt badges) from `GET /api/portfolios`, and pass the resolved id to `<SafetyPanel portfolioId={...} />`. Because `page.tsx` already queries trades for the War Room feed, scope those queries with `where: { portfolioId }`.

Implement the overview + switcher as a small client component so card clicks can set `?portfolio=<id>`:

```tsx
// src/app/command/portfolio-bar.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, Button } from "@/components/ui";

interface PortfolioCard {
  id: number; name: string; kind: string; status: string;
  equity: number; realizedPnl: number; openCount: number;
  currentDrawdownPct: number; killSwitch: boolean;
}

export function PortfolioBar({ selectedId }: { selectedId: number }) {
  const [items, setItems] = useState<PortfolioCard[]>([]);
  const [globalHalt, setGlobalHalt] = useState(false);
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    void fetch("/api/portfolios").then((r) => r.json()).then(setItems);
    void fetch("/api/settings").then((r) => r.json()).then((g) => setGlobalHalt(!!g.globalTradingHalt));
  }, []);

  function select(id: number) {
    const next = new URLSearchParams(params);
    next.set("portfolio", String(id));
    router.push(`/?${next.toString()}`);
  }

  return (
    <div className="space-y-2">
      {globalHalt && (
        <div className="rounded-md border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-xs text-red-300">
          GLOBAL TRADING HALT is ON
        </div>
      )}
      <div className="flex gap-2 overflow-x-auto">
        {items.map((p) => (
          <button key={p.id} onClick={() => select(p.id)}
            className={`min-w-44 text-left rounded-lg border px-3 py-2 ${p.id === selectedId ? "border-(--color-accent)" : "border-(--color-border)"}`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{p.name}</span>
              <span className="text-[10px] uppercase text-(--color-muted)">{p.kind}</span>
            </div>
            <div className="text-xs font-mono mt-1">${p.equity.toFixed(0)}</div>
            <div className="text-[11px] text-(--color-muted)">
              P/L {p.realizedPnl >= 0 ? "+" : ""}{p.realizedPnl.toFixed(0)} · open {p.openCount}
              {p.killSwitch ? " · ⛔" : ""}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
```

Then in `src/app/page.tsx`: resolve the selected id (search param or default), render `<PortfolioBar selectedId={id} />` near the top, scope the page's trade queries by `portfolioId: id`, and pass `id` to `<SafetyPanel portfolioId={id} />`. (A minimal new-portfolio create form may be added as a small client component posting to `POST /api/portfolios`; if deferred, a portfolio can still be created via the API. Include the form if it fits cleanly in the existing War Room layout.)

- [ ] **Step 7: Full type-check, tests, and smoke**

Run: `npx tsc --noEmit` — expect clean (all caller errors resolved).
Run: `npm test` — expect all tests pass (existing + Tasks 1–3 additions).
Run the dev server (`npm run dev`, port 3275) and smoke-check:
```bash
curl -s http://localhost:3275/api/portfolios
curl -s -X POST http://localhost:3275/api/settings -H "Content-Type: application/json" -d '{"globalTradingHalt":true}'
curl -s http://localhost:3275/api/settings
curl -s -X POST http://localhost:3275/api/settings -H "Content-Type: application/json" -d '{"globalTradingHalt":false}'
```
Expected: `/api/portfolios` returns the Default portfolio with stats fields (`equity`, `realizedPnl`, `openCount`, `currentDrawdownPct`); toggling `globalTradingHalt` round-trips true→false. Stop the dev server afterward.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/portfolios src/app/api/trade-tick/route.ts src/app/api/scan-all/route.ts src/app/api/manage/route.ts src/app/api/settings/route.ts src/app/command/safety-panel.tsx src/app/command/portfolio-bar.tsx src/app/page.tsx
git commit -m "feat: portfolio API + War Room switcher/overview, global halt, per-portfolio safety panel"
```

---

## Self-Review Notes

- **Spec coverage:** Portfolio model + FKs + migration/backfill/seed (Task 4); per-portfolio settings + `isGlobalTradingHalt` (Task 5); circuitBreaker/manage scoping (Task 6); engine/watchlist scoping + global-halt enforcement via Iron Rules (Tasks 2, 7); `canPortfolioTrade` archived guard (Task 3) enforced in routes (Task 8); portfolio stats helper (Task 1) surfaced via `GET /api/portfolios` (Task 8); API create/patch/list, slimmed `/api/settings`, scoped tick/scan/manage (Task 8); UI switcher + overview strip + global halt control + per-portfolio safety panel + archive action + new-portfolio form (Task 8). All spec sections map to a task.
- **Type consistency:** `getStartingBalance`/`getRiskPctPerTrade`/`getMaxOpenPositions`/`getDrawdownHaltPct`/`isKillSwitchOn`/`getKillSwitchReason` all take `portfolioId: number` from Task 5 onward; `getCurrentDrawdownPct(portfolioId)` (Task 6); `manageOpenTrades(portfolioId)` (Task 6); `runTradeTick(symbol, portfolioId, opts)` (Task 7); `getWatchlist(portfolioId)` (Task 7); `computePortfolioStats(trades, startingBalance)` / `PortfolioStats` / `PortfolioTrade` (Task 1) reused in Task 8; `canPortfolioTrade(status)` (Task 3) reused in Task 8; `AccountState.globalTradingHalt` (Task 2) set in Task 7.
- **Intentional intermediate breakage:** Tasks 5–7 leave `tsc` red on not-yet-updated callers by design; each task documents which files should still error and confirms no errors inside the file it edits. Full green is restored at the end of Task 8.
- **No placeholders:** every code step shows complete code or an exact before/after edit; commands include expected output.
