# Volatility- and Correlation-Adjusted Position Sizing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the constant `DEFAULT_LOT = 0.1` in `runTradeTick` with a computed lot size that targets a constant dollar risk per trade and shrinks when the new symbol correlates with currently-open positions.

**Architecture:** Two new pure modules — `correlation.ts` (Pearson correlation of daily returns) and `positionSizing.ts` (risk-based lot computation) — wired into `engine.ts`'s `runTradeTick`. A new `riskPctPerTrade` setting (same pattern as `startingBalance`) drives `riskUsd`, exposed via `/api/settings` and the Safety panel.

**Tech Stack:** TypeScript, Prisma (Setting table), Next.js API routes, `node:test` + `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-06-15-position-sizing-design.md`

---

## File Structure

- Create: `src/lib/trading/correlation.ts` — `dailyReturns`, `pearsonCorrelation` (pure)
- Create: `src/lib/trading/correlation.test.ts`
- Create: `src/lib/trading/positionSizing.ts` — `computeLot` (pure)
- Create: `src/lib/trading/positionSizing.test.ts`
- Modify: `src/lib/settings.ts` — add `getRiskPctPerTrade`
- Modify: `src/app/api/settings/route.ts` — expose `riskPctPerTrade` in GET/POST
- Modify: `src/app/command/safety-panel.tsx` — add "Risk per trade (%)" input
- Modify: `src/lib/trading/engine.ts` — replace `DEFAULT_LOT` with computed sizing

---

### Task 1: `correlation.ts` — daily returns + Pearson correlation

**Files:**
- Create: `src/lib/trading/correlation.ts`
- Test: `src/lib/trading/correlation.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/trading/correlation.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { dailyReturns, pearsonCorrelation } from "./correlation";
import type { Candle } from "@/lib/indicators";

function candle(c: number): Candle {
  return { t: 0, o: c, h: c, l: c, c, v: 0 };
}

test("dailyReturns: known candle series -> known % returns", () => {
  const candles = [candle(100), candle(110), candle(121)];
  assert.deepEqual(dailyReturns(candles), [0.1, 0.1]);
});

test("dailyReturns: fewer than 2 candles -> empty array", () => {
  assert.deepEqual(dailyReturns([]), []);
  assert.deepEqual(dailyReturns([candle(100)]), []);
});

test("pearsonCorrelation: identical series -> 1", () => {
  const xs = [1, 2, 3, 4, 5, 6];
  assert.equal(pearsonCorrelation(xs, xs), 1);
});

test("pearsonCorrelation: inverted series -> -1", () => {
  const xs = [1, 2, 3, 4, 5, 6];
  const ys = [6, 5, 4, 3, 2, 1];
  assert.equal(pearsonCorrelation(xs, ys), -1);
});

test("pearsonCorrelation: short series (<5 points) -> null", () => {
  assert.equal(pearsonCorrelation([1, 2, 3], [1, 2, 3]), null);
});

test("pearsonCorrelation: trims to common trailing length", () => {
  const xs = [99, 1, 2, 3, 4, 5]; // 6 points, last 5 = [1,2,3,4,5]
  const ys = [1, 2, 3, 4, 5]; // 5 points
  assert.equal(pearsonCorrelation(xs, ys), 1);
});

test("pearsonCorrelation: constant series -> null (zero variance)", () => {
  assert.equal(pearsonCorrelation([1, 1, 1, 1, 1], [1, 2, 3, 4, 5]), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="dailyReturns|pearsonCorrelation"`

Expected: FAIL — `correlation.ts` does not exist (module not found).

- [ ] **Step 3: Implement `correlation.ts`**

Create `src/lib/trading/correlation.ts`:

```ts
// Pearson correlation of daily returns — used to dampen position size when a
// new trade would stack exposure that already moves with open positions.
// Pure — operates on candle arrays already fetched by the caller.

import type { Candle } from "@/lib/indicators";

/** Daily % returns from a candle series (close-to-close). */
export function dailyReturns(candles: Candle[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].c;
    const curr = candles[i].c;
    if (prev !== 0) out.push((curr - prev) / prev);
  }
  return out;
}

/**
 * Pearson correlation of two return series, trimmed to the same trailing
 * length (most recent N points of each — an approximation, not date-aligned).
 * Returns null if either series has fewer than 5 points after trimming, or
 * if either series has zero variance.
 */
export function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 5) return null;

  const x = xs.slice(xs.length - n);
  const y = ys.slice(ys.length - n);

  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0 || varY === 0) return null;

  return cov / Math.sqrt(varX * varY);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="dailyReturns|pearsonCorrelation"`

