# Candlestick Pattern Strategies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 10 individually-selectable candlestick reversal-pattern strategies (5 bullish, 5 bearish) plus one `candlestick-any` combo meta-strategy to NEXMIND's strategy registry, following the existing `Strategy` contract exactly.

**Architecture:** Pure geometry-detector functions live in a new `src/lib/trading/candlestickPatterns.ts` module (mirrors `src/lib/swings.ts`), gated by a shared `priorTrend()` helper so each pattern only fires as a genuine reversal (a shape following the trend it's supposed to reverse). `src/lib/trading/strategies.ts` gets 10 thin `Strategy` wrapper objects that import these detectors, plus one `combineStrategies(..., "any")` combo — both already-existing, unmodified mechanisms. The Backtest Lab (`src/app/backtest/page.tsx`) gets a new comparison button following its existing per-mode-array pattern.

**Tech Stack:** TypeScript, Node's built-in `node:test` runner (via `tsx`), no new dependencies.

## Global Constraints

- No new npm dependencies.
- No Prisma schema changes — built-in strategies are code-only (see `docs/superpowers/specs/2026-07-15-candlestick-pattern-strategies-design.md`, "Prisma schema" note).
- Test runner is `node:test` via `tsx` (`npm test` = `tsx --test "src/**/*.test.ts"`) — do not use jest/vitest syntax (`describe`, `it`, `expect`).
- All new strategy `key`s are kebab-case; all detector functions are pure (no I/O, no mutation of their `bars` argument).
- Follow the existing file's doc-comment style: one `/** ... */` block above each exported pattern function / `Strategy` const explaining what it detects.

---

### Task 1: Pattern-detector foundation — `priorTrend`, Hammer, Shooting Star

**Files:**
- Create: `src/lib/trading/candlestickPatterns.ts`
- Create: `src/lib/trading/candlestickPatterns.test.ts`

**Interfaces:**
- Produces: `export type TrendDirection = "up" | "down" | "flat"`; `export function priorTrend(bars: Candle[], i: number, lookback?: number): TrendDirection`; `export function isHammer(bars: Candle[], i: number): boolean`; `export function isShootingStar(bars: Candle[], i: number): boolean`. `Candle` is imported from `@/lib/indicators` (`{ t, o, h, l, c, v }`, already defined there — do not redefine it).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/trading/candlestickPatterns.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import { priorTrend, isHammer, isShootingStar } from "./candlestickPatterns";

const HOUR = 3600;

function bar(t: number, o: number, h: number, l: number, c: number, v = 1000): Candle {
  return { t, o, h, l, c, v };
}

function downtrendPrefix(n: number, startClose: number, step: number): Candle[] {
  return Array.from({ length: n }, (_, k) => {
    const c = startClose - k * step;
    return bar(k * HOUR, c + step * 0.3, c + 1, c - 1, c);
  });
}

function uptrendPrefix(n: number, startClose: number, step: number): Candle[] {
  return Array.from({ length: n }, (_, k) => {
    const c = startClose + k * step;
    return bar(k * HOUR, c - step * 0.3, c + 1, c - 1, c);
  });
}

const DOWN = downtrendPrefix(15, 200, 3); // closes 200 -> 158; priorTrend at index 14 = "down"
const UP = uptrendPrefix(15, 100, 3);     // closes 100 -> 142; priorTrend at index 14 = "up"

test("priorTrend: insufficient history returns flat", () => {
  const bars = downtrendPrefix(5, 100, 3);
  assert.equal(priorTrend(bars, 4, 10), "flat");
});

test("priorTrend: rising closes over the window return up", () => {
  assert.equal(priorTrend(UP, 14, 10), "up");
});

test("priorTrend: falling closes over the window return down", () => {
  assert.equal(priorTrend(DOWN, 14, 10), "down");
});

test("Hammer: small body + long lower wick after a downtrend fires", () => {
  const bars = [...DOWN, bar(15 * HOUR, 100, 101.2, 95, 101)];
  assert.equal(isHammer(bars, 15), true);
});

test("Hammer: same shape after an uptrend does not fire (trend filter)", () => {
  const bars = [...UP, bar(15 * HOUR, 100, 101.2, 95, 101)];
  assert.equal(isHammer(bars, 15), false);
});

test("Shooting Star: small body + long upper wick after an uptrend fires", () => {
  const bars = [...UP, bar(15 * HOUR, 100, 105, 98.8, 99)];
  assert.equal(isShootingStar(bars, 15), true);
});

test("Shooting Star: same shape after a downtrend does not fire (trend filter)", () => {
  const bars = [...DOWN, bar(15 * HOUR, 100, 105, 98.8, 99)];
  assert.equal(isShootingStar(bars, 15), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test src/lib/trading/candlestickPatterns.test.ts`
Expected: FAIL — `candlestickPatterns.ts` does not exist (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/lib/trading/candlestickPatterns.ts`:

```ts
// Pure candlestick reversal-pattern detectors. Each `is*` function answers
// "does the pattern complete at bar i?" — geometry only, gated by
// `priorTrend` so a shape only counts as a *reversal* when it follows the
// trend it's supposed to reverse (mirrors the SMA50 trend filters already
// used by Dip Buy / Rip Sell / Liquidity Sweep in strategies.ts).

import type { Candle } from "@/lib/indicators";

export type TrendDirection = "up" | "down" | "flat";

function bodySize(c: Candle): number { return Math.abs(c.c - c.o); }
function candleRange(c: Candle): number { return c.h - c.l; }
function upperWick(c: Candle): number { return c.h - Math.max(c.o, c.c); }
function lowerWick(c: Candle): number { return Math.min(c.o, c.c) - c.l; }
function isBullishCandle(c: Candle): boolean { return c.c > c.o; }
function isBearishCandle(c: Candle): boolean { return c.c < c.o; }
function avg(xs: number[]): number { return xs.reduce((s, x) => s + x, 0) / xs.length; }

/**
 * Trend of the `lookback` bars ending at index i, via a split-window average
 * slope (first half vs second half of the window). Returns "flat" both when
 * there isn't enough history (i - lookback < 0) and when the slope is inside
 * a +/-0.15% dead zone — deliberately conservative, since every detector
 * below treats "flat" the same as "wrong direction" (no reversal context).
 */
export function priorTrend(bars: Candle[], i: number, lookback = 10): TrendDirection {
  if (i < 0 || i - lookback < 0) return "flat";
  const window = bars.slice(i - lookback, i + 1).map((b) => b.c);
  const mid = Math.floor(window.length / 2);
  const firstAvg = avg(window.slice(0, mid));
  const secondAvg = avg(window.slice(mid));
  if (firstAvg === 0) return "flat";
  const change = (secondAvg - firstAvg) / firstAvg;
  const EPS = 0.0015;
  if (change > EPS) return "up";
  if (change < -EPS) return "down";
  return "flat";
}

/** Small body in the upper part of the range, lower wick >= 2x body, upper
 *  wick <= 0.3x body, following a downtrend. */
export function isHammer(bars: Candle[], i: number): boolean {
  const c = bars[i];
  if (candleRange(c) <= 0) return false;
  const body = bodySize(c);
  if (body <= 0) return false;
  if (lowerWick(c) < 2 * body) return false;
  if (upperWick(c) > 0.3 * body) return false;
  return priorTrend(bars, i - 1, 10) === "down";
}

/** Mirror of Hammer: small body in the lower part of the range, upper wick
 *  >= 2x body, lower wick <= 0.3x body, following an uptrend. */
export function isShootingStar(bars: Candle[], i: number): boolean {
  const c = bars[i];
  if (candleRange(c) <= 0) return false;
  const body = bodySize(c);
  if (body <= 0) return false;
  if (upperWick(c) < 2 * body) return false;
  if (lowerWick(c) > 0.3 * body) return false;
  return priorTrend(bars, i - 1, 10) === "up";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test src/lib/trading/candlestickPatterns.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/trading/candlestickPatterns.ts src/lib/trading/candlestickPatterns.test.ts
git commit -m "feat: add priorTrend + Hammer/Shooting Star candlestick detectors"
```

---

### Task 2: Two-candle patterns — Engulfing, Piercing Line, Dark Cloud Cover

**Files:**
- Modify: `src/lib/trading/candlestickPatterns.ts` (append 4 functions)
- Modify: `src/lib/trading/candlestickPatterns.test.ts` (append tests, add imports)

**Interfaces:**
- Consumes: `priorTrend`, `bodySize`/`isBullishCandle`/`isBearishCandle` internal helpers from Task 1 (same file, no import needed).
- Produces: `export function isBullishEngulfing(bars, i): boolean`; `export function isBearishEngulfing(bars, i): boolean`; `export function isPiercingLine(bars, i): boolean`; `export function isDarkCloudCover(bars, i): boolean`.

- [ ] **Step 1: Write the failing tests**

In `src/lib/trading/candlestickPatterns.test.ts`, change the import line to:

```ts
import {
  priorTrend, isHammer, isShootingStar,
  isBullishEngulfing, isBearishEngulfing, isPiercingLine, isDarkCloudCover,
} from "./candlestickPatterns";
```

Append at the end of the file:

```ts
test("Bullish Engulfing: a bullish body engulfing the prior bearish body after a downtrend fires", () => {
  const bars = [...DOWN, bar(15 * HOUR, 110, 111, 104, 105), bar(16 * HOUR, 104, 113, 103, 112)];
  assert.equal(isBullishEngulfing(bars, 16), true);
});

test("Bullish Engulfing: same shape after an uptrend does not fire (trend filter)", () => {
  const bars = [...UP, bar(15 * HOUR, 110, 111, 104, 105), bar(16 * HOUR, 104, 113, 103, 112)];
  assert.equal(isBullishEngulfing(bars, 16), false);
});

test("Bearish Engulfing: a bearish body engulfing the prior bullish body after an uptrend fires", () => {
  const bars = [...UP, bar(15 * HOUR, 100, 106, 99, 105), bar(16 * HOUR, 106, 107, 91, 92)];
  assert.equal(isBearishEngulfing(bars, 16), true);
});

test("Bearish Engulfing: same shape after a downtrend does not fire (trend filter)", () => {
  const bars = [...DOWN, bar(15 * HOUR, 100, 106, 99, 105), bar(16 * HOUR, 106, 107, 91, 92)];
  assert.equal(isBearishEngulfing(bars, 16), false);
});

test("Piercing Line: gap-down close back above the prior body's midpoint after a downtrend fires", () => {
  const bars = [...DOWN, bar(15 * HOUR, 120, 121, 109, 110), bar(16 * HOUR, 108, 118, 107, 117)];
  assert.equal(isPiercingLine(bars, 16), true);
});

test("Piercing Line: same shape after an uptrend does not fire (trend filter)", () => {
  const bars = [...UP, bar(15 * HOUR, 120, 121, 109, 110), bar(16 * HOUR, 108, 118, 107, 117)];
  assert.equal(isPiercingLine(bars, 16), false);
});

test("Dark Cloud Cover: gap-up close back below the prior body's midpoint after an uptrend fires", () => {
  const bars = [...UP, bar(15 * HOUR, 100, 111, 99, 110), bar(16 * HOUR, 112, 113, 102, 103)];
  assert.equal(isDarkCloudCover(bars, 16), true);
});

test("Dark Cloud Cover: same shape after a downtrend does not fire (trend filter)", () => {
  const bars = [...DOWN, bar(15 * HOUR, 100, 111, 99, 110), bar(16 * HOUR, 112, 113, 102, 103)];
  assert.equal(isDarkCloudCover(bars, 16), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test src/lib/trading/candlestickPatterns.test.ts`
Expected: FAIL — `isBullishEngulfing`/`isBearishEngulfing`/`isPiercingLine`/`isDarkCloudCover` not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/trading/candlestickPatterns.ts`:

```ts
/** Bearish candle followed by a bullish candle whose body fully engulfs it
 *  (opens at/below the prior close, closes at/above the prior open), after
 *  a downtrend. */
export function isBullishEngulfing(bars: Candle[], i: number): boolean {
  if (i < 1) return false;
  const prev = bars[i - 1], cur = bars[i];
  if (!isBearishCandle(prev) || !isBullishCandle(cur)) return false;
  if (cur.o > prev.c || cur.c < prev.o) return false;
  if (bodySize(cur) <= bodySize(prev)) return false;
  return priorTrend(bars, i - 2, 10) === "down";
}

/** Mirror of Bullish Engulfing: bullish candle followed by a bearish candle
 *  that engulfs it, after an uptrend. */
export function isBearishEngulfing(bars: Candle[], i: number): boolean {
  if (i < 1) return false;
  const prev = bars[i - 1], cur = bars[i];
  if (!isBullishCandle(prev) || !isBearishCandle(cur)) return false;
  if (cur.o < prev.c || cur.c > prev.o) return false;
  if (bodySize(cur) <= bodySize(prev)) return false;
  return priorTrend(bars, i - 2, 10) === "up";
}

/** Long bearish candle, then a bullish candle that gaps down (opens at/below
 *  the prior close) and closes above the prior body's midpoint but below the
 *  prior open — a partial, not full, engulf — after a downtrend. */
export function isPiercingLine(bars: Candle[], i: number): boolean {
  if (i < 1) return false;
  const prev = bars[i - 1], cur = bars[i];
  if (!isBearishCandle(prev) || !isBullishCandle(cur)) return false;
  if (bodySize(prev) <= 0) return false;
  const prevMid = (prev.o + prev.c) / 2;
  if (cur.o > prev.c) return false;
  if (cur.c <= prevMid || cur.c >= prev.o) return false;
  return priorTrend(bars, i - 2, 10) === "down";
}

/** Mirror of Piercing Line: long bullish candle, then a bearish candle that
 *  gaps up and closes below the prior body's midpoint but above the prior
 *  open, after an uptrend. */
export function isDarkCloudCover(bars: Candle[], i: number): boolean {
  if (i < 1) return false;
  const prev = bars[i - 1], cur = bars[i];
  if (!isBullishCandle(prev) || !isBearishCandle(cur)) return false;
  if (bodySize(prev) <= 0) return false;
  const prevMid = (prev.o + prev.c) / 2;
  if (cur.o < prev.c) return false;
  if (cur.c >= prevMid || cur.c <= prev.o) return false;
  return priorTrend(bars, i - 2, 10) === "up";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test src/lib/trading/candlestickPatterns.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/trading/candlestickPatterns.ts src/lib/trading/candlestickPatterns.test.ts
git commit -m "feat: add Engulfing/Piercing Line/Dark Cloud Cover candlestick detectors"
```

---

### Task 3: Three-candle patterns — Star patterns, Soldiers, Crows

**Files:**
- Modify: `src/lib/trading/candlestickPatterns.ts` (append 4 functions)
- Modify: `src/lib/trading/candlestickPatterns.test.ts` (append tests, add imports)

**Interfaces:**
- Consumes: `priorTrend` + internal helpers from Task 1 (same file).
- Produces: `export function isMorningStar(bars, i): boolean`; `export function isEveningStar(bars, i): boolean`; `export function isThreeWhiteSoldiers(bars, i): boolean`; `export function isThreeBlackCrows(bars, i): boolean`.

- [ ] **Step 1: Write the failing tests**

In `src/lib/trading/candlestickPatterns.test.ts`, change the import line to:

```ts
import {
  priorTrend, isHammer, isShootingStar,
  isBullishEngulfing, isBearishEngulfing, isPiercingLine, isDarkCloudCover,
  isMorningStar, isEveningStar, isThreeWhiteSoldiers, isThreeBlackCrows,
} from "./candlestickPatterns";
```

Append at the end of the file:

```ts
test("Morning Star: bearish + small gapped star + bullish close above midpoint after a downtrend fires", () => {
  const bars = [...DOWN, bar(15 * HOUR, 130, 131, 119, 120), bar(16 * HOUR, 115, 116, 113, 114), bar(17 * HOUR, 116, 128, 115, 127)];
  assert.equal(isMorningStar(bars, 17), true);
});

test("Morning Star: same shape after an uptrend does not fire (trend filter)", () => {
  const bars = [...UP, bar(15 * HOUR, 130, 131, 119, 120), bar(16 * HOUR, 115, 116, 113, 114), bar(17 * HOUR, 116, 128, 115, 127)];
  assert.equal(isMorningStar(bars, 17), false);
});

test("Evening Star: bullish + small gapped star + bearish close below midpoint after an uptrend fires", () => {
  const bars = [...UP, bar(15 * HOUR, 100, 111, 99, 110), bar(16 * HOUR, 115, 117, 114, 116), bar(17 * HOUR, 114, 115, 102, 103)];
  assert.equal(isEveningStar(bars, 17), true);
});

test("Evening Star: same shape after a downtrend does not fire (trend filter)", () => {
  const bars = [...DOWN, bar(15 * HOUR, 100, 111, 99, 110), bar(16 * HOUR, 115, 117, 114, 116), bar(17 * HOUR, 114, 115, 102, 103)];
  assert.equal(isEveningStar(bars, 17), false);
});

test("Three White Soldiers: three rising bullish closes, each opening inside the prior body, after a downtrend fires", () => {
  const bars = [...DOWN, bar(15 * HOUR, 100, 106, 99, 105), bar(16 * HOUR, 102, 111.5, 101, 110), bar(17 * HOUR, 105, 118, 104, 116)];
  assert.equal(isThreeWhiteSoldiers(bars, 17), true);
});

test("Three White Soldiers: same shape after an uptrend does not fire (trend filter)", () => {
  const bars = [...UP, bar(15 * HOUR, 100, 106, 99, 105), bar(16 * HOUR, 102, 111.5, 101, 110), bar(17 * HOUR, 105, 118, 104, 116)];
  assert.equal(isThreeWhiteSoldiers(bars, 17), false);
});

test("Three Black Crows: three falling bearish closes, each opening inside the prior body, after an uptrend fires", () => {
  const bars = [...UP, bar(15 * HOUR, 105, 106, 99, 100), bar(16 * HOUR, 103, 104, 93, 95), bar(17 * HOUR, 100, 101, 86, 89)];
  assert.equal(isThreeBlackCrows(bars, 17), true);
});

test("Three Black Crows: same shape after a downtrend does not fire (trend filter)", () => {
  const bars = [...DOWN, bar(15 * HOUR, 105, 106, 99, 100), bar(16 * HOUR, 103, 104, 93, 95), bar(17 * HOUR, 100, 101, 86, 89)];
  assert.equal(isThreeBlackCrows(bars, 17), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test src/lib/trading/candlestickPatterns.test.ts`
Expected: FAIL — `isMorningStar`/`isEveningStar`/`isThreeWhiteSoldiers`/`isThreeBlackCrows` not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/trading/candlestickPatterns.ts`:

```ts
/** Long bearish candle, a small-bodied "star" that gaps below its body, then
 *  a bullish candle closing back above the first candle's midpoint, after a
 *  downtrend. */
export function isMorningStar(bars: Candle[], i: number): boolean {
  if (i < 2) return false;
  const first = bars[i - 2], star = bars[i - 1], third = bars[i];
  if (!isBearishCandle(first) || !isBullishCandle(third)) return false;
  const firstBody = bodySize(first);
  if (firstBody <= 0) return false;
  if (bodySize(star) > 0.5 * firstBody) return false;
  if (Math.max(star.o, star.c) >= Math.min(first.o, first.c)) return false;
  if (third.c <= (first.o + first.c) / 2) return false;
  return priorTrend(bars, i - 3, 10) === "down";
}

/** Mirror of Morning Star: long bullish candle, a small-bodied star gapping
 *  above its body, then a bearish candle closing back below the first
 *  candle's midpoint, after an uptrend. */
export function isEveningStar(bars: Candle[], i: number): boolean {
  if (i < 2) return false;
  const first = bars[i - 2], star = bars[i - 1], third = bars[i];
  if (!isBullishCandle(first) || !isBearishCandle(third)) return false;
  const firstBody = bodySize(first);
  if (firstBody <= 0) return false;
  if (bodySize(star) > 0.5 * firstBody) return false;
  if (Math.min(star.o, star.c) <= Math.max(first.o, first.c)) return false;
  if (third.c >= (first.o + first.c) / 2) return false;
  return priorTrend(bars, i - 3, 10) === "up";
}

/** Three consecutive bullish candles, each closing higher than the last,
 *  each opening inside the previous candle's body, each with a small upper
 *  wick (strong closes near the high), after a downtrend. */
export function isThreeWhiteSoldiers(bars: Candle[], i: number): boolean {
  if (i < 2) return false;
  const [a, b, c] = [bars[i - 2], bars[i - 1], bars[i]];
  for (const k of [a, b, c]) {
    if (!isBullishCandle(k)) return false;
    const body = bodySize(k);
    if (body <= 0 || upperWick(k) > 0.3 * body) return false;
  }
  if (!(b.c > a.c && c.c > b.c)) return false;
  if (!(b.o > a.o && b.o < a.c)) return false;
  if (!(c.o > b.o && c.o < b.c)) return false;
  return priorTrend(bars, i - 3, 10) === "down";
}

/** Mirror of Three White Soldiers: three consecutive bearish candles, each
 *  closing lower, each opening inside the previous candle's body, each with
 *  a small lower wick, after an uptrend. */
export function isThreeBlackCrows(bars: Candle[], i: number): boolean {
  if (i < 2) return false;
  const [a, b, c] = [bars[i - 2], bars[i - 1], bars[i]];
  for (const k of [a, b, c]) {
    if (!isBearishCandle(k)) return false;
    const body = bodySize(k);
    if (body <= 0 || lowerWick(k) > 0.3 * body) return false;
  }
  if (!(b.c < a.c && c.c < b.c)) return false;
  if (!(b.o < a.o && b.o > a.c)) return false;
  if (!(c.o < b.o && c.o > b.c)) return false;
  return priorTrend(bars, i - 3, 10) === "up";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test src/lib/trading/candlestickPatterns.test.ts`
Expected: PASS (23 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/trading/candlestickPatterns.ts src/lib/trading/candlestickPatterns.test.ts
git commit -m "feat: add Star/Soldiers/Crows candlestick detectors"
```

---

### Task 4: Wire all 10 patterns + combo into the strategy registry

**Files:**
- Modify: `src/lib/trading/strategies.ts:1-15` (imports), `:334-335` (insert 10 `Strategy` consts before `export type CombineMode`), `:377-407` (append keys to `STRATEGIES`)
- Modify: `src/lib/trading/strategies.test.ts` (append fixtures + tests)

**Interfaces:**
- Consumes: `isHammer, isShootingStar, isBullishEngulfing, isBearishEngulfing, isPiercingLine, isDarkCloudCover, isMorningStar, isEveningStar, isThreeWhiteSoldiers, isThreeBlackCrows` from `./candlestickPatterns` (Tasks 1-3). `Strategy`, `combineStrategies`, `STRATEGIES`, `getStrategy` already defined in this file.
- Produces: 10 new resolvable keys (`hammer`, `shooting-star`, `bullish-engulfing`, `bearish-engulfing`, `piercing-line`, `dark-cloud-cover`, `morning-star`, `evening-star`, `three-white-soldiers`, `three-black-crows`) plus `candlestick-any`, all resolvable via `getStrategy(key)`. No other file needs to change for these to work in `/api/invest`, `/api/scan-all`, `runScheduledScan`, or the portfolio PATCH validator — they all already call `getStrategy`.

- [ ] **Step 1: Write the failing tests**

In `src/lib/trading/strategies.test.ts`, append at the end of the file:

```ts
function downtrendPrefix(n: number, startClose: number, step: number): Candle[] {
  return Array.from({ length: n }, (_, k) => {
    const c = startClose - k * step;
    return bar(k * HOUR, c + step * 0.3, c + 1, c - 1, c);
  });
}

function uptrendPrefix(n: number, startClose: number, step: number): Candle[] {
  return Array.from({ length: n }, (_, k) => {
    const c = startClose + k * step;
    return bar(k * HOUR, c - step * 0.3, c + 1, c - 1, c);
  });
}

const CANDLE_DOWN = downtrendPrefix(15, 200, 3);
const CANDLE_UP = uptrendPrefix(15, 100, 3);

test("Hammer strategy: getStrategy resolves and fires long", () => {
  const bars = [...CANDLE_DOWN, bar(15 * HOUR, 100, 101.2, 95, 101)];
  assert.equal(getStrategy("hammer")!.build(bars)(15)?.side, "long");
});

test("Shooting Star strategy: getStrategy resolves and fires short", () => {
  const bars = [...CANDLE_UP, bar(15 * HOUR, 100, 105, 98.8, 99)];
  assert.equal(getStrategy("shooting-star")!.build(bars)(15)?.side, "short");
});

test("Bullish Engulfing strategy: getStrategy resolves and fires long", () => {
  const bars = [...CANDLE_DOWN, bar(15 * HOUR, 110, 111, 104, 105), bar(16 * HOUR, 104, 113, 103, 112)];
  assert.equal(getStrategy("bullish-engulfing")!.build(bars)(16)?.side, "long");
});

test("Bearish Engulfing strategy: getStrategy resolves and fires short", () => {
  const bars = [...CANDLE_UP, bar(15 * HOUR, 100, 106, 99, 105), bar(16 * HOUR, 106, 107, 91, 92)];
  assert.equal(getStrategy("bearish-engulfing")!.build(bars)(16)?.side, "short");
});

test("Piercing Line strategy: getStrategy resolves and fires long", () => {
  const bars = [...CANDLE_DOWN, bar(15 * HOUR, 120, 121, 109, 110), bar(16 * HOUR, 108, 118, 107, 117)];
  assert.equal(getStrategy("piercing-line")!.build(bars)(16)?.side, "long");
});

test("Dark Cloud Cover strategy: getStrategy resolves and fires short", () => {
  const bars = [...CANDLE_UP, bar(15 * HOUR, 100, 111, 99, 110), bar(16 * HOUR, 112, 113, 102, 103)];
  assert.equal(getStrategy("dark-cloud-cover")!.build(bars)(16)?.side, "short");
});

test("Morning Star strategy: getStrategy resolves and fires long", () => {
  const bars = [...CANDLE_DOWN, bar(15 * HOUR, 130, 131, 119, 120), bar(16 * HOUR, 115, 116, 113, 114), bar(17 * HOUR, 116, 128, 115, 127)];
  assert.equal(getStrategy("morning-star")!.build(bars)(17)?.side, "long");
});

test("Evening Star strategy: getStrategy resolves and fires short", () => {
  const bars = [...CANDLE_UP, bar(15 * HOUR, 100, 111, 99, 110), bar(16 * HOUR, 115, 117, 114, 116), bar(17 * HOUR, 114, 115, 102, 103)];
  assert.equal(getStrategy("evening-star")!.build(bars)(17)?.side, "short");
});

test("Three White Soldiers strategy: getStrategy resolves and fires long", () => {
  const bars = [...CANDLE_DOWN, bar(15 * HOUR, 100, 106, 99, 105), bar(16 * HOUR, 102, 111.5, 101, 110), bar(17 * HOUR, 105, 118, 104, 116)];
  assert.equal(getStrategy("three-white-soldiers")!.build(bars)(17)?.side, "long");
});

test("Three Black Crows strategy: getStrategy resolves and fires short", () => {
  const bars = [...CANDLE_UP, bar(15 * HOUR, 105, 106, 99, 100), bar(16 * HOUR, 103, 104, 93, 95), bar(17 * HOUR, 100, 101, 86, 89)];
  assert.equal(getStrategy("three-black-crows")!.build(bars)(17)?.side, "short");
});

test("candlestick-any combo: fires when exactly one member pattern triggers", () => {
  const bars = [...CANDLE_DOWN, bar(15 * HOUR, 100, 101.2, 95, 101)]; // Hammer fixture
  assert.equal(getStrategy("candlestick-any")!.build(bars)(15)?.side, "long");
});

test("registry exposes all 10 candlestick patterns + the combo by key", () => {
  const keys = STRATEGIES.map((s) => s.key);
  for (const k of [
    "hammer", "shooting-star", "bullish-engulfing", "bearish-engulfing",
    "piercing-line", "dark-cloud-cover", "morning-star", "evening-star",
    "three-white-soldiers", "three-black-crows", "candlestick-any",
  ]) {
    assert.ok(keys.includes(k), `missing ${k}`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test src/lib/trading/strategies.test.ts`
Expected: FAIL — `getStrategy("hammer")` etc. return `null` (`.build` called on `null`).

- [ ] **Step 3: Write the implementation**

In `src/lib/trading/strategies.ts`, change the import block (lines 6-15) to add the candlestick import:

```ts
import {
  sma, ema, rsi, macd, atr, adx, anchoredVWAP, dailyAnchor, weeklyAnchor, detectLiquiditySweep, estimatedDelta, type Candle,
} from "@/lib/indicators";
import { decideSetup, type ScanSnapshot } from "./scanner";
import { lorentzianSeries } from "@/lib/lc/lorentzian";
import {
  isHammer, isShootingStar, isBullishEngulfing, isBearishEngulfing, isPiercingLine, isDarkCloudCover,
  isMorningStar, isEveningStar, isThreeWhiteSoldiers, isThreeBlackCrows,
} from "./candlestickPatterns";
// Type-only: scanner.ts (imported below via getStrategy in combineStrategies)
// is also imported by engine.ts, so a runtime import of engine.ts's
// DEFAULT_COST_MODEL here would create a circular require. The value is
// duplicated (matches engine.ts's DEFAULT_COST_MODEL) rather than imported.
import type { CostModel } from "@/lib/backtest/engine";
```

Insert the 10 `Strategy` consts right after `swingTrendContinuation`'s closing `};` (currently line 334) and before `export type CombineMode` (currently line 336):

```ts
/** Hammer — small body near the top of the range with a long lower wick,
 *  after a downtrend. Classic single-candle bullish reversal. */
const hammer: Strategy = {
  key: "hammer",
  label: "Hammer",
  build(bars) {
    return (i) => (isHammer(bars, i) ? { side: "long", note: "hammer reversal" } : null);
  },
};

/** Shooting Star — mirror of Hammer: small body near the bottom of the
 *  range with a long upper wick, after an uptrend. */
const shootingStar: Strategy = {
  key: "shooting-star",
  label: "Shooting Star",
  build(bars) {
    return (i) => (isShootingStar(bars, i) ? { side: "short", note: "shooting star reversal" } : null);
  },
};

/** Bullish Engulfing — a bullish candle's body fully engulfs the prior
 *  bearish candle's body, after a downtrend. */
const bullishEngulfing: Strategy = {
  key: "bullish-engulfing",
  label: "Bullish Engulfing",
  build(bars) {
    return (i) => (isBullishEngulfing(bars, i) ? { side: "long", note: "bullish engulfing" } : null);
  },
};

/** Bearish Engulfing — mirror of Bullish Engulfing, after an uptrend. */
const bearishEngulfing: Strategy = {
  key: "bearish-engulfing",
  label: "Bearish Engulfing",
  build(bars) {
    return (i) => (isBearishEngulfing(bars, i) ? { side: "short", note: "bearish engulfing" } : null);
  },
};

/** Piercing Line — a bullish candle gaps down then closes back above the
 *  prior bearish candle's midpoint, after a downtrend. */
const piercingLine: Strategy = {
  key: "piercing-line",
  label: "Piercing Line",
  build(bars) {
    return (i) => (isPiercingLine(bars, i) ? { side: "long", note: "piercing line" } : null);
  },
};

/** Dark Cloud Cover — mirror of Piercing Line, after an uptrend. */
const darkCloudCover: Strategy = {
  key: "dark-cloud-cover",
  label: "Dark Cloud Cover",
  build(bars) {
    return (i) => (isDarkCloudCover(bars, i) ? { side: "short", note: "dark cloud cover" } : null);
  },
};

/** Morning Star — bearish candle, small gapped star, bullish candle closing
 *  back into the first candle's body, after a downtrend. */
const morningStar: Strategy = {
  key: "morning-star",
  label: "Morning Star",
  build(bars) {
    return (i) => (isMorningStar(bars, i) ? { side: "long", note: "morning star" } : null);
  },
};

/** Evening Star — mirror of Morning Star, after an uptrend. */
const eveningStar: Strategy = {
  key: "evening-star",
  label: "Evening Star",
  build(bars) {
    return (i) => (isEveningStar(bars, i) ? { side: "short", note: "evening star" } : null);
  },
};

/** Three White Soldiers — three consecutive strong bullish candles, each
 *  closing higher, after a downtrend. */
const threeWhiteSoldiers: Strategy = {
  key: "three-white-soldiers",
  label: "Three White Soldiers",
  build(bars) {
    return (i) => (isThreeWhiteSoldiers(bars, i) ? { side: "long", note: "three white soldiers" } : null);
  },
};

/** Three Black Crows — mirror of Three White Soldiers, after an uptrend. */
const threeBlackCrows: Strategy = {
  key: "three-black-crows",
  label: "Three Black Crows",
  build(bars) {
    return (i) => (isThreeBlackCrows(bars, i) ? { side: "short", note: "three black crows" } : null);
  },
};

```

Modify the `STRATEGIES` array (currently lines 377-407) — add the 10 new strategies and the combo right before the closing `];`:

```ts
export const STRATEGIES: Strategy[] = [
  trendPullback,
  emaCross,
  openingRangeBreakout,
  fairValueGap,
  dipBuy,
  ripSell,
  bullFlag,
  volSpike,
  liquiditySweep,
  swingTrendContinuation,
  hammer,
  shootingStar,
  bullishEngulfing,
  bearishEngulfing,
  piercingLine,
  darkCloudCover,
  morningStar,
  eveningStar,
  threeWhiteSoldiers,
  threeBlackCrows,
  // Combos of the positive-edge members (EMA Cross excluded — it backtests negative).
  combineStrategies("combo-or", "Combo OR (Trend+ORB+FVG)", ["trend-pullback", "orb", "fvg"], "any"),
  combineStrategies("combo-vote", "Combo Vote≥2 (Trend+ORB+FVG)", ["trend-pullback", "orb", "fvg"], "vote", { minVotes: 2, window: 3 }),
  // Long + short specialists for crypto (positive-edge members only, ORB dropped).
  combineStrategies("combo-all", "Combo Vote≥2 (Trend+FVG+Dip+Rip)", ["trend-pullback", "fvg", "mean-rev", "rip-sell"], "vote", { minVotes: 2, window: 3 }),
  // Gold Desk multi-strategy: vote>=2 of the 3 members that backtest positive at
  // the desk's own cadence (1d/5y GC=F) — trend breakout, pullback continuation,
  // and oversold-bounce — so a setup needs two independent criteria to agree
  // before entering, catching more conditions than swing-trend-continuation
  // alone (which stands aside whenever ADX<=25) without OR mode's noise.
  // Picked by a minVotes x window parameter sweep against the free backtest
  // engine (9 configs; see chat record): minVotes=1 degenerates to OR (PF 1.30,
  // 47% drawdown), minVotes=3 never fires (0 trades — too strict), minVotes=2
  // window=3 dominates every other window on PF/Sharpe/drawdown (PF 3.25,
  // 72.2% win rate, 11.7% drawdown, +$50.09/5y vs +$21.55 solo).
  // Rip-sell, vol-spike, liquidity-sweep excluded from membership: all
  // backtest negative or near-silent (1 signal/5y) on daily gold bars.
  { ...combineStrategies("combo-gold", "Gold Multi-Strategy Vote≥2 (Trend Cont.+Pullback+Dip Buy)", ["swing-trend-continuation", "trend-pullback", "mean-rev"], "vote", { minVotes: 2, window: 3 }),
    preferredExit: swingTrendContinuation.preferredExit },
  // Candlestick reversal patterns (pure OHLCV + trend filter) — "any" fires
  // when exactly one member pattern triggers this bar.
  combineStrategies(
    "candlestick-any",
    "Candlestick Pattern (Any)",
    [
      "hammer", "bullish-engulfing", "piercing-line", "morning-star", "three-white-soldiers",
      "shooting-star", "bearish-engulfing", "dark-cloud-cover", "evening-star", "three-black-crows",
    ],
    "any",
  ),
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test src/lib/trading/strategies.test.ts`
Expected: PASS (all tests, including the 12 new ones).

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: PASS — all tests across `src/**/*.test.ts` pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/trading/strategies.ts src/lib/trading/strategies.test.ts
git commit -m "feat: register 10 candlestick pattern strategies + candlestick-any combo"
```

---

### Task 5: Add candlestick patterns to the Backtest Lab

**Files:**
- Modify: `src/app/backtest/page.tsx:31-58` (add `CANDLESTICK_CONFIGS`), `:72-93` (`run()` mode type + configs ternary), `:116-132` (add comparison button)

**Interfaces:**
- Consumes: the 10 pattern keys + `candlestick-any` from Task 4, via the existing `POST /api/backtest` route (already resolves any `STRATEGIES` member — no API change needed).
- Produces: nothing consumed by later tasks (this is the final task).

- [ ] **Step 1: Add the config array**

In `src/app/backtest/page.tsx`, after the existing `CHART_GOLD_CONFIGS` array (ends at line 58), add:

```ts
// Candlestick reversal patterns (pure OHLCV, trend-filtered) — same 1h
// timeframe as the strategy/combo comparisons above.
const CANDLESTICK_CONFIGS = [
  { interval: "1h", range: "3mo", strategy: "hammer" },
  { interval: "1h", range: "3mo", strategy: "shooting-star" },
  { interval: "1h", range: "3mo", strategy: "bullish-engulfing" },
  { interval: "1h", range: "3mo", strategy: "bearish-engulfing" },
  { interval: "1h", range: "3mo", strategy: "piercing-line" },
  { interval: "1h", range: "3mo", strategy: "dark-cloud-cover" },
  { interval: "1h", range: "3mo", strategy: "morning-star" },
  { interval: "1h", range: "3mo", strategy: "evening-star" },
  { interval: "1h", range: "3mo", strategy: "three-white-soldiers" },
  { interval: "1h", range: "3mo", strategy: "three-black-crows" },
  { interval: "1h", range: "3mo", strategy: "candlestick-any" },
];
```

- [ ] **Step 2: Wire the new mode into `run()`**

Change the `run` function signature (currently `async function run(mode: "timeframe" | "adx" | "strategy" | "combo" | "chart")`) to:

```ts
async function run(mode: "timeframe" | "adx" | "strategy" | "combo" | "chart" | "candlestick") {
```

Change the `configs` ternary inside `run()` to:

```ts
      const configs =
        mode === "timeframe" ? TIMEFRAME_CONFIGS
        : mode === "adx" ? ADX_CONFIGS
        : mode === "strategy" ? STRATEGY_CONFIGS
        : mode === "chart" ? CHART_GOLD_CONFIGS
        : mode === "candlestick" ? CANDLESTICK_CONFIGS
        : COMBO_CONFIGS;
```

(The `symbols` line below it, `const symbols = mode === "chart" ? ["GC=F"] : SYMBOLS;`, is unchanged — candlestick patterns run on both `SYMBOLS`, same as `strategy`/`combo`.)

- [ ] **Step 3: Add the comparison button**

In the button row (after the existing "Chart patterns — Gold 5m/15m" `<Button>`, currently ending at line 131), add:

```tsx
          <Button variant="outline" onClick={() => run("candlestick")} disabled={!!busy}>
            {busy === "candlestick" ? "Running…" : "Candlestick patterns (1h)"}
          </Button>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors. (This page has no `*.test.tsx` file — UI pages aren't unit-tested in this codebase, per existing convention; see `docs/superpowers/specs/2026-06-15-max-drawdown-circuit-breaker-design.md`'s Testing section for the same pattern.)

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, open `/backtest`, click "Candlestick patterns (1h)".
Expected: a results table renders with 11 rows per symbol (10 patterns + `candlestick-any`), each showing signals/trades/win%/P&L — no `error` cells (a per-row `error` string would indicate the strategy key failed to resolve).

- [ ] **Step 6: Commit**

```bash
git add src/app/backtest/page.tsx
git commit -m "feat: add candlestick pattern comparison to the Backtest Lab"
```
