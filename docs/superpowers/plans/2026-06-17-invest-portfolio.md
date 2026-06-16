# Long-term Invest Portfolio (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the analysis-only `/invest` page into a managed, advisory buy-and-hold portfolio (`kind="invest"`): hold positions, value them mark-to-market, propose a BUY/ADD/TRIM/SELL rebalance plan from the existing committee, and let the user approve actions to execute on paper.

**Architecture:** A new `Holding` model + per-portfolio `cash`. Two pure modules — `investStats` (mark-to-market valuation) and `rebalance` (the planner) — plus a DB executor with pure avg-cost helpers. An advisory API (`/api/invest/plan|execute|execute-all|holdings`) orchestrates the committee (`analyzeLongTerm`) and prices, and the `/invest` page gains a portfolio mode. Invest routes reject non-invest portfolios; swing routes reject invest portfolios.

**Tech Stack:** TypeScript, Next.js 16 (App Router), Prisma 7 + SQLite (better-sqlite3 adapter), `node:test` + `node:assert/strict` (run via `npm test`). DB: `npm run db:push`, `npm run db:generate`. Pure logic is unit-tested; DB/API/UI tasks are verified by `npx tsc --noEmit` + curl smoke.

---

## File Structure

- **Create** `src/lib/invest/investStats.ts` (+ test) — pure mark-to-market valuation.
- **Create** `src/lib/invest/rebalance.ts` (+ test) — pure rebalance planner.
- **Modify** `src/lib/portfolioGuards.ts` (+ test) — add `isInvestKind`.
- **Modify** `prisma/schema.prisma` — `Holding` model; `Portfolio.cash` + `rebalanceBandPct` + `holdings` relation.
- **Modify** `src/app/api/portfolios/route.ts` — init `cash = startingBalance` for `kind="invest"` on create.
- **Create** `src/lib/invest/execute.ts` (+ test) — pure `buyInto`/`sellFrom` avg-cost helpers + DB `executeAction`.
- **Create** `src/app/api/invest/plan/route.ts`, `src/app/api/invest/execute/route.ts`, `src/app/api/invest/execute-all/route.ts`, `src/app/api/invest/holdings/route.ts`.
- **Modify** `src/app/api/trade-tick/route.ts`, `src/app/api/scan-all/route.ts`, `src/app/api/scan-universe/route.ts` — reject `kind="invest"`.
- **Modify** `src/app/invest/page.tsx` — add portfolio mode (switcher, holdings table, plan + approve).

Reuse: `analyzeLongTerm` (`src/lib/invest/analyze.ts`) for committee reads, `fetchCandles` (`src/lib/marketData.ts`) for prices, `getWatchlist` (`src/lib/trading/watchlist.ts`).

---

## Task 1: Pure mark-to-market valuation helper

**Files:**
- Create: `src/lib/invest/investStats.ts`
- Test: `src/lib/invest/investStats.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/invest/investStats.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeInvestStats, type InvestHolding } from "./investStats";

function h(symbol: string, shares: number, avgCost: number, status = "held", realizedPnl = 0): InvestHolding {
  return { symbol, shares, avgCost, status, realizedPnl };
}

test("computeInvestStats: empty portfolio is all cash", () => {
  const s = computeInvestStats([], () => null, 10000);
  assert.equal(s.cash, 10000);
  assert.equal(s.marketValue, 0);
  assert.equal(s.equity, 10000);
  assert.equal(s.unrealizedPnl, 0);
  assert.equal(s.realizedPnl, 0);
});

test("computeInvestStats: equity = cash + market value; unrealized = MV - cost", () => {
  const holdings = [h("AAPL", 10, 100), h("MSFT", 5, 200)];
  const price: Record<string, number> = { AAPL: 120, MSFT: 180 };
  const s = computeInvestStats(holdings, (sym) => price[sym] ?? null, 5000);
  // MV = 10*120 + 5*180 = 1200 + 900 = 2100; cost = 1000 + 1000 = 2000
  assert.equal(s.marketValue, 2100);
  assert.equal(s.equity, 7100);
  assert.equal(s.unrealizedPnl, 100);
});

test("computeInvestStats: realizedPnl sums all holdings (held + sold)", () => {
  const holdings = [h("AAPL", 10, 100, "held", 50), h("NVDA", 0, 0, "sold", 300)];
  const s = computeInvestStats(holdings, () => 100, 1000);
  assert.equal(s.realizedPnl, 350);
});

test("computeInvestStats: a missing price falls back to cost basis (never zero) and is flagged", () => {
  const holdings = [h("AAPL", 10, 100)];
  const s = computeInvestStats(holdings, () => null, 0);
  assert.equal(s.marketValue, 1000); // 10 * avgCost 100
  assert.deepEqual(s.missingPrices, ["AAPL"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/invest/investStats.test.ts`