Expected: PASS — 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trading/correlation.ts src/lib/trading/correlation.test.ts
git commit -m "feat: add daily-returns and Pearson correlation helpers"
```

---

### Task 2: `positionSizing.ts` — risk-based lot computation

**Files:**
- Create: `src/lib/trading/positionSizing.ts`
- Test: `src/lib/trading/positionSizing.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/trading/positionSizing.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLot } from "./positionSizing";

const base = { riskUsd: 10, maxLotPerTrade: 2, avgCorrelation: null as number | null };

test("larger SL distance -> smaller lot (volatility scaling)", () => {
  const tight = computeLot({ ...base, entry: 100, sl: 90 }); // slDistance 10 -> riskLot 1
  const wide = computeLot({ ...base, entry: 100, sl: 0 }); // slDistance 100 -> riskLot 0.1
  assert.equal(tight.lot, 1);
  assert.equal(wide.lot, 0.1);
  assert.ok(wide.lot < tight.lot);
});

test("lot clamped to maxLotPerTrade when riskLot would exceed it", () => {
  // slDistance 1 -> riskLot 10, maxLotPerTrade 2
  const r = computeLot({ ...base, entry: 100, sl: 99 });
  assert.equal(r.lot, 2);
});

test("lot clamped to minLot when riskLot would fall below it", () => {
  // slDistance 1000 -> riskLot 0.01, default minLot 0.01
  const r = computeLot({ ...base, riskUsd: 10, entry: 1000, sl: 0 });
  assert.equal(r.lot, 0.01);
});

test("custom minLot floors a very small riskLot", () => {
  // slDistance 10000 -> riskLot 0.001, custom minLot 0.05
  const r = computeLot({ ...base, riskUsd: 10, entry: 10000, sl: 0, minLot: 0.05 });
  assert.equal(r.lot, 0.05);
});

test("avgCorrelation buckets produce expected corrMultiplier and lot", () => {
  // slDistance 10 -> riskLot 1 (within [0.01, 2], no clamping)
  const input = { riskUsd: 10, maxLotPerTrade: 2, entry: 100, sl: 90 };

  const high = computeLot({ ...input, avgCorrelation: 0.85 });
  assert.equal(high.corrMultiplier, 0.7);
  assert.equal(high.lot, 0.7);

  const medium = computeLot({ ...input, avgCorrelation: 0.65 });
  assert.equal(medium.corrMultiplier, 0.85);
  assert.equal(medium.lot, 0.85);

  const low = computeLot({ ...input, avgCorrelation: 0.3 });
  assert.equal(low.corrMultiplier, 1);
  assert.equal(low.lot, 1);

  const none = computeLot({ ...input, avgCorrelation: null });
  assert.equal(none.corrMultiplier, 1);
  assert.equal(none.lot, 1);
});

test("slDistance <= 0 falls back to minLot", () => {
  const r = computeLot({ ...base, entry: 100, sl: 100 });
  assert.equal(r.lot, 0.01);
  assert.equal(r.corrMultiplier, 1);
  assert.match(r.reasoning, /min lot/i);
});

