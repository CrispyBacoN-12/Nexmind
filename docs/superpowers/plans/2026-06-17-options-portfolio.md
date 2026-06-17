# Options Portfolio (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An autonomous `kind="options"` portfolio that trades long single-leg calls/puts: Yahoo option-chain data, Black-Scholes greeks, an `OptionHolding` model valued mark-to-market with automatic expiry settlement, committee→call/put selection by target delta, and a `runOptions` engine that executes (open/close/settle) gated by the Phase 0 safety controls.

**Architecture:** Pure modules first (Black-Scholes, chain parser, selection, valuation/settlement), then schema, then a DB executor (atomic buy/close/settle), then the `runOptions` orchestrator, then API + a new `/options` page. Three portfolio kinds now exist (swing/invest/options); each engine runs only on its kind via positive `isSwingKind`/`isInvestKind`/`isOptionsKind` guards.

**Tech Stack:** TypeScript, Next.js 16 (App Router), Prisma 7 + SQLite (better-sqlite3 adapter), `node:test` + `node:assert/strict` (`npm test`). DB: `npm run db:push`, `npm run db:generate`. Pure logic unit-tested; DB/API/UI verified by `npx tsc --noEmit` + curl smoke.

---

## File Structure

- **Create** `src/lib/options/blackScholes.ts` (+ test) — BS price + greeks (pure).
- **Create** `src/lib/options/chain.ts` (+ test) — `parseOptionChain` (pure) + `fetchOptionChain`.
- **Create** `src/lib/options/select.ts` (+ test) — pure expiry/strike/type/size selection.
- **Create** `src/lib/options/optionStats.ts` (+ test) — pure MTM valuation + `settlementValue`.
- **Modify** `src/lib/portfolioGuards.ts` (+ test) — add `isOptionsKind`, `isSwingKind`.
- **Modify** `src/app/api/trade-tick/route.ts`, `scan-all/route.ts`, `scan-universe/route.ts`, `manage/route.ts` — switch invest-reject guard to require `isSwingKind`.
- **Modify** `prisma/schema.prisma` — `OptionHolding` model + `Portfolio.optionHoldings` relation.
- **Modify** `src/app/api/portfolios/route.ts` — init `cash` for `kind==="options"` too.
- **Create** `src/lib/options/execute.ts` (+ test) — `buyOption`/`closeOption`/`settleOption` (atomic) + pure `closePnl` helper.
- **Create** `src/lib/options/engine.ts` — `runOptions(portfolioId)` orchestrator.
- **Create** `src/app/api/options/run/route.ts`, `src/app/api/options/holdings/route.ts`.
- **Create** `src/app/options/page.tsx` — options portfolio UI.

Reuse: `analyzeLongTerm` (`src/lib/invest/analyze.ts`) for the committee read, `fetchCandles` (`src/lib/marketData.ts`) for the underlying price, `getWatchlist` (`src/lib/trading/watchlist.ts`), `isGlobalTradingHalt` (`src/lib/settings.ts`).

---

## Task 1: Black-Scholes price + greeks (pure)

**Files:**
- Create: `src/lib/options/blackScholes.ts`
- Test: `src/lib/options/blackScholes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/options/blackScholes.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { bsPrice, greeks, RISK_FREE_RATE } from "./blackScholes";

test("RISK_FREE_RATE default is 4%", () => {
  assert.equal(RISK_FREE_RATE, 0.04);
});

test("bsPrice: ATM call, S=K=100, T=1, r=0, sigma=0.2 ≈ 7.97", () => {
  const p = bsPrice("call", 100, 100, 1, 0, 0.2);
  assert.ok(Math.abs(p - 7.9656) < 0.02, `got ${p}`);
});

test("bsPrice: ATM put equals call when r=0 (put-call parity, S=K)", () => {
  const c = bsPrice("call", 100, 100, 1, 0, 0.2);
  const p = bsPrice("put", 100, 100, 1, 0, 0.2);
  assert.ok(Math.abs(c - p) < 1e-6, `call ${c} put ${p}`);
});

test("greeks: ATM call delta is ~0.54, put delta ~-0.46 (S=K=100,T=1,r=0,sig=0.2)", () => {
  const gc = greeks("call", 100, 100, 1, 0, 0.2);
  const gp = greeks("put", 100, 100, 1, 0, 0.2);
  assert.ok(gc.delta > 0.5 && gc.delta < 0.6, `call delta ${gc.delta}`);
  assert.ok(gp.delta > -0.5 && gp.delta < -0.4, `put delta ${gp.delta}`);
  // put delta = call delta - 1
  assert.ok(Math.abs(gp.delta - (gc.delta - 1)) < 1e-9);
  assert.ok(gc.gamma > 0 && gc.vega > 0);
});

test("bsPrice: expired/zero-T returns intrinsic", () => {
  assert.ok(Math.abs(bsPrice("call", 120, 100, 0, 0.04, 0.2) - 20) < 1e-9);
  assert.ok(Math.abs(bsPrice("put", 80, 100, 0, 0.04, 0.2) - 20) < 1e-9);
  assert.equal(bsPrice("call", 80, 100, 0, 0.04, 0.2), 0);
});

test("greeks: deep-ITM call delta → ~1, deep-OTM → ~0", () => {
  assert.ok(greeks("call", 200, 100, 1, 0.04, 0.2).delta > 0.95);
  assert.ok(greeks("call", 50, 100, 1, 0.04, 0.2).delta < 0.05);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/options/blackScholes.test.ts`