Expected: FAIL — `Cannot find module './investStats'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/invest/investStats.ts
// Pure mark-to-market valuation of an invest portfolio. No DB/network — the
// caller supplies the holdings, a price lookup, and the cash balance.

export interface InvestHolding {
  symbol: string;
  shares: number;
  avgCost: number;
  status: string;      // "held" | "sold"
  realizedPnl: number;
}

export interface InvestStats {
  cash: number;
  marketValue: number;      // Σ held shares × price (cost basis when price missing)
  equity: number;           // cash + marketValue
  unrealizedPnl: number;    // marketValue − cost basis of held positions
  realizedPnl: number;      // Σ realizedPnl over all holdings
  missingPrices: string[];  // held symbols with no available price
}

export function computeInvestStats(
  holdings: InvestHolding[],
  priceOf: (symbol: string) => number | null,
  cash: number,
): InvestStats {
  const held = holdings.filter((h) => h.status === "held");
  const missingPrices: string[] = [];
  let marketValue = 0;
  let costBasis = 0;
  for (const h of held) {
    const px = priceOf(h.symbol);
    if (px == null) missingPrices.push(h.symbol);
    const valuePx = px ?? h.avgCost; // fall back to cost basis, never zero
    marketValue += h.shares * valuePx;
    costBasis += h.shares * h.avgCost;
  }
  const realizedPnl = holdings.reduce((sum, h) => sum + (h.realizedPnl ?? 0), 0);
  return {
    cash,
    marketValue,
    equity: cash + marketValue,
    unrealizedPnl: marketValue - costBasis,
    realizedPnl,
    missingPrices,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/invest/investStats.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Type-check and commit**

Run `npx tsc --noEmit` (clean), then:
```bash
git add src/lib/invest/investStats.ts src/lib/invest/investStats.test.ts
git commit -m "feat: add pure mark-to-market invest stats helper"
```

---

## Task 2: Pure rebalance planner

**Files:**
- Create: `src/lib/invest/rebalance.ts`
- Test: `src/lib/invest/rebalance.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/invest/rebalance.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { planRebalance, type RebalanceInput } from "./rebalance";

// Base: equity 10000, 4 target slots → target value 2500 each, band 5%.
function baseInput(over: Partial<RebalanceInput> = {}): RebalanceInput {
  return {
    holdings: [],
    reads: [],
    maxPositions: 4,
    bandPct: 5,
    cash: 10000,
    equity: 10000,
    ...over,
  };
}

test("SELL: a held name downgraded to avoid is sold in full", () => {
  const actions = planRebalance(baseInput({
    holdings: [{ symbol: "AAPL", shares: 10, avgCost: 100, price: 120 }],
    reads: [{ symbol: "AAPL", rating: "avoid", entryHigh: null, price: 120 }],
    cash: 0, equity: 1200,
  }));
  const sell = actions.find((a) => a.symbol === "AAPL");
  assert.equal(sell?.kind, "sell");
  assert.equal(sell?.shares, 10);
});

test("BUY: a new in-zone buy/strong-buy name is bought ~one target slice", () => {
  const actions = planRebalance(baseInput({
    reads: [{ symbol: "MSFT", rating: "buy", entryHigh: 200, price: 100 }],
  }));
  const buy = actions.find((a) => a.symbol === "MSFT");
  assert.equal(buy?.kind, "buy");
  // target value 2500 / price 100 = 25 shares
  assert.ok(Math.abs((buy?.shares ?? 0) - 25) < 1e-9);
});

test("BUY skipped when price is above the accumulation zone", () => {
  const actions = planRebalance(baseInput({
    reads: [{ symbol: "MSFT", rating: "buy", entryHigh: 90, price: 100 }],
  }));
  assert.equal(actions.find((a) => a.symbol === "MSFT"), undefined);
});

test("BUY skipped when already at maxPositions", () => {
  const held = [1, 2, 3, 4].map((i) => ({ symbol: `H${i}`, shares: 10, avgCost: 100, price: 100 }));
  const reads = held.map((h) => ({ symbol: h.symbol, rating: "hold" as const, entryHigh: null, price: 100 }));
  reads.push({ symbol: "MSFT", rating: "buy", entryHigh: null, price: 100 });
  const actions = planRebalance(baseInput({ holdings: held, reads, cash: 0, equity: 4000 }));
  assert.equal(actions.find((a) => a.symbol === "MSFT"), undefined);
});

test("TRIM: an overweight holding is trimmed back toward target", () => {
  // 1 holding worth 5000 of a 10000 equity, target 2500, band 5% → trim ~2500 worth
  const actions = planRebalance(baseInput({
    holdings: [{ symbol: "AAPL", shares: 50, avgCost: 80, price: 100 }],
    reads: [{ symbol: "AAPL", rating: "hold", entryHigh: null, price: 100 }],
    cash: 5000, equity: 10000,
  }));
  const trim = actions.find((a) => a.symbol === "AAPL");
  assert.equal(trim?.kind, "trim");
  // value 5000, target 2500 → trim 2500 / price 100 = 25 shares
  assert.ok(Math.abs((trim?.shares ?? 0) - 25) < 1e-9);
});

test("ADD: an underweight holding (not avoid) is topped up toward target", () => {
  // holding worth 500 of 10000 equity, target 2500 → add 2000 worth
  const actions = planRebalance(baseInput({
    holdings: [{ symbol: "AAPL", shares: 5, avgCost: 100, price: 100 }],
    reads: [{ symbol: "AAPL", rating: "buy", entryHigh: null, price: 100 }],
    cash: 9500, equity: 10000,
  }));
  const add = actions.find((a) => a.symbol === "AAPL");
  assert.equal(add?.kind, "add");
  assert.ok(Math.abs((add?.shares ?? 0) - 20) < 1e-9); // 2000 / 100
});