test("reasoning includes correlation note only when correlation is non-null", () => {
  const withCorr = computeLot({ riskUsd: 10, maxLotPerTrade: 2, avgCorrelation: 0.65, entry: 100, sl: 90 });
  assert.match(withCorr.reasoning, /corr 0\.65/);

  const withoutCorr = computeLot({ riskUsd: 10, maxLotPerTrade: 2, avgCorrelation: null, entry: 100, sl: 90 });
  assert.doesNotMatch(withoutCorr.reasoning, /corr/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="computeLot|lot clamped|avgCorrelation buckets|slDistance|reasoning"`

Expected: FAIL — `positionSizing.ts` does not exist (module not found).

- [ ] **Step 3: Implement `positionSizing.ts`**

Create `src/lib/trading/positionSizing.ts`:

```ts
// Risk-based lot sizing: targets a roughly constant dollar risk per trade
// (riskUsd / SL distance), then shrinks (never grows) the result when the
// new symbol is highly correlated with currently-open positions.
// Pure — no I/O.

export interface SizingInput {
  entry: number;
  sl: number;
  riskUsd: number; // startingBalance * riskPctPerTrade / 100
  maxLotPerTrade: number;
  minLot?: number; // default 0.01
  avgCorrelation: number | null; // null = no open positions, or no usable price data
}

export interface SizingResult {
  lot: number;
  riskUsd: number;
  slDistance: number;
  corrMultiplier: number;
  avgCorrelation: number | null;
  reasoning: string;
}

function corrMultiplierFor(avgCorrelation: number | null): number {
  if (avgCorrelation == null) return 1;
  if (avgCorrelation >= 0.8) return 0.7;
  if (avgCorrelation >= 0.6) return 0.85;
  return 1;
}

export function computeLot(input: SizingInput): SizingResult {
  const { entry, sl, riskUsd, maxLotPerTrade, avgCorrelation } = input;
  const minLot = input.minLot ?? 0.01;
  const slDistance = Math.abs(entry - sl);

  if (slDistance <= 0) {
    return {
      lot: minLot,
      riskUsd,
      slDistance,
      corrMultiplier: 1,
      avgCorrelation,
      reasoning: `SL distance is zero — falling back to min lot ${minLot}`,
    };
  }

  const riskLot = riskUsd / slDistance;
  const corrMultiplier = corrMultiplierFor(avgCorrelation);
  const afterCorr = riskLot * corrMultiplier;
  const lot = Math.round(Math.min(Math.max(afterCorr, minLot), maxLotPerTrade) * 100) / 100;

  const corrNote =
    avgCorrelation != null
      ? ` · corr ${avgCorrelation.toFixed(2)} (×${corrMultiplier}) → ${lot} lot`
      : "";
  const reasoning = `risk $${riskUsd} / SL dist ${slDistance.toFixed(2)} = ${riskLot.toFixed(2)} lot${corrNote}`;

  return { lot, riskUsd, slDistance, corrMultiplier, avgCorrelation, reasoning };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="computeLot|lot clamped|avgCorrelation buckets|slDistance|reasoning"`

Expected: PASS — 8 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trading/positionSizing.ts src/lib/trading/positionSizing.test.ts
git commit -m "feat: add risk- and correlation-based lot sizing"
```

---

### Task 3: `riskPctPerTrade` setting

**Files:**
- Modify: `src/lib/settings.ts`

- [ ] **Step 1: Add `getRiskPctPerTrade`**

In `src/lib/settings.ts`, add this function after `getStartingBalance` (matches its exact pattern):

```ts
export async function getRiskPctPerTrade(): Promise<number> {
  const n = parseFloat(await getSetting("riskPctPerTrade", "1"));
  return Number.isFinite(n) && n > 0 ? n : 1;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/settings.ts
git commit -m "feat: add riskPctPerTrade setting (default 1%)"
```

---

### Task 4: expose `riskPctPerTrade` via `/api/settings`

**Files:**
- Modify: `src/app/api/settings/route.ts`

- [ ] **Step 1: Update imports and `snapshot()`**

In `src/app/api/settings/route.ts`, change the import line:

```ts
import { getSetting, setSetting, getFearGreed, getMaxOpenPositions, getStartingBalance, getRiskPctPerTrade } from "@/lib/settings";
```

and add `riskPctPerTrade` to the snapshot object:

```ts
async function snapshot() {
  return NextResponse.json({
    killSwitch: (await getSetting("killSwitch", "false")) === "true",
    maxOpenPositions: await getMaxOpenPositions(),
    startingBalance: await getStartingBalance(),
    riskPctPerTrade: await getRiskPctPerTrade(),
    fearGreed: await getFearGreed(),
  });
}
```

- [ ] **Step 2: Update `POST` body type and handler**

Change the `POST` function's body type and add the `riskPctPerTrade` branch:

```ts
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    killSwitch?: boolean;
    maxOpenPositions?: number;
    startingBalance?: number;
    riskPctPerTrade?: number;
  };
  if (typeof body.killSwitch === "boolean") await setSetting("killSwitch", String(body.killSwitch));
  if (typeof body.maxOpenPositions === "number" && body.maxOpenPositions > 0) {
    await setSetting("maxOpenPositions", String(Math.floor(body.maxOpenPositions)));
  }
  if (typeof body.startingBalance === "number" && body.startingBalance > 0) {
    await setSetting("startingBalance", String(body.startingBalance));
  }
  if (typeof body.riskPctPerTrade === "number" && body.riskPctPerTrade > 0) {
    await setSetting("riskPctPerTrade", String(body.riskPctPerTrade));
  }
  return snapshot();
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`

Expected: no new errors.

- [ ] **Step 4: Manual check (dev server running)**

Run: `curl http://localhost:3275/api/settings` (or open in browser)

Expected: JSON includes `"riskPctPerTrade": 1`.

Then: `curl -X POST http://localhost:3275/api/settings -H "Content-Type: application/json" -d "{\"riskPctPerTrade\": 2}"`

Expected: response now shows `"riskPctPerTrade": 2`. Re-running the GET should also show `2` (persisted).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/settings/route.ts
git commit -m "feat: expose riskPctPerTrade via /api/settings"
```

---

### Task 5: Safety panel UI — "Risk per trade (%)" input

**Files:**
- Modify: `src/app/command/safety-panel.tsx`

- [ ] **Step 1: Add `riskPctPerTrade` to the `Settings` interface**

```ts
interface Settings {
  killSwitch: boolean;
  maxOpenPositions: number;
  startingBalance: number;
  riskPctPerTrade: number;
  fearGreed: { value: number; label: string } | null;
}
```

- [ ] **Step 2: Add `riskPctPerTrade` to the `update` patch type**

```ts
async function update(patch: { killSwitch?: boolean; maxOpenPositions?: number; startingBalance?: number; riskPctPerTrade?: number }) {
```

- [ ] **Step 3: Add the input field**

Add this block immediately after the "Starting balance ($)" input block (after its closing `</div>`):

```tsx
      <div className="flex items-center gap-2 mt-2">
        <label className="text-xs text-(--color-muted)">Risk per trade (%)</label>
        <input
          type="number"
          min={0.1}
          step={0.1}
          value={s.riskPctPerTrade}
          disabled={busy}
          onChange={(e) => update({ riskPctPerTrade: Number(e.target.value) })}
          className="w-16 rounded-md bg-(--color-card) border border-(--color-border) px-2 py-1 text-sm"
        />
      </div>
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`

Expected: no new errors.

- [ ] **Step 5: Visual check (dev server running)**

Open `http://localhost:3275/` (Command Bridge), find the 🛡️ Safety card.

Expected: a new "Risk per trade (%)" number input showing `1`, below "Starting balance ($)". Changing it and reloading the page should persist the new value.

- [ ] **Step 6: Commit**

```bash
git add src/app/command/safety-panel.tsx
git commit -m "feat: add Risk per trade (%) input to Safety panel"
```

---

### Task 6: wire `computeLot` into `runTradeTick`

**Files:**
- Modify: `src/lib/trading/engine.ts`

- [ ] **Step 1: Update imports**

In `src/lib/trading/engine.ts`, change:

```ts
import { isKillSwitchOn, getMaxOpenPositions, getFearGreed } from "@/lib/settings";
import type { Interval, Range } from "@/lib/yahoo";
```

to:

```ts
import { isKillSwitchOn, getMaxOpenPositions, getFearGreed, getStartingBalance, getRiskPctPerTrade } from "@/lib/settings";
import { fetchYahooCandlesSmart, type Interval, type Range } from "@/lib/yahoo";
import { dailyReturns, pearsonCorrelation } from "./correlation";
import { computeLot } from "./positionSizing";
```

- [ ] **Step 2: Replace the `DEFAULT_LOT` line with computed sizing**

Replace this line (currently at `src/lib/trading/engine.ts:102`):

```ts
  const lot = opts.lot ?? DEFAULT_LOT;
```

with:

```ts
  let lot: number;
  if (opts.lot != null) {
    lot = opts.lot;
  } else {
    const openPositions = await prisma.trade.findMany({
      where: { status: "open" },
      select: { symbol: true },
    });
    const openSymbols = [...new Set(openPositions.map((p) => p.symbol))].filter((s) => s !== symbol);

    let avgCorrelation: number | null = null;
    if (openSymbols.length > 0) {
      const currentReturns = await fetchDailyReturns(symbol);
      if (currentReturns) {
        const correlations: number[] = [];
        for (const openSymbol of openSymbols) {
          const openReturns = await fetchDailyReturns(openSymbol);
          if (!openReturns) continue;
          const corr = pearsonCorrelation(currentReturns, openReturns);
          if (corr != null) correlations.push(corr);
        }
        if (correlations.length > 0) {
          avgCorrelation = correlations.reduce((a, b) => a + b, 0) / correlations.length;
        }
      }
    }

    const riskUsd = ((await getStartingBalance()) * (await getRiskPctPerTrade())) / 100;
    const sizing = computeLot({
      entry: levels.entry,
      sl: levels.sl,
      riskUsd,
      maxLotPerTrade: DEFAULT_ACCOUNT.maxLotPerTrade,
      avgCorrelation,
    });
    lot = sizing.lot;
    steps.push({ stage: "sizing", note: sizing.reasoning });
  }
```

- [ ] **Step 3: Add the `fetchDailyReturns` helper**

Add this function near the bottom of `src/lib/trading/engine.ts` (alongside other private helpers, e.g. near `todaysRealizedLoss`):

```ts
/** Daily returns for correlation, or null if the candle fetch fails. */
async function fetchDailyReturns(symbol: string): Promise<number[] | null> {
  try {
    const resp = await fetchYahooCandlesSmart(symbol, "3mo", "1d");
    return dailyReturns(resp.candles);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`

Expected: no new errors. If `DEFAULT_LOT` is now unused, remove its declaration (`const DEFAULT_LOT = 0.1;`) — confirm with a search first:

Run: `grep -rn "DEFAULT_LOT" src/`

Expected: only the declaration remains (no other usages) — delete that line.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`

Expected: all existing tests still pass — 61 currently + 7 (correlation) + 8 (positionSizing) = 76, since `runTradeTick` itself has no unit tests and the new logic only runs through the pure, already-tested modules.

- [ ] **Step 6: Manual smoke test (dev server running, with at least one open position)**

Trigger a tick for a symbol with no open positions yet (e.g. via `/api/scan-all` or the War Room "scan" action), then check the new trade's `decisionLog` (via `/api/agent` or the trade detail) for a `"sizing"` step with a reasoning string like:

`"risk $100 / SL dist 2.94 = 0.34 lot"` (no open positions → `avgCorrelation` is `null`, no `corr` suffix).

With ≥1 open position, trigger another tick and confirm the `"sizing"` step's reasoning includes a `corr` segment when correlation data was fetched successfully.

- [ ] **Step 7: Commit**

```bash
git add src/lib/trading/engine.ts
git commit -m "feat: compute lot size from risk %% and open-position correlation"
```

---

## Self-Review Notes

- **Spec coverage:** `riskPctPerTrade` setting (Task 3-4), Safety panel input (Task 5), `correlation.ts` (Task 1), `positionSizing.ts` (Task 2), `engine.ts` wiring incl. `opts.lot` bypass, no-open-positions short-circuit, per-symbol fetch-failure exclusion, and the `"sizing"` decision-log step (Task 6) — all covered. Out-of-scope items (date-aligned correlation, volatility percentile, only-shrink) require no tasks — they're explicitly *not* implemented.
- **Type consistency:** `SizingInput`/`SizingResult` field names (`lot`, `riskUsd`, `slDistance`, `corrMultiplier`, `avgCorrelation`, `reasoning`) match between `positionSizing.ts` (Task 2) and the `engine.ts` call site (Task 6). `dailyReturns`/`pearsonCorrelation` signatures match between `correlation.ts` (Task 1) and `engine.ts`'s `fetchDailyReturns` helper (Task 6).
- **Placeholder scan:** no TBDs; every step has runnable code/commands.