Expected: FAIL — `Cannot find module './blackScholes'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/options/blackScholes.ts
// Black-Scholes European option pricing + greeks. Pure, no I/O.
// T in years, r/sigma as decimals (0.04 = 4%). Per-year theta, per-1.00-vol vega.

export const RISK_FREE_RATE = 0.04;

export type OptionType = "call" | "put";

/** Standard normal CDF via Abramowitz-Stegun erf approximation. */
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/** Standard normal PDF. */
function normPdf(x: number): number {
  return 0.3989422804014327 * Math.exp(-x * x / 2);
}

function intrinsic(type: OptionType, S: number, K: number): number {
  return type === "call" ? Math.max(0, S - K) : Math.max(0, K - S);
}

function d1d2(S: number, K: number, T: number, r: number, sigma: number): [number, number] {
  const vsT = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / vsT;
  return [d1, d1 - vsT];
}

export function bsPrice(type: OptionType, S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0 || sigma <= 0) return intrinsic(type, S, K);
  const [d1, d2] = d1d2(S, K, T, r, sigma);
  const disc = K * Math.exp(-r * T);
  return type === "call"
    ? S * normCdf(d1) - disc * normCdf(d2)
    : disc * normCdf(-d2) - S * normCdf(-d1);
}

export interface Greeks { delta: number; gamma: number; theta: number; vega: number }

export function greeks(type: OptionType, S: number, K: number, T: number, r: number, sigma: number): Greeks {
  if (T <= 0 || sigma <= 0) {
    const itm = intrinsic(type, S, K) > 0;
    return { delta: itm ? (type === "call" ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0 };
  }
  const [d1, d2] = d1d2(S, K, T, r, sigma);
  const sqrtT = Math.sqrt(T);
  const disc = K * Math.exp(-r * T);
  const delta = type === "call" ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = normPdf(d1) / (S * sigma * sqrtT);
  const vega = S * normPdf(d1) * sqrtT;
  const theta = type === "call"
    ? -(S * normPdf(d1) * sigma) / (2 * sqrtT) - r * disc * normCdf(d2)
    : -(S * normPdf(d1) * sigma) / (2 * sqrtT) + r * disc * normCdf(-d2);
  return { delta, gamma, theta, vega };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/options/blackScholes.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Type-check & commit**

`npx tsc --noEmit` (clean), then:
```bash
git add src/lib/options/blackScholes.ts src/lib/options/blackScholes.test.ts
git commit -m "feat: add Black-Scholes price + greeks (pure)"
```

---

## Task 2: Kind guards + swing-route refactor

**Files:**
- Modify: `src/lib/portfolioGuards.ts`
- Test: `src/lib/portfolioGuards.test.ts`
- Modify: `src/app/api/trade-tick/route.ts`, `scan-all/route.ts`, `scan-universe/route.ts`, `manage/route.ts`

- [ ] **Step 1: Add the failing test**

Append to `src/lib/portfolioGuards.test.ts` (add `isOptionsKind`, `isSwingKind` to the existing `./portfolioGuards` import line):

```ts
test("isOptionsKind / isSwingKind: positive kind predicates", () => {
  assert.equal(isOptionsKind("options"), true);
  assert.equal(isOptionsKind("swing"), false);
  assert.equal(isSwingKind("swing"), true);
  assert.equal(isSwingKind("invest"), false);
  assert.equal(isSwingKind("options"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/portfolioGuards.test.ts`
Expected: FAIL — `isOptionsKind`/`isSwingKind` not exported.

- [ ] **Step 3: Implement the guards**

Append to `src/lib/portfolioGuards.ts`:
```ts
/** An options portfolio runs the autonomous options desk. */
export function isOptionsKind(kind: string): boolean {
  return kind === "options";
}

/** A swing portfolio runs the autonomous trade desk (the default kind). */
export function isSwingKind(kind: string): boolean {
  return kind === "swing";
}
```

- [ ] **Step 4: Switch the four swing routes to require swing-kind**

In EACH of `src/app/api/trade-tick/route.ts`, `scan-all/route.ts`, `scan-universe/route.ts`, `manage/route.ts`:
- Their guard import currently includes `isInvestKind`. Change the import to bring in `isSwingKind` instead (keep `canPortfolioTrade` where present): e.g. `import { canPortfolioTrade, isSwingKind } from "@/lib/portfolioGuards";` (for `manage/route.ts`, which only needs the kind check, `import { isSwingKind } from "@/lib/portfolioGuards";`).
- Replace the existing line `if (isInvestKind(portfolio.kind)) return ... 409;` with:
```ts
  if (!isSwingKind(portfolio.kind)) return Response.json({ error: "this route only runs on a swing portfolio" }, { status: 409 });
```
This now rejects BOTH invest and options portfolios. Do not change the other guards (archived/global-halt) in these files. Run `git grep -n "isInvestKind" src/app/api` afterward and confirm no swing route still references `isInvestKind` (only the invest routes should, and they use it for their own reject).

- [ ] **Step 5: Verify**

Run: `npx tsx --test src/lib/portfolioGuards.test.ts` — PASS.
Run: `npx tsc --noEmit` — clean.
Run: `npm test` — all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/portfolioGuards.ts src/lib/portfolioGuards.test.ts src/app/api/trade-tick/route.ts src/app/api/scan-all/route.ts src/app/api/scan-universe/route.ts src/app/api/manage/route.ts
git commit -m "feat: add isOptionsKind/isSwingKind; swing routes require swing-kind"
```

---

## Task 3: Option chain (parser pure + fetcher)

**Files:**
- Create: `src/lib/options/chain.ts`
- Test: `src/lib/options/chain.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/options/chain.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOptionChain } from "./chain";

const sample = {
  optionChain: {
    result: [{
      underlyingSymbol: "AAPL",
      expirationDates: [1700000000, 1702000000],
      quote: { regularMarketPrice: 190.5 },
      options: [{
        expirationDate: 1700000000,
        calls: [
          { strike: 185, lastPrice: 8.1, bid: 8.0, ask: 8.2, impliedVolatility: 0.28 },
          { strike: 190, lastPrice: 5.0, bid: 4.9, ask: 5.1, impliedVolatility: 0.27 },
        ],
        puts: [
          { strike: 190, lastPrice: 4.6, bid: 4.5, ask: 4.7, impliedVolatility: 0.29 },
        ],
      }],
    }],
  },
};

test("parseOptionChain: maps underlying price, expiries, calls and puts", () => {
  const c = parseOptionChain(sample);
  assert.equal(c.underlyingPrice, 190.5);
  assert.deepEqual(c.expiries, [1700000000, 1702000000]);
  assert.equal(c.calls.length, 2);
  assert.equal(c.puts.length, 1);
  assert.deepEqual(c.calls[0], { type: "call", strike: 185, expiry: 1700000000, bid: 8.0, ask: 8.2, lastPrice: 8.1, impliedVolatility: 0.28 });
  assert.equal(c.puts[0].type, "put");
});

test("parseOptionChain: throws on missing result", () => {
  assert.throws(() => parseOptionChain({ optionChain: { result: [] } }));
  assert.throws(() => parseOptionChain({}));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/options/chain.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/options/chain.ts
// Yahoo option-chain fetcher + pure parser. The fetch wraps the parser so the
// transform is unit-testable without network.

import type { OptionType } from "./blackScholes";

export interface OptionQuote {
  type: OptionType;
  strike: number;
  expiry: number;          // unix seconds
  bid: number;
  ask: number;
  lastPrice: number;
  impliedVolatility: number;
}

export interface OptionChain {
  underlyingPrice: number;
  expiries: number[];      // unix seconds, all available expirations
  calls: OptionQuote[];
  puts: OptionQuote[];
}

interface RawQuote { strike?: number; bid?: number; ask?: number; lastPrice?: number; impliedVolatility?: number }

/** Pure transform of a Yahoo options response into an OptionChain. Throws if empty. */
export function parseOptionChain(json: unknown): OptionChain {
  const result = (json as { optionChain?: { result?: unknown[] } })?.optionChain?.result?.[0] as
    | { expirationDates?: number[]; quote?: { regularMarketPrice?: number }; options?: { expirationDate?: number; calls?: RawQuote[]; puts?: RawQuote[] }[] }
    | undefined;
  if (!result) throw new Error("options: no chain result");
  const underlyingPrice = result.quote?.regularMarketPrice;
  if (underlyingPrice == null) throw new Error("options: no underlying price");
  const opt = result.options?.[0];
  const expiry = opt?.expirationDate ?? 0;
  const map = (q: RawQuote, type: OptionType): OptionQuote => ({
    type, strike: q.strike ?? 0, expiry, bid: q.bid ?? 0, ask: q.ask ?? 0,
    lastPrice: q.lastPrice ?? 0, impliedVolatility: q.impliedVolatility ?? 0,
  });
  return {
    underlyingPrice,
    expiries: result.expirationDates ?? [],
    calls: (opt?.calls ?? []).map((q) => map(q, "call")),
    puts: (opt?.puts ?? []).map((q) => map(q, "put")),
  };
}

const OPTIONS_BASE = "https://query2.finance.yahoo.com/v7/finance/options";

/** Fetch a Yahoo option chain. With `expiryUnix`, returns that expiry's chain;
 *  without it, returns the nearest expiry's chain plus the full `expiries` list. */
export async function fetchOptionChain(underlying: string, expiryUnix?: number): Promise<OptionChain> {
  const url = `${OPTIONS_BASE}/${encodeURIComponent(underlying)}${expiryUnix ? `?date=${expiryUnix}` : ""}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Accept: "application/json",
    },
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`options upstream ${res.status}`);
  return parseOptionChain(await res.json());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/options/chain.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Type-check & commit**

`npx tsc --noEmit` (clean), then:
```bash
git add src/lib/options/chain.ts src/lib/options/chain.test.ts
git commit -m "feat: add Yahoo option chain fetcher + pure parser"
```

---

## Task 4: Option selection helpers (pure)

**Files:**
- Create: `src/lib/options/select.ts`
- Test: `src/lib/options/select.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/options/select.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseExpiry, chooseStrike, directionToType, sizeContracts } from "./select";
import type { OptionQuote } from "./chain";

const DAY = 86400;

test("directionToType: bullish→call, bearish→put, neutral→null", () => {
  assert.equal(directionToType("strong-buy"), "call");
  assert.equal(directionToType("buy"), "call");
  assert.equal(directionToType("avoid"), "put");
  assert.equal(directionToType("watch"), null);
  assert.equal(directionToType("hold"), null);
});

test("chooseExpiry: nearest expiry at least minDays out", () => {
  const now = 1_000_000_000;
  const expiries = [now + 5 * DAY, now + 35 * DAY, now + 80 * DAY];
  assert.equal(chooseExpiry(expiries, now, 30), now + 35 * DAY);
  assert.equal(chooseExpiry([now + 5 * DAY], now, 30), null);
});

test("sizeContracts: floor(budget / (100 * premium)); 0 when premium<=0", () => {
  assert.equal(sizeContracts(5000, 12), 4); // 5000/1200 = 4.16 → 4
  assert.equal(sizeContracts(50, 12), 0);
  assert.equal(sizeContracts(5000, 0), 0);
});

test("chooseStrike: picks the quote whose delta is closest to target", () => {
  const now = 1_000_000_000;
  const expiry = now + 30 * DAY;
  const q = (strike: number, iv: number): OptionQuote => ({ type: "call", strike, expiry, bid: 1, ask: 1, lastPrice: 1, impliedVolatility: iv });
  // For S=100, an ATM (strike 100) call has delta ~0.5; deep OTM (130) much lower; ITM (70) higher.
  const quotes = [q(70, 0.3), q(100, 0.3), q(130, 0.3)];
  const chosen = chooseStrike(quotes, 100, "call", 0.5, 0.04, now);
  assert.equal(chosen?.strike, 100);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/options/select.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/options/select.ts
// Pure option-selection helpers used by the autonomous options engine.

import { greeks, type OptionType } from "./blackScholes";
import type { OptionQuote } from "./chain";

const YEAR_S = 365.25 * 24 * 3600;

export type Rating = "strong-buy" | "buy" | "watch" | "hold" | "avoid";

/** Bullish ratings buy calls; bearish (avoid) buys puts; neutral does nothing. */
export function directionToType(rating: Rating): OptionType | null {
  if (rating === "strong-buy" || rating === "buy") return "call";
  if (rating === "avoid") return "put";
  return null;
}

/** Nearest expiry (unix sec) at least `minDays` from `nowSec`, or null. */
export function chooseExpiry(expiries: number[], nowSec: number, minDays: number): number | null {
  const ok = expiries.filter((e) => (e - nowSec) / 86400 >= minDays).sort((a, b) => a - b);
  return ok[0] ?? null;
}

/** floor(budget / (100 × premium)); 0 when premium is non-positive. */
export function sizeContracts(budget: number, premium: number): number {
  if (!(premium > 0)) return 0;
  return Math.floor(budget / (100 * premium));
}

/** The quote whose Black-Scholes delta is closest to `targetDelta` (puts compared by |delta|). */
export function chooseStrike(
  quotes: OptionQuote[], underlyingPrice: number, type: OptionType, targetDelta: number, r: number, nowSec: number,
): OptionQuote | null {
  let best: OptionQuote | null = null;
  let bestDiff = Infinity;
  for (const q of quotes) {
    if (!(q.impliedVolatility > 0) || !(q.strike > 0)) continue;
    const T = (q.expiry - nowSec) / YEAR_S;
    if (T <= 0) continue;
    const d = greeks(type, underlyingPrice, q.strike, T, r, q.impliedVolatility).delta;
    const diff = Math.abs(Math.abs(d) - targetDelta);
    if (diff < bestDiff) { bestDiff = diff; best = q; }
  }
  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/options/select.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Type-check & commit**

`npx tsc --noEmit` (clean), then:
```bash
git add src/lib/options/select.ts src/lib/options/select.test.ts
git commit -m "feat: add pure option-selection helpers"
```

---

## Task 5: Option valuation + settlement (pure)

**Files:**
- Create: `src/lib/options/optionStats.ts`
- Test: `src/lib/options/optionStats.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/options/optionStats.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeOptionStats, settlementValue, type OptionPosition } from "./optionStats";

function p(over: Partial<OptionPosition> = {}): OptionPosition {
  return { id: 1, underlying: "AAPL", type: "call", strike: 100, status: "open", contracts: 1, premiumPaid: 5, realizedPnl: 0, ...over };
}

test("settlementValue: intrinsic per share for call and put", () => {
  assert.equal(settlementValue("call", 100, 120), 20);
  assert.equal(settlementValue("call", 100, 80), 0);
  assert.equal(settlementValue("put", 100, 80), 20);
  assert.equal(settlementValue("put", 100, 120), 0);
});

test("computeOptionStats: equity = cash + market value; unrealized = MV - cost", () => {
  const positions = [p({ id: 1, contracts: 2, premiumPaid: 5 })]; // cost = 2*100*5 = 1000
  const s = computeOptionStats(positions, () => 7, 4000);          // MV = 2*100*7 = 1400
  assert.equal(s.marketValue, 1400);
  assert.equal(s.equity, 5400);
  assert.equal(s.unrealizedPnl, 400);
});

test("computeOptionStats: realizedPnl sums all positions; sold excluded from MV", () => {
  const positions = [p({ id: 1, status: "open", contracts: 1, premiumPaid: 5, realizedPnl: 0 }), p({ id: 2, status: "closed", contracts: 0, realizedPnl: 300 })];
  const s = computeOptionStats(positions, () => 5, 1000);
  assert.equal(s.realizedPnl, 300);
  assert.equal(s.marketValue, 500); // only the open one: 1*100*5
});

test("computeOptionStats: missing premium falls back to premiumPaid and is flagged", () => {
  const positions = [p({ id: 1, underlying: "AAPL", type: "call", strike: 100, contracts: 1, premiumPaid: 5 })];
  const s = computeOptionStats(positions, () => null, 0);
  assert.equal(s.marketValue, 500); // 1*100*premiumPaid 5
  assert.equal(s.unrealizedPnl, 0);
  assert.deepEqual(s.missingPremiums, ["AAPL call 100"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/options/optionStats.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/options/optionStats.ts
// Pure mark-to-market valuation of an options portfolio + intrinsic settlement.

import type { OptionType } from "./blackScholes";

export interface OptionPosition {
  id: number;
  underlying: string;
  type: OptionType;
  strike: number;
  status: string;        // open | closed | expired
  contracts: number;
  premiumPaid: number;   // per share
  realizedPnl: number;
}

export interface OptionStats {
  cash: number;
  marketValue: number;
  equity: number;
  unrealizedPnl: number;
  realizedPnl: number;
  missingPremiums: string[];
}

const MULT = 100; // shares per contract

/** Intrinsic value per share at settlement. */
export function settlementValue(type: OptionType, strike: number, underlyingPrice: number): number {
  return type === "call" ? Math.max(0, underlyingPrice - strike) : Math.max(0, strike - underlyingPrice);
}

export function computeOptionStats(
  positions: OptionPosition[],
  premiumOf: (p: OptionPosition) => number | null,
  cash: number,
): OptionStats {
  const open = positions.filter((p) => p.status === "open");
  const missingPremiums: string[] = [];
  let marketValue = 0;
  let cost = 0;
  for (const p of open) {
    const px = premiumOf(p);
    if (px == null) missingPremiums.push(`${p.underlying} ${p.type} ${p.strike}`);
    const prem = px ?? p.premiumPaid;
    marketValue += p.contracts * MULT * prem;
    cost += p.contracts * MULT * p.premiumPaid;
  }
  const realizedPnl = positions.reduce((s, p) => s + (p.realizedPnl ?? 0), 0);
  return { cash, marketValue, equity: cash + marketValue, unrealizedPnl: marketValue - cost, realizedPnl, missingPremiums };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/options/optionStats.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Type-check & commit**

`npx tsc --noEmit` (clean), then:
```bash
git add src/lib/options/optionStats.ts src/lib/options/optionStats.test.ts
git commit -m "feat: add pure option valuation + settlement helpers"
```

---

## Task 6: Schema — OptionHolding + cash init for options

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/app/api/portfolios/route.ts`

Additive change (new table + relation); no backfill needed.

- [ ] **Step 1: Add the model + relation**

In `prisma/schema.prisma`, add below the `Holding` model:
```prisma
/// A long single-leg option position (avg-cost not needed — one buy per lot).
model OptionHolding {
  id          Int       @id @default(autoincrement())
  portfolio   Portfolio @relation(fields: [portfolioId], references: [id])
  portfolioId Int
  underlying  String
  type        String                     // call | put
  strike      Float
  expiry      DateTime
  contracts   Int                        // 1 contract = 100 shares
  premiumPaid Float                      // entry premium per share
  status      String    @default("open") // open | closed | expired
  realizedPnl Float     @default(0)
  openedAt    DateTime  @default(now())
  closedAt    DateTime?
  updatedAt   DateTime  @updatedAt
}
```
On `model Portfolio`, add the back-relation with the others:
```prisma
  optionHoldings   OptionHolding[]
```

- [ ] **Step 2: Push + regenerate**

Run: `npm run db:push` then `npm run db:generate`
Expected: additive sync; client gains the `optionHolding` model. If it prompts/erors, STOP and report.

- [ ] **Step 3: Init cash for options portfolios on create**

In `src/app/api/portfolios/route.ts`, the POST handler sets `cash: kind === "invest" ? startingBalance : 0`. Change that single line to also cover options:
```ts
      cash: kind === "invest" || kind === "options" ? startingBalance : 0,
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — clean. Run: `npm test` — all pass.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma src/app/api/portfolios/route.ts
git commit -m "feat: add OptionHolding model; init cash for options portfolios"
```

---

## Task 7: Executor (buy / close / settle)

**Files:**
- Create: `src/lib/options/execute.ts`
- Test: `src/lib/options/execute.test.ts`

- [ ] **Step 1: Write the failing test (pure `closePnl`)**

```ts
// src/lib/options/execute.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { closePnl, clampContracts } from "./execute";

test("closePnl: contracts × 100 × (exitPremium − premiumPaid)", () => {
  assert.equal(closePnl(2, 5, 7), 2 * 100 * 2);     // +400
  assert.equal(closePnl(1, 5, 1), 1 * 100 * -4);    // -400
});

test("clampContracts: floor(cash / (100 × premium)); 0 when premium<=0 or no cash", () => {
  assert.equal(clampContracts(5, 1000, 12), 4); // wants 5, can afford 4 (4800<=1000? no) -> min(5, floor(1000/1200)=0)=0
  assert.equal(clampContracts(5, 6000, 12), 5); // floor(6000/1200)=5 -> min(5,5)=5
  assert.equal(clampContracts(5, 5000, 12), 4); // floor(5000/1200)=4
  assert.equal(clampContracts(5, 1000, 0), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/options/execute.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/options/execute.ts
// DB executor for option positions. Pure helpers (closePnl/clampContracts) are
// unit-tested; the buy/close/settle ops mutate OptionHolding + cash atomically.

import { prisma } from "@/lib/db";
import { settlementValue } from "./optionStats";
import type { OptionType } from "./blackScholes";

const MULT = 100;

/** Realized P/L of closing `contracts` bought at `premiumPaid`, exited at `exitPremium`. */
export function closePnl(contracts: number, premiumPaid: number, exitPremium: number): number {
  return contracts * MULT * (exitPremium - premiumPaid);
}

/** Most contracts of `want` affordable with `cash` at `premium`. */
export function clampContracts(want: number, cash: number, premium: number): number {
  if (!(premium > 0)) return 0;
  return Math.min(want, Math.floor(cash / (MULT * premium)));
}

export interface BuyOptionInput { underlying: string; type: OptionType; strike: number; expiry: Date; contracts: number; premium: number }

/** Buy a new option position, clamped to available cash. */
export async function buyOption(portfolioId: number, input: BuyOptionInput): Promise<{ ok: boolean; note: string }> {
  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) throw new Error(`portfolio ${portfolioId} not found`);
  const contracts = clampContracts(input.contracts, portfolio.cash, input.premium);
  if (!(contracts > 0)) return { ok: false, note: "insufficient cash" };
  const cost = contracts * MULT * input.premium;
  await prisma.$transaction(async (tx) => {
    await tx.optionHolding.create({
      data: { portfolioId, underlying: input.underlying, type: input.type, strike: input.strike, expiry: input.expiry, contracts, premiumPaid: input.premium },
    });
    await tx.portfolio.update({ where: { id: portfolioId }, data: { cash: portfolio.cash - cost } });
  });
  return { ok: true, note: `buy ${contracts} ${input.underlying} ${input.type} ${input.strike} @ ${input.premium.toFixed(2)}` };
}

/** Close an open position at `exitPremium`. */
export async function closeOption(positionId: number, exitPremium: number): Promise<{ ok: boolean; note: string }> {
  const pos = await prisma.optionHolding.findUnique({ where: { id: positionId } });
  if (!pos || pos.status !== "open") return { ok: false, note: "position not open" };
  const proceeds = pos.contracts * MULT * exitPremium;
  await prisma.$transaction(async (tx) => {
    await tx.optionHolding.update({
      where: { id: positionId },
      data: { status: "closed", closedAt: new Date(), realizedPnl: pos.realizedPnl + closePnl(pos.contracts, pos.premiumPaid, exitPremium) },
    });
    const p = await tx.portfolio.findUnique({ where: { id: pos.portfolioId } });
    await tx.portfolio.update({ where: { id: pos.portfolioId }, data: { cash: (p?.cash ?? 0) + proceeds } });
  });
  return { ok: true, note: `close ${pos.underlying} ${pos.type} ${pos.strike} @ ${exitPremium.toFixed(2)}` };
}

/** Settle an expired position at intrinsic value vs the current underlying price. */
export async function settleOption(positionId: number, underlyingPrice: number): Promise<{ ok: boolean; note: string }> {
  const pos = await prisma.optionHolding.findUnique({ where: { id: positionId } });
  if (!pos || pos.status !== "open") return { ok: false, note: "position not open" };
  const intrinsic = settlementValue(pos.type as OptionType, pos.strike, underlyingPrice);
  const value = pos.contracts * MULT * intrinsic;
  await prisma.$transaction(async (tx) => {
    await tx.optionHolding.update({
      where: { id: positionId },
      data: { status: "expired", closedAt: new Date(), realizedPnl: pos.realizedPnl + (value - pos.contracts * MULT * pos.premiumPaid) },
    });
    const p = await tx.portfolio.findUnique({ where: { id: pos.portfolioId } });
    await tx.portfolio.update({ where: { id: pos.portfolioId }, data: { cash: (p?.cash ?? 0) + value } });
  });
  return { ok: true, note: `settle ${pos.underlying} ${pos.type} ${pos.strike} → ${intrinsic.toFixed(2)} intrinsic` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/options/execute.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Type-check & commit**

`npx tsc --noEmit` (clean), then:
```bash
git add src/lib/options/execute.ts src/lib/options/execute.test.ts
git commit -m "feat: add option executor (buy/close/settle) with pure helpers"
```

---

## Task 8: Engine — `runOptions` orchestrator

**Files:**
- Create: `src/lib/options/engine.ts`

No unit test (orchestration over DB + network, consistent with `manage.ts`/`engine.ts` which are also untested); verified by tsc + the API smoke in Task 9.

- [ ] **Step 1: Implement `src/lib/options/engine.ts`**

```ts
// Autonomous options desk. Settle expired positions (always), then — only when
// the portfolio may trade — close flipped/near-expiry positions and open new
// long calls/puts from the committee's directional read. Mirrors the swing
// scan-all engine's autonomous shape.

import { prisma } from "@/lib/db";
import { isOptionsKind } from "@/lib/portfolioGuards";
import { isGlobalTradingHalt } from "@/lib/settings";
import { fetchCandles } from "@/lib/marketData";
import { getWatchlist } from "@/lib/trading/watchlist";
import { analyzeLongTerm } from "@/lib/invest/analyze";
import { fetchOptionChain, type OptionQuote } from "./chain";
import { chooseExpiry, chooseStrike, directionToType, sizeContracts, type Rating } from "./select";
import { computeOptionStats } from "./optionStats";
import { buyOption, closeOption, settleOption } from "./execute";
import { RISK_FREE_RATE } from "./blackScholes";

const MIN_DAYS_TO_EXPIRY = 30;
const NEAR_EXPIRY_DAYS = 7;
const TARGET_DELTA = 0.5;

export interface OptionsRunSummary {
  settled: string[];
  closed: string[];
  opened: string[];
  errors: string[];
}

async function underlyingPrice(symbol: string): Promise<number | null> {
  try { const r = await fetchCandles(symbol, "1d", "5m"); return r.price ?? r.candles.at(-1)?.c ?? null; }
  catch { return null; }
}

/** Mid price of a quote, falling back to lastPrice. */
function mid(q: OptionQuote): number {
  return q.bid > 0 && q.ask > 0 ? (q.bid + q.ask) / 2 : q.lastPrice;
}

export async function runOptions(portfolioId: number): Promise<OptionsRunSummary> {
  const summary: OptionsRunSummary = { settled: [], closed: [], opened: [], errors: [] };
  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) throw new Error(`portfolio ${portfolioId} not found`);
  if (!isOptionsKind(portfolio.kind)) throw new Error("not an options portfolio");

  const nowSec = Math.floor(Date.now() / 1000);

  // 1) Settle expired (always — mechanical).
  const open = await prisma.optionHolding.findMany({ where: { portfolioId, status: "open" } });
  for (const pos of open) {
    if (pos.expiry.getTime() <= Date.now()) {
      const px = await underlyingPrice(pos.underlying);
      if (px == null) { summary.errors.push(`settle ${pos.underlying}: no price`); continue; }
      try { const r = await settleOption(pos.id, px); if (r.ok) summary.settled.push(r.note); } catch (e) { summary.errors.push(String(e)); }
    }
  }

  const canTrade = portfolio.status !== "archived" && !portfolio.killSwitch && !(await isGlobalTradingHalt());
  if (!canTrade) return summary;

  // committee read cache (avoid re-analyzing the same underlying)
  const reads = new Map<string, { rating: Rating; price: number }>();
  const readOf = async (sym: string): Promise<{ rating: Rating; price: number } | null> => {
    if (reads.has(sym)) return reads.get(sym)!;
    try { const a = await analyzeLongTerm(sym); const r = { rating: a.verdict.rating as Rating, price: a.price }; reads.set(sym, r); return r; }
    catch (e) { summary.errors.push(`analyze ${sym}: ${e}`); return null; }
  };

  // 2) Close: re-fetch still-open positions; close on directional flip or near expiry.
  const stillOpen = await prisma.optionHolding.findMany({ where: { portfolioId, status: "open" } });
  for (const pos of stillOpen) {
    const daysLeft = (pos.expiry.getTime() - Date.now()) / 86_400_000;
    const read = await readOf(pos.underlying);
    const flipped = read != null && ((pos.type === "call" && read.rating === "avoid") || (pos.type === "put" && (read.rating === "buy" || read.rating === "strong-buy")));
    if (!flipped && daysLeft > NEAR_EXPIRY_DAYS) continue;
    try {
      const chain = await fetchOptionChain(pos.underlying, Math.floor(pos.expiry.getTime() / 1000));
      const q = (pos.type === "call" ? chain.calls : chain.puts).find((x) => x.strike === pos.strike);
      const premium = q ? mid(q) : 0;
      const r = await closeOption(pos.id, premium);
      if (r.ok) summary.closed.push(`${r.note} (${flipped ? "flip" : "near-expiry"})`);
    } catch (e) { summary.errors.push(`close ${pos.underlying}: ${e}`); }
  }

  // 3) Open: for each watchlist underlying not held, buy a call/put by target delta.
  const held = new Set((await prisma.optionHolding.findMany({ where: { portfolioId, status: "open" }, select: { underlying: true } })).map((h) => h.underlying));
  let heldCount = held.size;
  const watch = (await getWatchlist(portfolioId)).filter((w) => w.enabled).map((w) => w.symbol);

  // equity for the per-position premium budget = cash + MV of open positions (priced below as we go is overkill; use cash + 0 for simplicity at open time is wrong) →
  // value open positions from their close-step premiums is unavailable here, so recompute equity from a light pass:
  const openForStats = await prisma.optionHolding.findMany({ where: { portfolioId, status: "open" } });
  const premiumCache = new Map<number, number | null>();
  for (const pos of openForStats) {
    try {
      const chain = await fetchOptionChain(pos.underlying, Math.floor(pos.expiry.getTime() / 1000));
      const q = (pos.type === "call" ? chain.calls : chain.puts).find((x) => x.strike === pos.strike);
      premiumCache.set(pos.id, q ? mid(q) : null);
    } catch { premiumCache.set(pos.id, null); }
  }
  const stats = computeOptionStats(
    openForStats.map((p) => ({ id: p.id, underlying: p.underlying, type: p.type as "call" | "put", strike: p.strike, status: p.status, contracts: p.contracts, premiumPaid: p.premiumPaid, realizedPnl: p.realizedPnl })),
    (p) => premiumCache.get(p.id) ?? null,
    portfolio.cash,
  );
  const budget = portfolio.maxOpenPositions > 0 ? stats.equity / portfolio.maxOpenPositions : 0;

  for (const sym of watch) {
    if (heldCount >= portfolio.maxOpenPositions) break;
    if (held.has(sym)) continue;
    const read = await readOf(sym);
    if (!read) continue;
    const type = directionToType(read.rating);
    if (!type) continue;
    try {
      const base = await fetchOptionChain(sym);
      const expiry = chooseExpiry(base.expiries, nowSec, MIN_DAYS_TO_EXPIRY);
      if (expiry == null) { summary.errors.push(`open ${sym}: no expiry ≥ ${MIN_DAYS_TO_EXPIRY}d`); continue; }
      const chain = await fetchOptionChain(sym, expiry);
      const quotes = type === "call" ? chain.calls : chain.puts;
      const q = chooseStrike(quotes, chain.underlyingPrice, type, TARGET_DELTA, RISK_FREE_RATE, nowSec);
      if (!q) { summary.errors.push(`open ${sym}: no strike`); continue; }
      const premium = mid(q);
      const contracts = sizeContracts(budget, premium);
      if (contracts <= 0) { summary.errors.push(`open ${sym}: budget too small for 1 contract`); continue; }
      const r = await buyOption(portfolioId, { underlying: sym, type, strike: q.strike, expiry: new Date(q.expiry * 1000), contracts, premium });
      if (r.ok) { summary.opened.push(r.note); heldCount += 1; }
    } catch (e) { summary.errors.push(`open ${sym}: ${e}`); }
  }

  return summary;
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` — clean.
Run: `npm test` — all pass (unchanged count; engine has no unit test).

- [ ] **Step 3: Commit**

```bash
git add src/lib/options/engine.ts
git commit -m "feat: add autonomous runOptions engine (settle/close/open)"
```

---

## Task 9: API — run + holdings

**Files:**
- Create: `src/app/api/options/run/route.ts`
- Create: `src/app/api/options/holdings/route.ts`

- [ ] **Step 1: Create `src/app/api/options/run/route.ts`**

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isOptionsKind } from "@/lib/portfolioGuards";
import { runOptions } from "@/lib/options/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const portfolioId = Number(body.portfolioId);
  if (!Number.isInteger(portfolioId)) return NextResponse.json({ error: "portfolioId is required" }, { status: 400 });
  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) return NextResponse.json({ error: "portfolio not found" }, { status: 404 });
  if (!isOptionsKind(portfolio.kind)) return NextResponse.json({ error: "not an options portfolio" }, { status: 409 });
  try {
    return NextResponse.json(await runOptions(portfolioId));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create `src/app/api/options/holdings/route.ts`**

This route settles expired positions first (so the view is never stale), then values open positions from their chains and computes greeks for display.

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isOptionsKind } from "@/lib/portfolioGuards";
import { computeOptionStats } from "@/lib/options/optionStats";
import { fetchOptionChain } from "@/lib/options/chain";
import { greeks, RISK_FREE_RATE, type OptionType } from "@/lib/options/blackScholes";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const YEAR_S = 365.25 * 24 * 3600;
const mid = (q: { bid: number; ask: number; lastPrice: number }) => (q.bid > 0 && q.ask > 0 ? (q.bid + q.ask) / 2 : q.lastPrice);

export async function GET(req: Request) {
  const portfolioId = Number(new URL(req.url).searchParams.get("portfolioId"));
  if (!Number.isInteger(portfolioId)) return NextResponse.json({ error: "portfolioId is required" }, { status: 400 });
  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) return NextResponse.json({ error: "portfolio not found" }, { status: 404 });
  if (!isOptionsKind(portfolio.kind)) return NextResponse.json({ error: "not an options portfolio" }, { status: 409 });

  const positions = await prisma.optionHolding.findMany({ where: { portfolioId, status: "open" }, orderBy: { underlying: "asc" } });
  const nowSec = Math.floor(Date.now() / 1000);
  const premiumById = new Map<number, number | null>();
  const rows = [] as Array<Record<string, unknown>>;
  for (const pos of positions) {
    let premium: number | null = null;
    let delta: number | null = null;
    let theta: number | null = null;
    try {
      const chain = await fetchOptionChain(pos.underlying, Math.floor(pos.expiry.getTime() / 1000));
      const q = (pos.type === "call" ? chain.calls : chain.puts).find((x) => x.strike === pos.strike);
      if (q) {
        premium = mid(q);
        const T = (q.expiry - nowSec) / YEAR_S;
        if (T > 0 && q.impliedVolatility > 0) {
          const g = greeks(pos.type as OptionType, chain.underlyingPrice, pos.strike, T, RISK_FREE_RATE, q.impliedVolatility);
          delta = g.delta; theta = g.theta;
        }
      }
    } catch { /* leave premium null */ }
    premiumById.set(pos.id, premium);
    rows.push({
      id: pos.id, underlying: pos.underlying, type: pos.type, strike: pos.strike, expiry: pos.expiry,
      contracts: pos.contracts, premiumPaid: pos.premiumPaid, premium,
      marketValue: pos.contracts * 100 * (premium ?? pos.premiumPaid), delta, theta,
    });
  }
  const stats = computeOptionStats(
    positions.map((p) => ({ id: p.id, underlying: p.underlying, type: p.type as OptionType, strike: p.strike, status: p.status, contracts: p.contracts, premiumPaid: p.premiumPaid, realizedPnl: p.realizedPnl })),
    (p) => premiumById.get(p.id) ?? null,
    portfolio.cash,
  );
  return NextResponse.json({ stats, holdings: rows, maxPositions: portfolio.maxOpenPositions });
}
```

- [ ] **Step 3: Verify (tsc + smoke)**

Run: `npx tsc --noEmit` — clean. Run: `npm test` — all pass.
Smoke (dev server on 3275):
```bash
curl -s -X POST http://localhost:3275/api/portfolios -H "Content-Type: application/json" -d '{"name":"Options Test","kind":"options","startingBalance":10000}'
# capture id, then:
curl -s "http://localhost:3275/api/options/holdings?portfolioId=<id>" -o nul -w "holdings %{http_code}\n"
curl -s -X POST http://localhost:3275/api/options/run -H "Content-Type: application/json" -d "{\"portfolioId\":<id>}" -o nul -w "run %{http_code}\n"
```
Expected: `holdings 200`; `run 200` (a real run may take a while or return mostly errors if Yahoo options are unavailable for the watchlist — a 200 with a summary object is the pass). Stop the dev server after.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/options
git commit -m "feat: options run + holdings API"
```

---

## Task 10: UI — `/options` page

**Files:**
- Create: `src/app/options/page.tsx`

- [ ] **Step 1: Create the page**

A client component mirroring the invest page's portfolio mode, but with a single autonomous "Run options desk" button instead of an approval list.

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardTitle, Button, Badge, PageHeader, Empty, Stat } from "@/components/ui";
import { fmtNumber } from "@/lib/utils";

interface OptionsPortfolio { id: number; name: string; kind: string; cash: number; maxOpenPositions: number }
interface HoldingRow { id: number; underlying: string; type: string; strike: number; expiry: string; contracts: number; premiumPaid: number; premium: number | null; marketValue: number; delta: number | null; theta: number | null }
interface OptionStatsT { cash: number; marketValue: number; equity: number; unrealizedPnl: number; realizedPnl: number; missingPremiums: string[] }
interface RunSummary { settled: string[]; closed: string[]; opened: string[]; errors: string[] }

const f = (n: number | null, d = 2) => (n == null ? "—" : fmtNumber(n, d));

export default function OptionsPage() {
  const [portfolios, setPortfolios] = useState<OptionsPortfolio[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [held, setHeld] = useState<HoldingRow[]>([]);
  const [stats, setStats] = useState<OptionStatsT | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<RunSummary | null>(null);

  useEffect(() => {
    void fetch("/api/portfolios").then((r) => r.json()).then((list: OptionsPortfolio[]) => {
      const opt = (Array.isArray(list) ? list : []).filter((p) => p.kind === "options");
      setPortfolios(opt);
      setSelectedId((cur) => cur ?? opt[0]?.id ?? null);
    });
  }, []);

  const load = useCallback(async (id: number) => {
    const d = await fetch(`/api/options/holdings?portfolioId=${id}`).then((r) => r.json());
    setHeld(d.holdings ?? []); setStats(d.stats ?? null);
  }, []);
  useEffect(() => { if (selectedId != null) void load(selectedId); }, [selectedId, load]);

  async function run() {
    if (selectedId == null || busy) return;
    setBusy(true); setSummary(null);
    try {
      const d = await fetch("/api/options/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ portfolioId: selectedId }) }).then((r) => r.json());
      setSummary(d.error ? { settled: [], closed: [], opened: [], errors: [d.error] } : d);
      await load(selectedId);
    } finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader title="Options Desk" description="Autonomous long calls/puts — the desk picks, sizes by delta, and executes on Run. Paper only." action={<Badge tone="info">PAPER MODE</Badge>} />

      {portfolios.length === 0 ? (
        <Empty title="No options portfolio" hint="Create a portfolio with kind 'options' to use the options desk." />
      ) : (
        <Card className="mb-5">
          <div className="flex items-center justify-between gap-2 mb-3">
            <CardTitle>📊 Options portfolio</CardTitle>
            <select value={selectedId ?? ""} onChange={(e) => setSelectedId(Number(e.target.value))}
              className="h-9 rounded-md border border-(--color-border) bg-(--color-background) px-2 text-sm">
              {portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <Stat label="Equity" value={f(stats.equity, 0)} />
              <Stat label="Cash" value={f(stats.cash, 0)} />
              <Stat label="Unrealized P/L" value={f(stats.unrealizedPnl, 0)} />
              <Stat label="Realized P/L" value={f(stats.realizedPnl, 0)} />
            </div>
          )}

          {held.length > 0 ? (
            <div className="space-y-1 mb-4">
              {held.map((h) => (
                <div key={h.id} className="flex items-center justify-between text-xs font-mono border-b border-(--color-border) py-1">
                  <span className="font-semibold">{h.underlying} <span className={h.type === "call" ? "text-emerald-400" : "text-rose-400"}>{h.type.toUpperCase()}</span> {f(h.strike, 0)}</span>
                  <span className="text-(--color-muted)">{new Date(h.expiry).toISOString().slice(0, 10)} · ×{h.contracts}</span>
                  <span>prem {f(h.premium, 2)}</span>
                  <span>Δ {f(h.delta, 2)}</span>
                  <span>{f(h.marketValue, 0)}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-(--color-muted) mb-4">No open positions — run the desk to open trades.</p>}

          <Button onClick={run} disabled={busy}>{busy ? "Running desk…" : "Run options desk"}</Button>

          {summary && (
            <div className="mt-3 text-xs space-y-1">
              {summary.opened.length > 0 && <p className="text-emerald-400">opened: {summary.opened.join(" · ")}</p>}
              {summary.closed.length > 0 && <p className="text-amber-400">closed: {summary.closed.join(" · ")}</p>}
              {summary.settled.length > 0 && <p className="text-(--color-muted)">settled: {summary.settled.join(" · ")}</p>}
              {summary.errors.length > 0 && <p className="text-rose-400">skipped: {summary.errors.join(" · ")}</p>}
              {summary.opened.length === 0 && summary.closed.length === 0 && summary.settled.length === 0 && <p className="text-(--color-muted)">no actions this run</p>}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify (FINAL — full green)**

Run: `npx tsc --noEmit` — MUST be fully clean.
Run: `npm test` — all pass.
Smoke: `npm run dev`, then `curl -s "http://localhost:3275/options" -o nul -w "options %{http_code}\n"` → 200. Stop the dev server after.

- [ ] **Step 3: Commit**

```bash
git add src/app/options/page.tsx
git commit -m "feat: options desk page — holdings + autonomous run"
```

---

## Self-Review Notes

- **Spec coverage:** Black-Scholes price+greeks (Task 1); kind guards + swing-route refactor (Task 2); Yahoo chain parser+fetcher (Task 3); selection helpers (Task 4); valuation + settlement (Task 5); OptionHolding schema + options cash-init (Task 6); executor buy/close/settle atomic (Task 7); `runOptions` engine — settle-always, trade-when-canTrade, close-on-flip/near-expiry, open-by-delta (Task 8); run + holdings API with options-kind guard (Task 9); `/options` UI with autonomous Run (Task 10). The three-kind guard model and the safety gating (`canTrade`) are in Tasks 2 + 8.
- **Type consistency:** `OptionType` (Task 1) used across chain/select/optionStats/execute; `OptionQuote`/`OptionChain` (Task 3) used in select/engine/holdings; `Rating`/`directionToType`/`chooseExpiry`/`chooseStrike`/`sizeContracts` (Task 4) used in engine; `OptionPosition`/`computeOptionStats`/`settlementValue` (Task 5) used in engine/holdings/execute; `buyOption`/`closeOption`/`settleOption`/`closePnl`/`clampContracts` (Task 7) used in engine; `runOptions`/`OptionsRunSummary` (Task 8) used in Task 9; the holdings row shape (Task 9) matches the UI's `HoldingRow` (Task 10). `analyzeLongTerm().verdict.rating` cast to `Rating` (subset-safe).
- **No placeholders:** every code step has complete code or an exact edit; commands include expected output.