test("ordering: sells and trims come before buys and adds", () => {
  const actions = planRebalance(baseInput({
    holdings: [
      { symbol: "OLD", shares: 10, avgCost: 100, price: 100 }, // avoid → sell
    ],
    reads: [
      { symbol: "OLD", rating: "avoid", entryHigh: null, price: 100 },
      { symbol: "NEW", rating: "buy", entryHigh: null, price: 100 },
    ],
    cash: 0, equity: 1000,
  }));
  const kinds = actions.map((a) => a.kind);
  const lastSellOrTrim = Math.max(kinds.lastIndexOf("sell"), kinds.lastIndexOf("trim"));
  const firstBuyOrAdd = Math.min(
    kinds.indexOf("buy") === -1 ? Infinity : kinds.indexOf("buy"),
    kinds.indexOf("add") === -1 ? Infinity : kinds.indexOf("add"),
  );
  assert.ok(lastSellOrTrim < firstBuyOrAdd);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/invest/rebalance.test.ts`
Expected: FAIL — `Cannot find module './rebalance'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/invest/rebalance.ts
// Pure advisory rebalance planner. Given current holdings (priced), per-symbol
// committee reads, the target position count, drift band, cash, and equity,
// returns an ordered list of proposed BUY/ADD/TRIM/SELL actions. No I/O — the
// executor re-prices at approval time, so estPrice here is advisory.

export type Rating = "strong-buy" | "buy" | "watch" | "hold" | "avoid";
export type ActionKind = "buy" | "add" | "trim" | "sell";

export interface PlannerHolding { symbol: string; shares: number; avgCost: number; price: number }
export interface CommitteeRead { symbol: string; rating: Rating; entryHigh: number | null; price: number }

export interface RebalanceInput {
  holdings: PlannerHolding[];
  reads: CommitteeRead[];
  maxPositions: number;
  bandPct: number;
  cash: number;
  equity: number;
}

export interface RebalanceAction {
  kind: ActionKind;
  symbol: string;
  shares: number;
  estPrice: number;
  reason: string;
}

const BUYABLE: Rating[] = ["strong-buy", "buy"];

export function planRebalance(input: RebalanceInput): RebalanceAction[] {
  const { holdings, reads, maxPositions, bandPct, cash, equity } = input;
  const target = maxPositions > 0 ? equity / maxPositions : 0;
  const band = bandPct / 100;
  const readBySymbol = new Map(reads.map((r) => [r.symbol, r]));

  const sells: RebalanceAction[] = [];
  const trims: RebalanceAction[] = [];
  const buys: RebalanceAction[] = [];
  const adds: RebalanceAction[] = [];

  let availCash = cash;
  // Symbols still held (and not fully sold) after this pass, for capacity counting.
  const survivingHeld = new Set(holdings.map((h) => h.symbol));

  // SELL — held names the committee downgraded to avoid.
  for (const h of holdings) {
    const r = readBySymbol.get(h.symbol);
    if (r?.rating === "avoid") {
      sells.push({ kind: "sell", symbol: h.symbol, shares: h.shares, estPrice: h.price, reason: "committee downgraded to avoid" });
      availCash += h.shares * h.price;
      survivingHeld.delete(h.symbol);
    }
  }

  // TRIM — overweight holdings (not being sold) above target + band.
  for (const h of holdings) {
    if (!survivingHeld.has(h.symbol)) continue;
    const value = h.shares * h.price;
    if (value > target * (1 + band) && h.price > 0) {
      const trimShares = (value - target) / h.price;
      trims.push({ kind: "trim", symbol: h.symbol, shares: trimShares, estPrice: h.price, reason: `overweight ${(value / equity * 100).toFixed(0)}% > target ${(100 / maxPositions).toFixed(0)}%` });
      availCash += trimShares * h.price;
    }
  }

  // BUY — new in-zone buy/strong-buy names, until at capacity, cash permitting.
  let heldCount = survivingHeld.size;
  const heldSymbols = new Set(holdings.map((h) => h.symbol));
  const buyCandidates = reads
    .filter((r) => !heldSymbols.has(r.symbol) && BUYABLE.includes(r.rating))
    .filter((r) => r.entryHigh == null || r.price <= r.entryHigh)
    .sort((a, b) => (a.rating === "strong-buy" ? -1 : 1) - (b.rating === "strong-buy" ? -1 : 1));
  for (const r of buyCandidates) {
    if (heldCount >= maxPositions) break;
    if (r.price <= 0) continue;
    const spend = Math.min(target, availCash);
    if (spend <= 0) break;
    const shares = spend / r.price;
    if (shares <= 0) continue;
    buys.push({ kind: "buy", symbol: r.symbol, shares, estPrice: r.price, reason: `${r.rating} in accumulation zone` });
    availCash -= shares * r.price;
    heldCount += 1;
  }

  // ADD — underweight holdings (not avoid, not being sold) below target − band.
  for (const h of holdings) {
    if (!survivingHeld.has(h.symbol)) continue;
    const r = readBySymbol.get(h.symbol);
    if (r?.rating === "avoid") continue;
    const value = h.shares * h.price;
    if (value < target * (1 - band) && h.price > 0) {
      const want = target - value;
      const spend = Math.min(want, availCash);
      if (spend <= 0) continue;
      const shares = spend / h.price;
      if (shares <= 0) continue;
      adds.push({ kind: "add", symbol: h.symbol, shares, estPrice: h.price, reason: `underweight — top up toward target` });
      availCash -= shares * h.price;
    }
  }

  return [...sells, ...trims, ...buys, ...adds];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/invest/rebalance.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Type-check and commit**

Run `npx tsc --noEmit` (clean), then:
```bash
git add src/lib/invest/rebalance.ts src/lib/invest/rebalance.test.ts
git commit -m "feat: add pure invest rebalance planner"
```

---

## Task 3: `isInvestKind` guard

**Files:**
- Modify: `src/lib/portfolioGuards.ts`
- Test: `src/lib/portfolioGuards.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `src/lib/portfolioGuards.test.ts` (reuse the existing `test`/`assert` imports at the top of that file; add an import for `isInvestKind` to the existing `./portfolioGuards` import line):

```ts
test("isInvestKind: only the invest kind is an invest portfolio", () => {
  assert.equal(isInvestKind("invest"), true);
  assert.equal(isInvestKind("swing"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/portfolioGuards.test.ts`
Expected: FAIL — `isInvestKind` not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/portfolioGuards.ts`:

```ts
/** An invest portfolio is buy-and-hold (advisory rebalance), not the swing desk. */
export function isInvestKind(kind: string): boolean {
  return kind === "invest";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/portfolioGuards.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Type-check and commit**

Run `npx tsc --noEmit` (clean), then:
```bash
git add src/lib/portfolioGuards.ts src/lib/portfolioGuards.test.ts
git commit -m "feat: add isInvestKind guard"
```

---

## Task 4: Schema — Holding model, portfolio cash + band

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/app/api/portfolios/route.ts`

This task changes the DB; verified by `db push` + `db generate` + the portfolios POST initializing cash. There are no existing invest portfolios, so no backfill is needed (new columns are additive with defaults).

- [ ] **Step 1: Add the `Holding` model and Portfolio fields**

In `prisma/schema.prisma`, add the model (place it just below `model Portfolio`):

```prisma
/// A buy-and-hold position in an invest portfolio (avg-cost accounting).
model Holding {
  id          Int       @id @default(autoincrement())
  portfolio   Portfolio @relation(fields: [portfolioId], references: [id])
  portfolioId Int
  symbol      String
  shares      Float
  avgCost     Float
  status      String    @default("held") // held | sold
  realizedPnl Float     @default(0)
  openedAt    DateTime  @default(now())
  closedAt    DateTime?
  updatedAt   DateTime  @updatedAt
}
```

On `model Portfolio`, add these fields (with the other scalar fields) and the back-relation (with the other relation arrays):

```prisma
  cash             Float       @default(0)   // invest portfolio uninvested cash
  rebalanceBandPct Float       @default(5)   // drift % before TRIM/ADD
```
and
```prisma
  holdings         Holding[]
```

- [ ] **Step 2: Push the schema + regenerate the client**

Run: `npm run db:push` then `npm run db:generate`
Expected: schema syncs (additive columns + new table); client regenerates with `holding` model and the new Portfolio fields. If `db push` prompts interactively, it shouldn't for additive changes — if it errors, STOP and report.

- [ ] **Step 3: Initialize cash for new invest portfolios in the create route**

In `src/app/api/portfolios/route.ts`, the POST handler builds the `create` data. Change the `prisma.portfolio.create` so `cash` is set to the starting balance when `kind` is `invest`. Replace the `create` call with:

```ts
  const kind = typeof b.kind === "string" && b.kind.trim() ? b.kind.trim() : "swing";
  const startingBalance = b.startingBalance ?? 10000;
  const created = await prisma.portfolio.create({
    data: {
      name,
      kind,
      startingBalance,
      cash: kind === "invest" ? startingBalance : 0,
      riskPctPerTrade: b.riskPctPerTrade ?? 1,
      maxOpenPositions: b.maxOpenPositions ? Math.floor(b.maxOpenPositions) : 5,
      drawdownHaltPct: b.drawdownHaltPct ?? 10,
      sort: (maxSort._max.sort ?? 0) + 1,
    },
  });
```
(The `name`/`maxSort` lines above it stay; just ensure `kind` and `startingBalance` are computed once as shown and reused.)

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — clean.
Run: `npm test` — all still pass (no test depends on the new columns yet).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma src/app/api/portfolios/route.ts
git commit -m "feat: add Holding model + portfolio cash/rebalanceBandPct; init invest cash"
```

---

## Task 5: Executor — pure avg-cost helpers + DB `executeAction`

**Files:**
- Create: `src/lib/invest/execute.ts`
- Test: `src/lib/invest/execute.test.ts`

- [ ] **Step 1: Write the failing test (pure helpers)**

```ts
// src/lib/invest/execute.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buyInto, sellFrom } from "./execute";

test("buyInto: first buy sets shares and avgCost to the buy price", () => {
  const r = buyInto(0, 0, 10, 100);
  assert.equal(r.shares, 10);
  assert.equal(r.avgCost, 100);
});

test("buyInto: adding recomputes the weighted-average cost", () => {
  // hold 10 @ 100, add 10 @ 200 → 20 shares @ 150 avg
  const r = buyInto(10, 100, 10, 200);
  assert.equal(r.shares, 20);
  assert.ok(Math.abs(r.avgCost - 150) < 1e-9);
});

test("sellFrom: realized P/L is shares × (price − avgCost); avgCost unchanged", () => {
  // sell 4 of 10 @ avg 100 at price 120 → realized 4*20 = 80, 6 shares left
  const r = sellFrom(10, 100, 4, 120);
  assert.equal(r.shares, 6);
  assert.ok(Math.abs(r.realizedPnlDelta - 80) < 1e-9);
  assert.equal(r.sold, false);
});

test("sellFrom: selling all shares marks the holding sold", () => {
  const r = sellFrom(10, 100, 10, 90);
  assert.equal(r.shares, 0);
  assert.ok(Math.abs(r.realizedPnlDelta - -100) < 1e-9); // 10 * (90-100)
  assert.equal(r.sold, true);
});

test("sellFrom: selling more than held clamps to held shares", () => {
  const r = sellFrom(5, 100, 999, 110);
  assert.equal(r.shares, 0);
  assert.ok(Math.abs(r.realizedPnlDelta - 50) < 1e-9); // 5 * 10
  assert.equal(r.sold, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/invest/execute.test.ts`
Expected: FAIL — `Cannot find module './execute'`.

- [ ] **Step 3: Implement the pure helpers + the DB executor**

```ts
// src/lib/invest/execute.ts
// Applies one approved rebalance action to an invest portfolio's holdings + cash.
// Pure avg-cost helpers (buyInto/sellFrom) are unit-tested; executeAction wires
// them to the DB and re-prices at the live market price.

import { prisma } from "@/lib/db";
import { fetchCandles } from "@/lib/marketData";
import { isInvestKind } from "@/lib/portfolioGuards";
import type { ActionKind } from "./rebalance";

/** Weighted-average cost after buying `addShares` at `price`. */
export function buyInto(oldShares: number, oldAvg: number, addShares: number, price: number): { shares: number; avgCost: number } {
  const shares = oldShares + addShares;
  const avgCost = shares > 0 ? (oldShares * oldAvg + addShares * price) / shares : 0;
  return { shares, avgCost };
}

/** Result of selling `sellShares` (clamped to held) at `price`. avgCost is unchanged. */
export function sellFrom(oldShares: number, avgCost: number, sellShares: number, price: number): { shares: number; realizedPnlDelta: number; sold: boolean } {
  const qty = Math.min(sellShares, oldShares);
  const shares = oldShares - qty;
  return { shares, realizedPnlDelta: qty * (price - avgCost), sold: shares <= 0 };
}

export interface ExecuteAction { kind: ActionKind; symbol: string; shares: number }

/** Apply one action at the live price. Returns a short result note. */
export async function executeAction(portfolioId: number, action: ExecuteAction): Promise<{ ok: boolean; note: string }> {
  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) throw new Error(`portfolio ${portfolioId} not found`);
  if (!isInvestKind(portfolio.kind)) throw new Error("not an invest portfolio");
  if (!(action.shares > 0)) return { ok: false, note: "non-positive shares" };

  const resp = await fetchCandles(action.symbol, "1d", "5m");
  const price = resp.price ?? resp.candles.at(-1)?.c ?? null;
  if (price == null || !(price > 0)) return { ok: false, note: `no price for ${action.symbol}` };

  const existing = await prisma.holding.findFirst({ where: { portfolioId, symbol: action.symbol, status: "held" } });

  if (action.kind === "buy" || action.kind === "add") {
    const maxShares = portfolio.cash / price;
    const shares = Math.min(action.shares, maxShares);
    if (!(shares > 0)) return { ok: false, note: "insufficient cash" };
    const cost = shares * price;
    if (existing) {
      const next = buyInto(existing.shares, existing.avgCost, shares, price);
      await prisma.holding.update({ where: { id: existing.id }, data: { shares: next.shares, avgCost: next.avgCost } });
    } else {
      await prisma.holding.create({ data: { portfolioId, symbol: action.symbol, shares, avgCost: price } });
    }
    await prisma.portfolio.update({ where: { id: portfolioId }, data: { cash: portfolio.cash - cost } });
    return { ok: true, note: `${action.kind} ${shares.toFixed(4)} ${action.symbol} @ ${price.toFixed(2)}` };
  }

  // trim | sell
  if (!existing) return { ok: false, note: `no holding for ${action.symbol}` };
  const r = sellFrom(existing.shares, existing.avgCost, action.shares, price);
  await prisma.holding.update({
    where: { id: existing.id },
    data: {
      shares: r.shares,
      realizedPnl: existing.realizedPnl + r.realizedPnlDelta,
      status: r.sold ? "sold" : "held",
      closedAt: r.sold ? new Date() : null,
    },
  });
  const proceeds = (existing.shares - r.shares) * price;
  await prisma.portfolio.update({ where: { id: portfolioId }, data: { cash: portfolio.cash + proceeds } });
  return { ok: true, note: `${action.kind} ${(existing.shares - r.shares).toFixed(4)} ${action.symbol} @ ${price.toFixed(2)}` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/invest/execute.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Type-check and commit**

Run `npx tsc --noEmit` (clean), then:
```bash
git add src/lib/invest/execute.ts src/lib/invest/execute.test.ts
git commit -m "feat: add invest executor with pure avg-cost helpers"
```

---

## Task 6: Invest API routes + swing-route kind guards

**Files:**
- Create: `src/app/api/invest/plan/route.ts`
- Create: `src/app/api/invest/execute/route.ts`
- Create: `src/app/api/invest/execute-all/route.ts`
- Create: `src/app/api/invest/holdings/route.ts`
- Modify: `src/app/api/trade-tick/route.ts`, `src/app/api/scan-all/route.ts`, `src/app/api/scan-universe/route.ts`

- [ ] **Step 1: Create `src/app/api/invest/holdings/route.ts`**

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isInvestKind } from "@/lib/portfolioGuards";
import { computeInvestStats } from "@/lib/invest/investStats";
import { fetchCandles } from "@/lib/marketData";

export const dynamic = "force-dynamic";

async function priceMap(symbols: string[]): Promise<(s: string) => number | null> {
  const entries = await Promise.all(symbols.map(async (sym) => {
    try { const r = await fetchCandles(sym, "1d", "5m"); return [sym, r.price ?? r.candles.at(-1)?.c ?? null] as const; }
    catch { return [sym, null] as const; }
  }));
  const m = new Map(entries);
  return (s: string) => m.get(s) ?? null;
}

export async function GET(req: Request) {
  const portfolioId = Number(new URL(req.url).searchParams.get("portfolioId"));
  if (!Number.isInteger(portfolioId)) return NextResponse.json({ error: "portfolioId is required" }, { status: 400 });
  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) return NextResponse.json({ error: "portfolio not found" }, { status: 404 });
  if (!isInvestKind(portfolio.kind)) return NextResponse.json({ error: "not an invest portfolio" }, { status: 409 });

  const holdings = await prisma.holding.findMany({ where: { portfolioId }, orderBy: { symbol: "asc" } });
  const heldSymbols = holdings.filter((h) => h.status === "held").map((h) => h.symbol);
  const priceOf = await priceMap(heldSymbols);
  const stats = computeInvestStats(holdings, priceOf, portfolio.cash);
  const held = holdings.filter((h) => h.status === "held").map((h) => ({
    ...h, price: priceOf(h.symbol), marketValue: h.shares * (priceOf(h.symbol) ?? h.avgCost),
  }));
  return NextResponse.json({ stats, holdings: held, maxPositions: portfolio.maxOpenPositions });
}
```

- [ ] **Step 2: Create `src/app/api/invest/plan/route.ts`**

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isInvestKind } from "@/lib/portfolioGuards";
import { getWatchlist } from "@/lib/trading/watchlist";
import { analyzeLongTerm } from "@/lib/invest/analyze";
import { computeInvestStats } from "@/lib/invest/investStats";
import { planRebalance, type CommitteeRead, type PlannerHolding, type Rating } from "@/lib/invest/rebalance";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const portfolioId = Number(body.portfolioId);
  if (!Number.isInteger(portfolioId)) return NextResponse.json({ error: "portfolioId is required" }, { status: 400 });
  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) return NextResponse.json({ error: "portfolio not found" }, { status: 404 });
  if (!isInvestKind(portfolio.kind)) return NextResponse.json({ error: "not an invest portfolio" }, { status: 409 });

  const holdings = await prisma.holding.findMany({ where: { portfolioId, status: "held" } });
  const watch = (await getWatchlist(portfolioId)).filter((w) => w.enabled).map((w) => w.symbol);
  const symbols = [...new Set([...watch, ...holdings.map((h) => h.symbol)])];

  // Committee read per symbol (skip failures so one bad symbol doesn't block the plan).
  const reads: CommitteeRead[] = [];
  const priceBySymbol = new Map<string, number>();
  for (const sym of symbols) {
    try {
      const r = await analyzeLongTerm(sym);
      reads.push({ symbol: r.symbol, rating: r.verdict.rating as Rating, entryHigh: r.verdict.entryHigh, price: r.price });
      priceBySymbol.set(r.symbol, r.price);
    } catch (e) {
      console.error(`invest/plan: skipping ${sym} —`, e);
    }
  }

  const priceOf = (s: string) => priceBySymbol.get(s) ?? null;
  const stats = computeInvestStats(holdings, priceOf, portfolio.cash);
  const plannerHoldings: PlannerHolding[] = holdings
    .filter((h) => priceBySymbol.has(h.symbol))
    .map((h) => ({ symbol: h.symbol, shares: h.shares, avgCost: h.avgCost, price: priceBySymbol.get(h.symbol)! }));

  const actions = planRebalance({
    holdings: plannerHoldings,
    reads,
    maxPositions: portfolio.maxOpenPositions,
    bandPct: portfolio.rebalanceBandPct,
    cash: portfolio.cash,
    equity: stats.equity,
  });

  return NextResponse.json({ stats, actions });
}
```

- [ ] **Step 3: Create `src/app/api/invest/execute/route.ts`**

```ts
import { NextResponse } from "next/server";
import { executeAction, type ExecuteAction } from "@/lib/invest/execute";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { portfolioId?: number; action?: ExecuteAction };
  const portfolioId = Number(body.portfolioId);
  if (!Number.isInteger(portfolioId)) return NextResponse.json({ error: "portfolioId is required" }, { status: 400 });
  if (!body.action || typeof body.action.symbol !== "string") return NextResponse.json({ error: "action is required" }, { status: 400 });
  try {
    const result = await executeAction(portfolioId, body.action);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 409 });
  }
}
```

- [ ] **Step 4: Create `src/app/api/invest/execute-all/route.ts`**

```ts
import { NextResponse } from "next/server";
import { executeAction, type ExecuteAction } from "@/lib/invest/execute";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { portfolioId?: number; actions?: ExecuteAction[] };
  const portfolioId = Number(body.portfolioId);
  if (!Number.isInteger(portfolioId)) return NextResponse.json({ error: "portfolioId is required" }, { status: 400 });
  const actions = Array.isArray(body.actions) ? body.actions : [];
  // Plan order already has sells/trims before buys/adds; execute as given so cash frees up first.
  const results: { note: string; ok: boolean }[] = [];
  for (const action of actions) {
    try { results.push(await executeAction(portfolioId, action)); }
    catch (e) { results.push({ ok: false, note: String(e) }); }
  }
  return NextResponse.json({ results });
}
```

- [ ] **Step 5: Reject invest portfolios from the swing routes**

In each of `src/app/api/trade-tick/route.ts`, `src/app/api/scan-all/route.ts`, `src/app/api/scan-universe/route.ts`: they already fetch `portfolio` and call `canPortfolioTrade(portfolio.status)`. Add the invest import and a guard right after the archived check.

Add to the imports (these files already import from `@/lib/portfolioGuards`):
```ts
import { canPortfolioTrade, isInvestKind } from "@/lib/portfolioGuards";
```
And immediately after the existing `if (!canPortfolioTrade(portfolio.status)) ...` line, add:
```ts
  if (isInvestKind(portfolio.kind)) return Response.json({ error: "swing routes do not run on an invest portfolio" }, { status: 409 });
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit` — clean.
Run: `npm test` — all pass.
Smoke (dev server on 3275; create an invest portfolio then plan):
```bash
curl -s -X POST http://localhost:3275/api/portfolios -H "Content-Type: application/json" -d '{"name":"Invest Test","kind":"invest","startingBalance":10000}'
# note the returned id, then:
curl -s "http://localhost:3275/api/invest/holdings?portfolioId=<id>" -o /dev/null -w "holdings %{http_code}\n"
curl -s -X POST http://localhost:3275/api/invest/plan -H "Content-Type: application/json" -d '{"portfolioId":<id>}' -o /dev/null -w "plan %{http_code}\n"
```
Expected: `holdings 200`; `plan 200` (empty/short plan if mock mode / empty watchlist). Stop the dev server after.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/invest src/app/api/trade-tick/route.ts src/app/api/scan-all/route.ts src/app/api/scan-universe/route.ts
git commit -m "feat: invest plan/execute/holdings API; reject invest from swing routes"
```

---

## Task 7: Invest page portfolio mode (UI)

**Files:**
- Modify: `src/app/invest/page.tsx`

Keep the existing single-symbol research tool. Add a portfolio-management section above it.

- [ ] **Step 1: Add the portfolio-mode UI**

At the top of `src/app/invest/page.tsx`'s `InvestPage` component (it is already `"use client"`), add state + effects that:
- On mount, `GET /api/portfolios` and keep those with `kind === "invest"` in `investPortfolios`; default `selectedId` to the first one (or null).
- When `selectedId` changes, `GET /api/invest/holdings?portfolioId=<id>` into `holdings` + `stats` + `maxPositions`.
- A "Generate rebalance plan" button → `POST /api/invest/plan {portfolioId}` into `plan` (array of actions) + refreshes stats.
- Each action row has an **Approve** button → `POST /api/invest/execute {portfolioId, action}` then reload holdings + plan; and an **Approve all** button → `POST /api/invest/execute-all {portfolioId, actions}` then reload.

Add this section (rendered above the existing research `<Card>`), using the project's `Card`/`CardTitle`/`Button`/`Badge`/`Stat`/`Empty` primitives. Use these types and helpers:

```tsx
interface InvestPortfolio { id: number; name: string; kind: string; cash: number; maxOpenPositions: number }
interface HeldRow { id: number; symbol: string; shares: number; avgCost: number; price: number | null; marketValue: number; realizedPnl: number }
interface InvestStatsT { cash: number; marketValue: number; equity: number; unrealizedPnl: number; realizedPnl: number; missingPrices: string[] }
interface PlanAction { kind: "buy" | "add" | "trim" | "sell"; symbol: string; shares: number; estPrice: number; reason: string }

const actionTone: Record<PlanAction["kind"], "positive" | "negative" | "warning" | "info"> = {
  buy: "positive", add: "info", trim: "warning", sell: "negative",
};
```

State and data flow (add inside the component, before `return`):

```tsx
  const [investPortfolios, setInvestPortfolios] = useState<InvestPortfolio[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [held, setHeld] = useState<HeldRow[]>([]);
  const [pstats, setPstats] = useState<InvestStatsT | null>(null);
  const [targetCount, setTargetCount] = useState(0);
  const [plan, setPlan] = useState<PlanAction[] | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [actingIdx, setActingIdx] = useState<number | null>(null);

  useEffect(() => {
    void fetch("/api/portfolios").then((r) => r.json()).then((list: InvestPortfolio[]) => {
      const invest = (Array.isArray(list) ? list : []).filter((p) => p.kind === "invest");
      setInvestPortfolios(invest);
      setSelectedId((cur) => cur ?? invest[0]?.id ?? null);
    });
  }, []);

  const loadHoldings = useCallback(async (id: number) => {
    const d = await fetch(`/api/invest/holdings?portfolioId=${id}`).then((r) => r.json());
    setHeld(d.holdings ?? []); setPstats(d.stats ?? null); setTargetCount(d.maxPositions ?? 0);
  }, []);
  useEffect(() => { if (selectedId != null) void loadHoldings(selectedId); }, [selectedId, loadHoldings]);

  async function generatePlan() {
    if (selectedId == null || planBusy) return;
    setPlanBusy(true); setPlan(null);
    try {
      const d = await fetch("/api/invest/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ portfolioId: selectedId }) }).then((r) => r.json());
      setPlan(d.actions ?? []); if (d.stats) setPstats(d.stats);
    } finally { setPlanBusy(false); }
  }

  async function approve(action: PlanAction, idx: number) {
    if (selectedId == null) return;
    setActingIdx(idx);
    try {
      await fetch("/api/invest/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ portfolioId: selectedId, action }) });
      await loadHoldings(selectedId);
      setPlan((p) => (p ? p.filter((_, i) => i !== idx) : p));
    } finally { setActingIdx(null); }
  }

  async function approveAll() {
    if (selectedId == null || !plan || plan.length === 0) return;
    setPlanBusy(true);
    try {
      await fetch("/api/invest/execute-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ portfolioId: selectedId, actions: plan }) });
      await loadHoldings(selectedId); setPlan(null);
    } finally { setPlanBusy(false); }
  }
```

Add `useCallback` and `useEffect` to the React import at the top (it currently imports `useState`): `import { useState, useEffect, useCallback } from "react";`

Render the portfolio section (place it directly after `<PageHeader .../>`, before the existing research `<Card className="mb-5">`):

```tsx
      {investPortfolios.length > 0 ? (
        <Card className="mb-5">
          <div className="flex items-center justify-between gap-2 mb-3">
            <CardTitle>📈 Invest portfolio</CardTitle>
            <select
              value={selectedId ?? ""}
              onChange={(e) => setSelectedId(Number(e.target.value))}
              className="h-9 rounded-md border border-(--color-border) bg-(--color-background) px-2 text-sm"
            >
              {investPortfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {pstats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <Stat label="Equity" value={f(pstats.equity, 0)} />
              <Stat label="Cash" value={f(pstats.cash, 0)} />
              <Stat label="Unrealized P/L" value={f(pstats.unrealizedPnl, 0)} />
              <Stat label="Realized P/L" value={f(pstats.realizedPnl, 0)} />
            </div>
          )}

          {held.length > 0 ? (
            <div className="space-y-1 mb-4">
              {held.map((h) => (
                <div key={h.id} className="flex items-center justify-between text-xs font-mono border-b border-(--color-border) py-1">
                  <span className="font-semibold">{h.symbol}</span>
                  <span className="text-(--color-muted)">{f(h.shares, 4)} @ {f(h.avgCost, 2)}</span>
                  <span>{h.price == null ? "—" : f(h.price, 2)}</span>
                  <span>{f(h.marketValue, 0)}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-(--color-muted) mb-4">No holdings yet — generate a plan to start buying.</p>}

          <div className="flex items-center gap-2">
            <Button onClick={generatePlan} disabled={planBusy}>{planBusy ? "Analyzing…" : "Generate rebalance plan"}</Button>
            {plan && plan.length > 0 && <Button variant="outline" onClick={approveAll} disabled={planBusy}>Approve all</Button>}
          </div>

          {plan && plan.length === 0 && <p className="mt-3 text-xs text-(--color-muted)">No actions — the portfolio is balanced.</p>}
          {plan && plan.length > 0 && (
            <div className="mt-3 space-y-2">
              {plan.map((a, i) => (
                <div key={`${a.kind}-${a.symbol}-${i}`} className="flex items-center justify-between gap-2 rounded-md border border-(--color-border) px-3 py-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Badge tone={actionTone[a.kind]}>{a.kind.toUpperCase()}</Badge>
                    <span className="font-mono font-semibold">{a.symbol}</span>
                    <span className="text-(--color-muted) text-xs">{f(a.shares, 4)} @ ~{f(a.estPrice, 2)} · {a.reason}</span>
                  </div>
                  <Button size="sm" disabled={actingIdx === i} onClick={() => approve(a, i)}>{actingIdx === i ? "…" : "Approve"}</Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : null}
```

(The existing `f`/`pct` helpers and `Card`/`CardTitle`/`Button`/`Badge`/`Stat`/`Empty` imports are already present at the top of the file — reuse them. If `Stat` is not imported, add it to the existing `@/components/ui` import.)

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` — clean.
Run: `npm test` — all pass.
Smoke: `npm run dev`, then:
```bash
curl -s "http://localhost:3275/invest" -o /dev/null -w "invest %{http_code}\n"
```
Expected: `invest 200`. If you created an "Invest Test" portfolio during Task 6, the page should render its (empty) holdings + a working "Generate rebalance plan" button. Stop the dev server after.

- [ ] **Step 3: Commit**

```bash
git add src/app/invest/page.tsx
git commit -m "feat: invest portfolio mode — holdings + advisory rebalance approval UI"
```

---

## Self-Review Notes

- **Spec coverage:** `Holding` model + `cash`/`rebalanceBandPct` (Task 4); pure MTM `computeInvestStats` (Task 1); pure `planRebalance` with BUY/ADD/TRIM/SELL + ordering (Task 2); avg-cost executor + `buyInto`/`sellFrom` (Task 5); advisory API plan/execute/execute-all/holdings (Task 6); swing routes reject invest + invest routes reject non-invest via `isInvestKind` (Tasks 3, 5, 6); UI portfolio mode with per-action + approve-all (Task 7); cash init for invest portfolios (Task 4). All spec sections map to a task.
- **Type consistency:** `InvestHolding`/`InvestStats` (Task 1); `Rating`/`ActionKind`/`PlannerHolding`/`CommitteeRead`/`RebalanceInput`/`RebalanceAction`/`planRebalance` (Task 2) reused in Tasks 6–7; `isInvestKind` (Task 3) used in Tasks 5–6; `buyInto`/`sellFrom`/`ExecuteAction`/`executeAction` (Task 5) used in Task 6; `analyzeLongTerm` returns `{ price, verdict: { rating, entryHigh } }` (confirmed in `analyze.ts`) consumed in Task 6. The plan's `RebalanceAction` (has `estPrice`/`reason`) is a superset of the executor's `ExecuteAction` (`kind`/`symbol`/`shares`), so passing a plan action to execute is structurally valid.
- **No placeholders:** every code step has complete code or an exact edit; commands include expected output.
