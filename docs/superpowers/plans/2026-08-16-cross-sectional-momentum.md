# Cross-Sectional Momentum Decile Study — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure, reproducible decile study that answers whether ranking US equities by 12-1 momentum predicts next-month returns, and report it against a six-gate battery declared in advance.

**Architecture:** One pass over the cached daily bars produces a `Snapshot` per monthly rebalance date — the eligible symbols, both pre-registered scores, and each symbol's realized next-month return. Every downstream computation (bucketing, both legs, the mega-cap subset, and all 1,000 permutation iterations) is arithmetic over those snapshots, so the expensive bar work happens once and the permutation null costs almost nothing.

**Tech Stack:** TypeScript (strict), `tsx --test` with `node:test` + `node:assert/strict`, no runtime dependencies beyond the existing `@/lib/indicators` `Candle` type and `@/lib/backtest/crossSectional/calendar`.

**Spec:** `docs/superpowers/specs/2026-08-16-cross-sectional-momentum-design.md`

## Global Constraints

- **Module purity.** No `process.env`, no database access, no `node:fs`, no `fetch`, no `Math.random`, no `Date.now()` anywhere under `src/lib/backtest/crossMomentum/`. Bars in, results out.
- **No runtime import from `src/lib/backtest/engine.ts`** (it pulls in Prisma). Type-only imports are acceptable; none are needed here.
- **Decile orientation is fixed: bucket index 0 is the LOWEST score (losers); the highest index is the HIGHEST score (winners).** Spread is `top - bottom`. Every sign in the gate battery depends on this.
- **Momentum window:** `lookback = 252`, `skip = 21`, so a bar needs **273** bars behind it. `scoreRaw(i) = close[i-21] / close[i-273] - 1`.
- **Vol-adjusted score:** `scoreRaw(i) / sigma`, where `sigma` is the **sample** (n-1) standard deviation of the 252 daily returns over the same window. Left unannualized — ranking is invariant to a positive constant.
- **Buckets: 10. Blocks: 6, sizes 10/10/10/10/10/9 at N=59. Permutation iterations: 1,000. `RHO_MIN = 0.60`. `P_MAX = 0.05`. `BLOCKS_POSITIVE_MIN = 4`. Cost: 5 bps per side, reported only — never gated.**
- **Gates run on gross returns.** The net-of-cost series is computed and reported alongside.
- **Test discipline (non-negotiable, from PR #2):** every no-lookahead test must perturb bar `i+1` **in place**. Appending bars past the end of a series proves nothing — the previous version of that test killed **0 of 32** injected lookahead mutations. Every perturbation test carries a **vacuity guard** asserting the perturbation *does* move something it is allowed to move.
- **Git:** never `git add -A`, `git add .`, or `git commit -a` — explicit paths only. Work happens on branch `research/cross-sectional-momentum`.
- Commits end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Run the full suite with `npm test`; a single file with `npx tsx --test <path>`.

## File Structure

All new files live in `src/lib/backtest/crossMomentum/`, with tests beside their source (the pattern `npm test` globs).

| File | Responsibility |
|---|---|
| `types.ts` | `MomentumConfig`, `ScoreLeg`, `Snapshot`, `BucketMonth`, `GateReport`. No logic. |
| `monthEnds.ts` | UTC month key; which union-calendar indices are month ends. |
| `rng.ts` | Seeded mulberry32 PRNG and Fisher-Yates shuffle. |
| `scores.ts` | Both momentum scores at a bar index, or `null` when the bar cannot support them. |
| `deciles.ts` | Rank an eligible cross-section into buckets; summarise a snapshot into a `BucketMonth`. |
| `study.ts` | The rebalance loop that produces `Snapshot[]`; the mega-cap subset selector. |
| `stats.ts` | mean, sample stdev, t-statistic, Spearman ρ, contiguous block split, turnover. |
| `permutation.ts` | The shuffled-ranking null and its p-value. |
| `gates.ts` | The six gates plus the reported-not-gated figures. |

`alignUniverse` and `dayKey` are **reused** from `src/lib/backtest/crossSectional/calendar.ts` rather than duplicated — they are generic, already tested, and unchanged by this work.

Runner (outside the pure module): `scripts/decile-momentum-study.mts`.

---

### Task 1: Types and month-end detection

**Files:**
- Create: `src/lib/backtest/crossMomentum/types.ts`
- Create: `src/lib/backtest/crossMomentum/monthEnds.ts`
- Test: `src/lib/backtest/crossMomentum/monthEnds.test.ts`

**Interfaces:**
- Consumes: `dayKey` from `@/lib/backtest/crossSectional/calendar`.
- Produces: `MomentumConfig`, `ScoreLeg`, `Snapshot`, `BucketMonth`, `GateReport` (types); `monthKey(day: number): number`; `monthEndIndices(days: number[]): number[]`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/backtest/crossMomentum/monthEnds.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { monthKey, monthEndIndices } from "./monthEnds";

/** Day key for a UTC date, matching `dayKey` in crossSectional/calendar. */
function key(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000 / 86_400);
}

test("monthKey separates months and joins days within one", () => {
  assert.equal(monthKey(key("2021-08-02")), monthKey(key("2021-08-31")));
  assert.notEqual(monthKey(key("2021-08-31")), monthKey(key("2021-09-01")));
  // Year rollover must not collide: December and the following January differ.
  assert.notEqual(monthKey(key("2021-12-31")), monthKey(key("2022-01-03")));
});

test("monthEndIndices flags the last trading day of each month", () => {
  const days = ["2021-08-30", "2021-08-31", "2021-09-01", "2021-09-30", "2021-10-01"].map(key);
  // Index 1 is the last August day, index 3 the last September day.
  assert.deepEqual(monthEndIndices(days), [1, 3]);
});

test("the final day is never a month end, which is what drops the partial period", () => {
  // 2026-08-14 is where the cached data stops. Its month is still in progress,
  // and a rebalance there would have no later rebalance to exit into, so the
  // trailing fortnight must not become a 59th observation.
  const days = ["2026-06-29", "2026-06-30", "2026-07-31", "2026-08-14"].map(key);
  assert.deepEqual(monthEndIndices(days), [1, 2]);
});

test("a month with a single trading day still produces one end", () => {
  const days = ["2021-08-31", "2021-09-15", "2021-10-04"].map(key);
  assert.deepEqual(monthEndIndices(days), [0, 1]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/backtest/crossMomentum/monthEnds.test.ts`
Expected: FAIL — `Cannot find module './monthEnds'`

- [ ] **Step 3: Write `types.ts`**

Create `src/lib/backtest/crossMomentum/types.ts`:

```ts
// Shapes for the cross-sectional momentum decile study. No logic here.

/** Which pre-registered score definition a computation is running against. */
export type ScoreLeg = "raw" | "volAdj";

export interface MomentumConfig {
  /** Trading days in the momentum window. */
  lookback: number;
  /** Trading days between the end of the window and the ranking bar. */
  skip: number;
  /** How many buckets the eligible cross-section is split into. */
  buckets: number;
  /** A rebalance date is skipped entirely below this many eligible symbols. */
  minEligible: number;
  /** One-way execution cost in basis points. Reported, never gated. */
  costBps: number;
  /** Seed for the permutation null. The module has no other randomness. */
  seed: number;
  /** Permutation iterations. */
  iterations: number;
  /** Contiguous sub-period blocks for the consistency gate. */
  blocks: number;
}

/**
 * One monthly rebalance, with every bar-level computation already done. Both
 * score legs live here because they share eligibility and realized returns;
 * computing them together means the bar work happens once.
 *
 * `symbols`, `scores.raw`, `scores.volAdj`, and `returns` are index-aligned.
 */
export interface Snapshot {
  /** Day key of the ranking date (the last union trading day of the month). */
  day: number;
  symbols: string[];
  scores: { raw: number[]; volAdj: number[] };
  /** Realized open-to-open return over the following month. */
  returns: number[];
}

/** One rebalance, summarised for a single leg. */
export interface BucketMonth {
  day: number;
  /** Index 0 is the lowest score (losers); the last index the highest (winners). */
  bucketReturns: number[];
  bucketSymbols: string[][];
  /** Equal-weight mean return of every eligible symbol that month. */
  universeReturn: number;
  eligible: number;
}

export interface GateReport {
  leg: ScoreLeg;
  months: number;
  monotonicity: { rho: number; pass: boolean };
  permutation: { p: number; pass: boolean };
  crossDefinition: { otherMeanSpread: number; pass: boolean };
  notTopOnly: { meanShortLegExcess: number; pass: boolean };
  megaCap: { meanSpread: number; months: number; pass: boolean };
  subPeriods: { positive: number; of: number; blockMeans: number[]; pass: boolean };
  /** Every gate passed. An AND, never a score to total up. */
  passed: boolean;
  // Reported, not gated.
  meanSpread: number;
  tStat: number;
  netMeanSpread: number;
  meanTurnover: number;
  bucketMeans: number[];
}
```

- [ ] **Step 4: Write `monthEnds.ts`**

Create `src/lib/backtest/crossMomentum/monthEnds.ts`:

```ts
// Monthly rebalancing needs to know which days on the shared union calendar are
// month ends. Day keys are UTC day counts (see dayKey in crossSectional/calendar),
// so the month a key belongs to has to be read back out of a Date.
const DAY_SECONDS = 86_400;

/** The UTC calendar month a day key falls in, as an orderable integer. */
export function monthKey(day: number): number {
  const d = new Date(day * DAY_SECONDS * 1000);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/**
 * Indices into `days` that are the last trading day of their UTC month.
 *
 * The final element is deliberately never counted. Its month is still in
 * progress as far as the data goes, and a rebalance there would have no later
 * rebalance to exit into — so excluding it is exactly what discards the partial
 * trailing period the spec calls for, rather than a separate special case.
 */
export function monthEndIndices(days: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < days.length - 1; i++) {
    if (monthKey(days[i + 1]) !== monthKey(days[i])) out.push(i);
  }
  return out;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test src/lib/backtest/crossMomentum/monthEnds.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean

- [ ] **Step 7: Commit**

```bash
git add src/lib/backtest/crossMomentum/types.ts src/lib/backtest/crossMomentum/monthEnds.ts src/lib/backtest/crossMomentum/monthEnds.test.ts
git commit -m "feat(crossMomentum): types and month-end detection"
```

---

### Task 2: Seeded PRNG and shuffle

**Files:**
- Create: `src/lib/backtest/crossMomentum/rng.ts`
- Test: `src/lib/backtest/crossMomentum/rng.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `mulberry32(seed: number): () => number`; `shuffle<T>(items: T[], rand: () => number): T[]` (shuffles **in place** and returns the same array).

- [ ] **Step 1: Write the failing test**

Create `src/lib/backtest/crossMomentum/rng.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mulberry32, shuffle } from "./rng";

test("the same seed reproduces the same stream", () => {
  // A permutation p-value that cannot be reproduced from its seed is not
  // evidence, so determinism here is load-bearing, not a nicety.
  const a = Array.from({ length: 10 }, mulberry32(42));
  const b = Array.from({ length: 10 }, mulberry32(42));
  assert.deepEqual(a, b);
});

test("different seeds produce different streams", () => {
  const a = Array.from({ length: 10 }, mulberry32(42));
  const b = Array.from({ length: 10 }, mulberry32(43));
  assert.notDeepEqual(a, b);
});

test("draws stay inside [0, 1)", () => {
  const rand = mulberry32(7);
  for (let i = 0; i < 5_000; i++) {
    const x = rand();
    assert.ok(x >= 0 && x < 1, `draw out of range: ${x}`);
  }
});

test("the same seed reproduces the same shuffle", () => {
  const source = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const a = shuffle([...source], mulberry32(99));
  const b = shuffle([...source], mulberry32(99));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, source); // vacuity guard: it must actually permute
});

test("shuffle is a permutation — nothing lost, nothing duplicated", () => {
  const source = Array.from({ length: 200 }, (_, i) => i);
  const out = shuffle([...source], mulberry32(3));
  assert.deepEqual([...out].sort((x, y) => x - y), source);
});

test("shuffle reaches the first element", () => {
  // A Fisher-Yates written with `i > 0` but drawing from `i` instead of `i + 1`
  // never moves anything into the last slot. Sampling many seeds pins that down.
  const seen = new Set<number>();
  for (let seed = 0; seed < 200; seed++) seen.add(shuffle([0, 1, 2], mulberry32(seed))[2]);
  assert.deepEqual([...seen].sort(), [0, 1, 2]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/backtest/crossMomentum/rng.test.ts`
Expected: FAIL — `Cannot find module './rng'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/backtest/crossMomentum/rng.ts`:

```ts
// The module is pure by contract, so Math.random is unavailable — and that is a
// feature: the permutation null has to be reproducible from its seed alone.

/** mulberry32: small, fast, and well-distributed enough for a shuffle. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Fisher-Yates, in place. Returns the same array for convenience. */
export function shuffle<T>(items: T[], rand: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/backtest/crossMomentum/rng.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/backtest/crossMomentum/rng.ts src/lib/backtest/crossMomentum/rng.test.ts
git commit -m "feat(crossMomentum): seeded PRNG and shuffle"
```

---

### Task 3: Momentum scores and eligibility

**Files:**
- Create: `src/lib/backtest/crossMomentum/scores.ts`
- Test: `src/lib/backtest/crossMomentum/scores.test.ts`

**Interfaces:**
- Consumes: `Candle` from `@/lib/indicators` (`{ t, o, h, l, c, v }`, all numbers).
- Produces: `momentumScores(candles: Candle[], i: number, lookback: number, skip: number): { raw: number; volAdj: number } | null`. `null` **is** the eligibility answer — there is no separate predicate.

- [ ] **Step 1: Write the failing test**

Create `src/lib/backtest/crossMomentum/scores.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { momentumScores } from "./scores";
import type { Candle } from "@/lib/indicators";

const DAY = 86_400;
const LOOKBACK = 252;
const SKIP = 21;

function bars(closes: number[]): Candle[] {
  // o !== c throughout, so anything reading the wrong field is visible.
  return closes.map((c, i) => ({ t: (18_262 + i) * DAY, o: c * 0.99, h: c * 1.02, l: c * 0.97, c, v: 1_000 }));
}

/** A gently rising series with enough variation for a non-zero sigma. */
function rising(n: number): Candle[] {
  return bars(Array.from({ length: n }, (_, i) => 100 * (1 + i * 0.001) + (i % 7) * 0.3));
}

test("the window needs exactly lookback + skip bars behind the ranking bar", () => {
  const c = rising(400);
  assert.equal(momentumScores(c, 272, LOOKBACK, SKIP), null);
  assert.notEqual(momentumScores(c, 273, LOOKBACK, SKIP), null);
});

test("the raw score is close[i - skip] / close[i - skip - lookback] - 1", () => {
  const c = rising(400);
  const i = 300;
  const expected = c[i - SKIP].c / c[i - SKIP - LOOKBACK].c - 1;
  assert.equal(momentumScores(c, i, LOOKBACK, SKIP)!.raw, expected);
});

test("the most recent `skip` bars are excluded from the score", () => {
  const c = rising(400);
  const base = momentumScores(c, 300, LOOKBACK, SKIP)!;
  const perturbed = c.map((x) => ({ ...x }));
  // Bar 290 sits inside the skipped window (i - skip = 279), so a score that
  // reads it is not 12-1 momentum at all.
  perturbed[290] = { ...perturbed[290], c: 5_000, o: 5_000, h: 5_000, l: 5_000 };
  assert.equal(momentumScores(perturbed, 300, LOOKBACK, SKIP)!.raw, base.raw);
});

test("the score at bar i cannot see bar i + 1", () => {
  // Rewriting bar i+1 IN PLACE is the only shape of test that detects an
  // interior lookahead. Appending bars past the end proves nothing — a loop
  // indexed by i structurally cannot read past its own last index, and that
  // version of this test killed 0 of 32 injected lookahead mutations.
  const c = rising(400);
  const base = momentumScores(c, 300, LOOKBACK, SKIP)!;
  const perturbed = c.map((x) => ({ ...x }));
  perturbed[301] = { ...perturbed[301], c: 9_999, o: 9_999, h: 9_999, l: 9_999, v: 1e9 };

  const after = momentumScores(perturbed, 300, LOOKBACK, SKIP)!;
  assert.equal(after.raw, base.raw);
  assert.equal(after.volAdj, base.volAdj);

  // Vacuity guard: bar 301 is the window's own `end` for i = 322 (window
  // 49..301, since end = 322 - 21 = 301 and start = 301 - 252 = 49), so the
  // perturbation MUST move both scores. Without this the assertions above
  // would also pass against a function that returns a constant.
  // NB i = 322, not 330. At 330 the window is 57..309 and bar 301 is strictly
  // interior, so it cannot move `raw` at all -- raw is a ratio of the two
  // endpoints only, and interior closes cancel. Asserting raw moves there is
  // unsatisfiable for any correct implementation.
  const movedBefore = momentumScores(c, 322, LOOKBACK, SKIP)!;
  const movedAfter = momentumScores(perturbed, 322, LOOKBACK, SKIP)!;
  assert.notEqual(movedAfter.raw, movedBefore.raw);
  assert.notEqual(movedAfter.volAdj, movedBefore.volAdj);
});

test("the volatility-adjusted score divides the raw score by the window's return sigma", () => {
  const c = rising(400);
  const i = 300;
  const end = i - SKIP;
  const start = end - LOOKBACK;
  const rets: number[] = [];
  for (let k = start + 1; k <= end; k++) rets.push(c[k].c / c[k - 1].c - 1);
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sigma = Math.sqrt(rets.reduce((a, r) => a + (r - m) ** 2, 0) / (rets.length - 1));

  const s = momentumScores(c, i, LOOKBACK, SKIP)!;
  assert.equal(rets.length, LOOKBACK); // the window carries exactly `lookback` returns
  assert.ok(Math.abs(s.volAdj - s.raw / sigma) < 1e-12);
});

test("a flat series is ineligible rather than infinite", () => {
  const flat = bars(Array.from({ length: 400 }, () => 100));
  assert.equal(momentumScores(flat, 300, LOOKBACK, SKIP), null);
});

test("a non-positive close in the window makes the bar ineligible", () => {
  const c = rising(400);
  const perturbed = c.map((x) => ({ ...x }));
  perturbed[100] = { ...perturbed[100], c: 0 };
  assert.equal(momentumScores(perturbed, 300, LOOKBACK, SKIP), null);
  // Vacuity guard: the same bar outside the window leaves the score intact.
  const outside = c.map((x) => ({ ...x }));
  outside[20] = { ...outside[20], c: 0 };
  assert.notEqual(momentumScores(outside, 300, LOOKBACK, SKIP), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/backtest/crossMomentum/scores.test.ts`
Expected: FAIL — `Cannot find module './scores'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/backtest/crossMomentum/scores.ts`:

```ts
// Both pre-registered score definitions, computed together because they share a
// window and a data-availability check. Everything reads bar indices <= i - skip,
// which is what makes the ranking causal.
import type { Candle } from "@/lib/indicators";

export interface MomentumScores {
  /** Classic 12-1: the return over the window, skipping the most recent month. */
  raw: number;
  /** The same return divided by the window's daily-return sigma. */
  volAdj: number;
}

/**
 * Momentum at bar `i`, or `null` when the bar cannot support it. `null` IS the
 * eligibility answer — there is no separate predicate to fall out of step with
 * this one.
 *
 * The window runs from `i - skip - lookback` to `i - skip` inclusive, so the
 * bar needs `lookback + skip` bars behind it (273 at the pinned values).
 */
export function momentumScores(
  candles: Candle[],
  i: number,
  lookback: number,
  skip: number,
): MomentumScores | null {
  const end = i - skip;
  const start = end - lookback;
  if (start < 0 || i >= candles.length) return null;

  const from = candles[start].c;
  const to = candles[end].c;
  if (!(from > 0) || !(to > 0)) return null;
  const raw = to / from - 1;

  // `lookback` daily returns across the same window. The loop starts at
  // start + 1 because each return needs its own previous close, which is why
  // the window is anchored at `start` rather than `start + 1`.
  const rets: number[] = [];
  let sum = 0;
  for (let k = start + 1; k <= end; k++) {
    const prev = candles[k - 1].c;
    if (!(prev > 0) || !(candles[k].c > 0)) return null;
    const r = candles[k].c / prev - 1;
    rets.push(r);
    sum += r;
  }
  if (rets.length < 2) return null;

  const m = sum / rets.length;
  let sq = 0;
  for (const r of rets) sq += (r - m) ** 2;
  const sigma = Math.sqrt(sq / (rets.length - 1));
  // A zero-variance window would divide to Infinity and sort to the top of every
  // ranking. Ineligible is the honest answer.
  if (!(sigma > 0)) return null;

  return { raw, volAdj: raw / sigma };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/backtest/crossMomentum/scores.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 5: Verify the lookahead test is load-bearing (mutation check)**

Temporarily change `const end = i - skip;` to `const end = i - skip + 1;` in `scores.ts`.

Run: `npx tsx --test src/lib/backtest/crossMomentum/scores.test.ts`
Expected: FAIL, and the named test `the raw score is close[i - skip] / close[i - skip - lookback] - 1` must be among the failures.

Then temporarily change the loop bound `k <= end` to `k <= end + 1`.
Expected: FAIL, with `the volatility-adjusted score divides the raw score by the window's return sigma` among the failures — it is the test whose `rets.length === LOOKBACK` assertion pins the return count.

Not `the score at bar i cannot see bar i + 1`: with `skip = 21`, bar `i + 1` sits
twenty-two bars past the window's end, far out of reach of a one-bar loop-bound
error. A `+1` here admits one extra bar into the sigma sum; it is a window-boundary
bug, not a lookahead.

**Restore both lines before continuing.** Run the file again and confirm PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/backtest/crossMomentum/scores.ts src/lib/backtest/crossMomentum/scores.test.ts
git commit -m "feat(crossMomentum): momentum scores with in-place lookahead tests"
```

---

### Task 4: Bucketing

**Files:**
- Create: `src/lib/backtest/crossMomentum/deciles.ts`
- Test: `src/lib/backtest/crossMomentum/deciles.test.ts`

**Interfaces:**
- Consumes: `Snapshot`, `BucketMonth`, `ScoreLeg` from `./types`.
- Produces:
  - `bucketBounds(n: number, buckets: number): Array<[number, number]>`
  - `bucketize(scores: number[], buckets: number): number[][]` — indices grouped by ascending score, bucket 0 lowest
  - `meanAt(values: number[], indices: number[]): number`
  - `bucketMonth(snap: Snapshot, leg: ScoreLeg, buckets: number): BucketMonth`
  - `spreadOf(month: BucketMonth): number` — top bucket minus bottom bucket

- [ ] **Step 1: Write the failing test**

Create `src/lib/backtest/crossMomentum/deciles.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketBounds, bucketize, meanAt, bucketMonth, spreadOf } from "./deciles";
import type { Snapshot } from "./types";

test("bucket 0 holds the lowest scores and the last bucket the highest", () => {
  // Orientation is load-bearing: every sign in the gate battery assumes it.
  const groups = bucketize([1, 5, 3, 2, 4], 5);
  assert.deepEqual(groups[0], [0]); // score 1 — the weakest
  assert.deepEqual(groups[4], [1]); // score 5 — the strongest
});

test("every symbol lands in exactly one bucket when n is not a multiple of the bucket count", () => {
  const scores = Array.from({ length: 59 }, (_, i) => i);
  const groups = bucketize(scores, 10);
  const flat = groups.flat().sort((a, b) => a - b);
  assert.equal(flat.length, 59, "no symbol dropped or duplicated");
  assert.deepEqual(flat, scores);
  assert.deepEqual(groups.map((g) => g.length), [5, 6, 6, 6, 6, 6, 6, 6, 6, 6]);
});

test("bucketBounds tile the range with no gap and no overlap", () => {
  const bounds = bucketBounds(491, 10);
  assert.equal(bounds[0][0], 0);
  assert.equal(bounds[9][1], 491);
  for (let k = 1; k < bounds.length; k++) assert.equal(bounds[k][0], bounds[k - 1][1]);
});

test("a cross-section smaller than the bucket count leaves empty buckets rather than throwing", () => {
  const groups = bucketize([3, 1, 2], 10);
  assert.equal(groups.length, 10);
  assert.equal(groups.flat().length, 3);
});

test("meanAt is the equal-weight mean of the selected entries", () => {
  assert.equal(meanAt([10, 20, 30, 40], [1, 3]), 30);
  assert.equal(meanAt([10, 20], []), 0);
});

function snap(scores: number[], returns: number[]): Snapshot {
  return {
    day: 100,
    symbols: scores.map((_, i) => `S${i}`),
    scores: { raw: scores, volAdj: scores.map((s) => -s) }, // legs deliberately opposed
    returns,
  };
}

test("bucketMonth reads the leg it is asked for, not whichever is first", () => {
  const s = snap([1, 2, 3, 4], [0.1, 0.2, 0.3, 0.4]);
  const raw = bucketMonth(s, "raw", 2);
  const vol = bucketMonth(s, "volAdj", 2);
  // volAdj reverses the ranking, so its buckets must invert.
  assert.deepEqual(raw.bucketSymbols, [["S0", "S1"], ["S2", "S3"]]);
  assert.deepEqual(vol.bucketSymbols, [["S3", "S2"], ["S1", "S0"]]);
});

test("bucketMonth reports the universe mean over every eligible symbol", () => {
  const s = snap([1, 2, 3, 4], [0.1, 0.2, 0.3, 0.4]);
  const m = bucketMonth(s, "raw", 2);
  assert.ok(Math.abs(m.universeReturn - 0.25) < 1e-12);
  assert.equal(m.eligible, 4);
  assert.equal(m.day, 100);
});

test("spreadOf is top bucket minus bottom bucket", () => {
  const m = bucketMonth(snap([1, 2, 3, 4], [0.1, 0.2, 0.3, 0.4]), "raw", 2);
  // top = mean(0.3, 0.4) = 0.35, bottom = mean(0.1, 0.2) = 0.15
  assert.ok(Math.abs(spreadOf(m) - 0.2) < 1e-12);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/backtest/crossMomentum/deciles.test.ts`
Expected: FAIL — `Cannot find module './deciles'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/backtest/crossMomentum/deciles.ts`:

```ts
// Turning a scored cross-section into equal-weight buckets. Bucket 0 is always
// the LOWEST score; the last bucket the highest. Every sign downstream depends
// on that, so it is stated here and nowhere overridden.
import type { BucketMonth, ScoreLeg, Snapshot } from "./types";

/**
 * Half-open [lo, hi) index ranges tiling 0..n. Using floor on both edges means
 * consecutive bounds share an endpoint, so the ranges neither gap nor overlap
 * and any remainder is spread across buckets rather than dropped.
 */
export function bucketBounds(n: number, buckets: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let k = 0; k < buckets; k++) {
    out.push([Math.floor((k * n) / buckets), Math.floor(((k + 1) * n) / buckets)]);
  }
  return out;
}

/** Indices into `scores`, grouped into `buckets` groups by ascending score. */
export function bucketize(scores: number[], buckets: number): number[][] {
  const order = scores.map((_, i) => i).sort((a, b) => scores[a] - scores[b]);
  return bucketBounds(scores.length, buckets).map(([lo, hi]) => order.slice(lo, hi));
}

/** Equal-weight mean of `values` at `indices`; 0 for an empty selection. */
export function meanAt(values: number[], indices: number[]): number {
  if (indices.length === 0) return 0;
  let sum = 0;
  for (const i of indices) sum += values[i];
  return sum / indices.length;
}

export function bucketMonth(snap: Snapshot, leg: ScoreLeg, buckets: number): BucketMonth {
  const groups = bucketize(snap.scores[leg], buckets);
  const all = snap.returns.map((_, i) => i);
  return {
    day: snap.day,
    bucketReturns: groups.map((g) => meanAt(snap.returns, g)),
    bucketSymbols: groups.map((g) => g.map((i) => snap.symbols[i])),
    universeReturn: meanAt(snap.returns, all),
    eligible: snap.symbols.length,
  };
}

/** Top bucket minus bottom bucket — winners minus losers. */
export function spreadOf(month: BucketMonth): number {
  const r = month.bucketReturns;
  return r[r.length - 1] - r[0];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/backtest/crossMomentum/deciles.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Verify the orientation test is load-bearing (mutation check)**

Temporarily change the comparator in `bucketize` to `(a, b) => scores[b] - scores[a]`.

Run: `npx tsx --test src/lib/backtest/crossMomentum/deciles.test.ts`
Expected: FAIL, with `bucket 0 holds the lowest scores and the last bucket the highest` among the failures.

**Restore the line.** Run again and confirm PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/backtest/crossMomentum/deciles.ts src/lib/backtest/crossMomentum/deciles.test.ts
git commit -m "feat(crossMomentum): decile bucketing"
```

---

### Task 5: The rebalance loop and the mega-cap subset

**Files:**
- Create: `src/lib/backtest/crossMomentum/study.ts`
- Test: `src/lib/backtest/crossMomentum/study.test.ts`

**Interfaces:**
- Consumes: `alignUniverse`, `dayKey` from `@/lib/backtest/crossSectional/calendar`; `monthEndIndices` from `./monthEnds`; `momentumScores` from `./scores`; `MomentumConfig`, `Snapshot` from `./types`; `Candle` from `@/lib/indicators`.
- Produces:
  - `buildSnapshots(bars: Map<string, Candle[]>, cfg: MomentumConfig): { snapshots: Snapshot[]; substitutions: number; unfillable: number }`
  - `topByDollarVolume(bars: Map<string, Candle[]>, days: number[], beforeDay: number, window: number, count: number): Set<string>`
  - `subsetBars(bars: Map<string, Candle[]>, keep: Set<string>): Map<string, Candle[]>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/backtest/crossMomentum/study.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSnapshots, topByDollarVolume, subsetBars } from "./study";
import { alignUniverse } from "@/lib/backtest/crossSectional/calendar";
import type { MomentumConfig } from "./types";
import type { Candle } from "@/lib/indicators";

const DAY = 86_400;
const START = 18_262; // 2020-01-01 as a day key

const cfg: MomentumConfig = {
  lookback: 252, skip: 21, buckets: 10, minEligible: 2,
  costBps: 5, seed: 1, iterations: 10, blocks: 6,
};

/**
 * Bars on consecutive UTC days. `o/c` deliberately varies by bar (0.975 at
 * bar 0 rising to 1.005 by bar 600), so a fill that reads the close instead
 * of the open produces a different return. A *constant* offset would cancel
 * out of any open-to-open vs. close-to-close ratio comparison; varying it
 * per bar means no two bars share a factor, so the ratios can never coincide.
 *
 * NB the factor MUST vary per bar. An earlier draft of this plan used a flat
 * `o = c * 0.99` and claimed it made a fill-at-close visible. It does not:
 * (c2 * 0.99) / (c1 * 0.99) === c2 / c1 exactly, so the mutation `.o` -> `.c`
 * left every test green, differing only by ~2e-16 of floating-point noise.
 * The stated range stays inside the fixture's own l = c * 0.97 / h = c * 1.02.
 */
function series(closes: number[], startDay = START): Candle[] {
  return closes.map((c, i) => ({
    t: (startDay + i) * DAY, o: c * (0.975 + i * 0.00005), h: c * 1.02, l: c * 0.97, c, v: 1_000,
  }));
}

function trend(n: number, perDay: number): number[] {
  return Array.from({ length: n }, (_, i) => 100 * (1 + i * perDay) + (i % 7) * 0.2);
}

/** Two symbols, ~600 days: long enough for a 273-bar warm-up plus rebalances. */
function twoSymbols(): Map<string, Candle[]> {
  return new Map([
    ["UP", series(trend(600, 0.002))],
    ["DOWN", series(trend(600, 0.0002))],
  ]);
}

test("snapshots start only once the warm-up is behind them", () => {
  const { snapshots } = buildSnapshots(twoSymbols(), cfg);
  assert.ok(snapshots.length > 0, "expected at least one rebalance");
  const firstDay = snapshots[0].day;
  // Bar 273 is the earliest eligible bar and is itself a month end (2020-09-30),
  // so the first rebalance lands on it exactly. A `>=` here would leave 30 bars
  // of slack: the previous month end is bar 243, so a warm-up short by up to
  // thirty bars would still produce START + 273 and pass.
  assert.equal(firstDay, START + 273, `first rebalance ${firstDay} is not the warm-up bar`);
});

test("returns are measured open-to-open, not close-to-close", () => {
  const bars = twoSymbols();
  const { snapshots } = buildSnapshots(bars, cfg);
  const s = snapshots[0];
  const i = s.symbols.indexOf("UP");
  const candles = bars.get("UP")!;

  // Locate the fill and exit bars from the snapshot days themselves.
  const fillDay = s.day + 1;
  const nextDay = snapshots[1].day + 1;
  const at = (d: number) => candles.findIndex((c) => Math.floor(c.t / DAY) === d);
  const expected = candles[at(nextDay)].o / candles[at(fillDay)].o - 1;

  assert.ok(Math.abs(s.returns[i] - expected) < 1e-12, `open-to-open expected ${expected}, got ${s.returns[i]}`);

  // Vacuity guard: the close-to-close number must differ meaningfully, or
  // this test would pass against a fill-at-close bug on floating-point noise
  // alone. A bare assert.notEqual is NOT enough — it is satisfied by a 2e-16
  // difference, which is exactly how the flat-0.99 fixture passed.
  const closeToClose = candles[at(nextDay)].c / candles[at(fillDay)].c - 1;
  assert.ok(Math.abs(expected - closeToClose) > 1e-6, `open- and close-based returns must differ meaningfully, got ${expected} vs ${closeToClose}`);
});

test("consecutive snapshots are one month apart and strictly increasing", () => {
  const { snapshots } = buildSnapshots(twoSymbols(), cfg);
  for (let i = 1; i < snapshots.length; i++) {
    assert.ok(snapshots[i].day > snapshots[i - 1].day, "rebalance days must advance");
  }
});

test("the snapshot arrays stay index-aligned", () => {
  const { snapshots } = buildSnapshots(twoSymbols(), cfg);
  for (const s of snapshots) {
    assert.equal(s.scores.raw.length, s.symbols.length);
    assert.equal(s.scores.volAdj.length, s.symbols.length);
    assert.equal(s.returns.length, s.symbols.length);
  }
});

test("a rebalance below minEligible is skipped entirely", () => {
  const strict = { ...cfg, minEligible: 99 };
  const { snapshots } = buildSnapshots(twoSymbols(), strict);
  assert.equal(snapshots.length, 0);
});

test("a symbol whose bars stop mid-period exits at its last open and is not dropped", () => {
  const bars = twoSymbols();
  const full = bars.get("DOWN")!;
  // Truncate DOWN partway through the final holding period rather than before
  // it. Dropping it instead of exiting it is exactly the survivorship mechanism
  // this study exists to avoid, so it must still appear in the snapshot.
  const { snapshots } = buildSnapshots(bars, cfg);
  const last = snapshots[snapshots.length - 1];
  const cut = full.findIndex((c) => Math.floor(c.t / DAY) === last.day + 3);
  assert.ok(cut > 0, "fixture must cut inside the final holding period");

  const truncated = new Map(bars);
  truncated.set("DOWN", full.slice(0, cut));
  const out = buildSnapshots(truncated, cfg);
  const finalSnap = out.snapshots[out.snapshots.length - 1];
  assert.ok(finalSnap.symbols.includes("DOWN"), "DOWN must not be silently dropped");
  assert.ok(out.substitutions >= 1, "the substituted exit must be counted");

  const i = finalSnap.symbols.indexOf("DOWN");
  const fillDay = finalSnap.day + 1;
  const at = (d: number) => full.findIndex((c) => Math.floor(c.t / DAY) === d);
  const expected = full[cut - 1].o / full[at(fillDay)].o - 1;
  assert.ok(Math.abs(finalSnap.returns[i] - expected) < 1e-12);
});

test("topByDollarVolume ranks on median close * volume in the window before the cutoff", () => {
  const bars = new Map<string, Candle[]>([
    ["BIG", series(Array.from({ length: 100 }, () => 100)).map((c) => ({ ...c, v: 10_000 }))],
    ["MID", series(Array.from({ length: 100 }, () => 100)).map((c) => ({ ...c, v: 5_000 }))],
    ["SMALL", series(Array.from({ length: 100 }, () => 100)).map((c) => ({ ...c, v: 100 }))],
  ]);
  const { days } = alignUniverse(bars);
  const top = topByDollarVolume(bars, days, days[80], 63, 2);
  assert.deepEqual([...top].sort(), ["BIG", "MID"]);
});

test("topByDollarVolume ignores bars at or after the cutoff day", () => {
  // A name that only becomes liquid after the cutoff must not qualify — that
  // would be the lookahead the fixed-membership design exists to prevent.
  const quiet = series(Array.from({ length: 100 }, () => 100)).map((c, i) => ({
    ...c, v: i < 80 ? 1 : 1_000_000,
  }));
  const bars = new Map<string, Candle[]>([
    ["LATE", quiet],
    ["STEADY", series(Array.from({ length: 100 }, () => 100)).map((c) => ({ ...c, v: 500 }))],
  ]);
  const { days } = alignUniverse(bars);
  assert.deepEqual([...topByDollarVolume(bars, days, days[80], 63, 1)], ["STEADY"]);

  // The 63-day assertion above cannot actually detect the off-by-one it exists
  // to prevent: a median is robust to one added day, so admitting the cutoff
  // itself moves LATE's median from 100 to 100 and STEADY still wins. Narrowing
  // the window to a single day removes that robustness — the correct window is
  // index 79 alone (LATE 100, STEADY 50,000), while an inclusive bug windows
  // 79-80 and hands LATE a median of ~5e7.
  assert.deepEqual([...topByDollarVolume(bars, days, days[80], 1, 1)], ["STEADY"]);
});

test("topByDollarVolume averages the two middle values on an even-length window", () => {
  // Sorted dollar volumes [1, 10, 20, 100]: the median is 15, not the
  // lower-middle 20 — and not the lower-middle 10 that `dv[mid - 1]` gives.
  const flat = (v: number) => series([v, v, v, v, v]).map((c) => ({ ...c, v: 1 }));
  const bars = new Map<string, Candle[]>([
    ["EVEN", series([1, 10, 20, 100, 999]).map((c) => ({ ...c, v: 1 }))],
    ["RIVAL", flat(12)],
  ]);
  const { days } = alignUniverse(bars);
  // EVEN's median is 15 and beats RIVAL's 12. Taking the lower middle instead
  // gives EVEN 10, and RIVAL wins — which is how this test detects the bug.
  assert.deepEqual([...topByDollarVolume(bars, days, days[4], 4, 1)], ["EVEN"]);
});

test("topByDollarVolume rejects a cutoff that is not a union calendar day", () => {
  // Failing open is a lookahead: indexOf returns -1, and slice(0, -1) is the
  // whole history minus one day, silently ranking on data past the cutoff.
  const bars = twoSymbols();
  const { days } = alignUniverse(bars);
  assert.throws(() => topByDollarVolume(bars, days, 999_999, 63, 1), /not a union calendar day/);
  // Vacuity guard: a real union day on the same fixture does not throw.
  assert.ok(topByDollarVolume(bars, days, days[80], 63, 1).size > 0);
});

test("a selected symbol with no bar on or after the fill day is counted, not hidden", () => {
  // Delisting at the ranking bar itself leaves nothing measurable, so the
  // symbol cannot enter the snapshot. It must still be counted: a universe
  // full of month-end delistings would otherwise report substitutions = 0 and
  // look clean.
  const loose = { ...cfg, minEligible: 1 };
  const bars = twoSymbols();
  const full = bars.get("DOWN")!;
  // DOWN's last bar IS the first rebalance's ranking bar, so it scores and is
  // then unfillable.
  bars.set("DOWN", full.slice(0, 274));

  const out = buildSnapshots(bars, loose);
  assert.equal(out.unfillable, 1, "the unfillable selection must be counted exactly once");
  const first = out.snapshots[0];
  assert.equal(first.day, START + 273, "the rebalance that dropped DOWN must still exist");
  assert.ok(first.symbols.includes("UP"), "UP must still be selected");
  assert.ok(!first.symbols.includes("DOWN"), "DOWN has no measurable return to report");
});

test("subsetBars keeps only the named symbols", () => {
  const bars = twoSymbols();
  const out = subsetBars(bars, new Set(["UP"]));
  assert.deepEqual([...out.keys()], ["UP"]);
  assert.equal(out.get("UP"), bars.get("UP"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/backtest/crossMomentum/study.test.ts`
Expected: FAIL — `Cannot find module './study'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/backtest/crossMomentum/study.ts`:

```ts
// The one pass over bars. Everything downstream — both legs, the mega-cap
// subset, and all 1,000 permutation iterations — is arithmetic over the
// snapshots this produces, so the expensive work happens exactly once.
import { alignUniverse, dayKey } from "@/lib/backtest/crossSectional/calendar";
import type { Candle } from "@/lib/indicators";
import { monthEndIndices } from "./monthEnds";
import { momentumScores } from "./scores";
import type { MomentumConfig, Snapshot } from "./types";

/** The symbol's first bar on or after union-day index `from`, or null. */
function barAtOrAfter(perDay: Map<number, number>, days: number[], from: number): number | null {
  for (let d = from; d < days.length; d++) {
    const i = perDay.get(days[d]);
    if (i !== undefined) return i;
  }
  return null;
}

export interface StudyOutput {
  snapshots: Snapshot[];
  /** Selections whose fill or exit bar was not the intended union day. */
  substitutions: number;
  /**
   * Selected symbols with no return to report: either no bar ever arrived on
   * or after the fill day (delisted at the ranking bar itself), or the
   * fallback exit collapsed onto the fill bar (the symbol's last bar was
   * already its fill). Both leave nothing measurable, so the symbol is left
   * out of every snapshot rather than assigned a fabricated return — this
   * counts how often that happened so a run with many of them is visible
   * instead of silently reporting `substitutions = 0` and looking clean.
   */
  unfillable: number;
}

export function buildSnapshots(bars: Map<string, Candle[]>, cfg: MomentumConfig): StudyOutput {
  const { days, index } = alignUniverse(bars);
  const ends = monthEndIndices(days);
  const snapshots: Snapshot[] = [];
  let substitutions = 0;
  let unfillable = 0;

  // Each rebalance needs the NEXT month end to exit into, so the last flagged
  // month end never opens a position.
  for (let e = 0; e + 1 < ends.length; e++) {
    const rankIdx = ends[e];
    const fillIdx = rankIdx + 1;
    const exitFillIdx = ends[e + 1] + 1;
    if (exitFillIdx >= days.length) break;

    const symbols: string[] = [];
    const raw: number[] = [];
    const volAdj: number[] = [];
    const returns: number[] = [];

    for (const [symbol, candles] of bars) {
      const perDay = index.get(symbol)!;
      const i = perDay.get(days[rankIdx]);
      if (i === undefined) continue;

      // Selection happens here, on data no later than the ranking day.
      const score = momentumScores(candles, i, cfg.lookback, cfg.skip);
      if (score === null) continue;

      // Fill and exit are resolved only after selection, because neither is
      // knowable at the ranking date. A selected symbol whose bars merely stop
      // early is not dropped — it exits at its last open, because dropping it
      // retroactively is the survivorship mechanism this study exists to avoid.
      //
      // Two cases leave nothing to measure at all, and both are counted rather
      // than assigned a fabricated return: no bar ever arrives on or after the
      // fill day, and a fallback exit that lands on the fill bar itself.
      const fill = barAtOrAfter(perDay, days, fillIdx);
      if (fill === null) {
        unfillable++;
        continue; // no fill ever happened; there is no trade
      }
      const exact = barAtOrAfter(perDay, days, exitFillIdx);
      // Bars stopped before the exit day: exit at the last available open.
      const exit = exact ?? candles.length - 1;
      if (exit <= fill) {
        unfillable++;
        continue;
      }

      if (dayKey(candles[fill].t) !== days[fillIdx] || dayKey(candles[exit].t) !== days[exitFillIdx]) {
        substitutions++;
      }

      symbols.push(symbol);
      raw.push(score.raw);
      volAdj.push(score.volAdj);
      returns.push(candles[exit].o / candles[fill].o - 1);
    }

    if (symbols.length < cfg.minEligible) continue;
    snapshots.push({ day: days[rankIdx], symbols, scores: { raw, volAdj }, returns });
  }

  return { snapshots, substitutions, unfillable };
}

/**
 * The `count` symbols with the highest median dollar volume over the `window`
 * union days ending immediately BEFORE `beforeDay`. The window closes before
 * the first ranking, so membership is fixed for the whole study and introduces
 * no lookahead — which is the entire point of the mega-cap gate.
 */
export function topByDollarVolume(
  bars: Map<string, Candle[]>,
  days: number[],
  beforeDay: number,
  window: number,
  count: number,
): Set<string> {
  const end = days.indexOf(beforeDay);
  // Failing open here would be a lookahead, not an inconvenience: a missing
  // cutoff gives end = -1, and slice(0, -1) is the whole history bar one day.
  if (end < 0) throw new Error(`beforeDay ${beforeDay} is not a union calendar day`);
  const lo = Math.max(0, end - window);
  const wanted = new Set(days.slice(lo, end));

  const scored: Array<[string, number]> = [];
  for (const [symbol, candles] of bars) {
    const dv: number[] = [];
    for (const c of candles) if (wanted.has(dayKey(c.t))) dv.push(c.c * c.v);
    if (dv.length === 0) continue;
    dv.sort((a, b) => a - b);
    const mid = dv.length >> 1;
    scored.push([symbol, dv.length % 2 === 1 ? dv[mid] : (dv[mid - 1] + dv[mid]) / 2]);
  }

  scored.sort((a, b) => b[1] - a[1]);
  return new Set(scored.slice(0, count).map(([s]) => s));
}

export function subsetBars(bars: Map<string, Candle[]>, keep: Set<string>): Map<string, Candle[]> {
  const out = new Map<string, Candle[]>();
  for (const [symbol, candles] of bars) if (keep.has(symbol)) out.set(symbol, candles);
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/backtest/crossMomentum/study.test.ts`
Expected: PASS, 12 tests

- [ ] **Step 5: Verify the tests are load-bearing (mutation checks)**

Six mutations. Apply one at a time, run the test file, confirm the NAMED test
fails, restore before the next. A mutation that leaves every test green is a
finding about the tests, not a pass — report it rather than moving on.

1. `returns.push(candles[exit].o / candles[fill].o - 1)` → `.c` on both sides.
   Expected: FAIL — `returns are measured open-to-open, not close-to-close`.
   (Test 6, `a symbol whose bars stop mid-period…`, also fails: it shares the
   same return line. That is expected, not a second finding.)
2. `const exit = exact ?? candles.length - 1;` → `const exit = exact; if (exit === null) continue;` (typed `number | null`).
   Expected: FAIL — `a symbol whose bars stop mid-period exits at its last open and is not dropped`.
3. `days.slice(lo, end)` → `days.slice(lo, end + 1)`.
   Expected: FAIL — `topByDollarVolume ignores bars at or after the cutoff day`,
   on its `window = 1` assertion. The `63` assertion above it will still pass:
   a median absorbs one added day. That is the whole reason the `window = 1`
   probe exists.
4. `(dv[mid - 1] + dv[mid]) / 2` → `dv[mid - 1]`.
   Expected: FAIL — `topByDollarVolume averages the two middle values on an even-length window`.
5. Delete the `if (end < 0) throw` line.
   Expected: FAIL — `topByDollarVolume rejects a cutoff that is not a union calendar day`.
6. Delete `unfillable++` from the `fill === null` branch.
   Expected: FAIL — `a selected symbol with no bar on or after the fill day is counted, not hidden`.

**Restore all six.** Run again and confirm PASS.

- [ ] **Step 6: Typecheck and full suite**

Run: `npm run typecheck && npm test`
Expected: clean typecheck; full suite passes

- [ ] **Step 7: Commit**

```bash
git add src/lib/backtest/crossMomentum/study.ts src/lib/backtest/crossMomentum/study.test.ts
git commit -m "feat(crossMomentum): rebalance loop and mega-cap subset"
```

---

### Task 6: Statistics helpers

**Files:**
- Create: `src/lib/backtest/crossMomentum/stats.ts`
- Test: `src/lib/backtest/crossMomentum/stats.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `mean(xs: number[]): number`; `stdev(xs: number[]): number`; `tStat(xs: number[]): number`; `spearman(a: number[], b: number[]): number`; `splitBlocks<T>(xs: T[], blocks: number): T[][]`; `turnover(prev: string[] | null, next: string[]): number`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/backtest/crossMomentum/stats.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mean, stdev, tStat, spearman, splitBlocks, turnover } from "./stats";

test("mean and sample stdev use the n-1 denominator", () => {
  assert.equal(mean([2, 4, 6]), 4);
  // Population sd would be sqrt(8/3) = 1.633; sample sd is 2.
  assert.ok(Math.abs(stdev([2, 4, 6]) - 2) < 1e-12);
});

test("tStat is mean over standard error", () => {
  const xs = [1, 2, 3, 4, 5];
  assert.ok(Math.abs(tStat(xs) - mean(xs) / (stdev(xs) / Math.sqrt(xs.length))) < 1e-12);
});

test("degenerate inputs return 0 rather than NaN or Infinity", () => {
  assert.equal(mean([]), 0);
  assert.equal(stdev([5]), 0);
  assert.equal(tStat([]), 0);
  assert.equal(tStat([3, 3, 3]), 0); // zero variance: no signal, not infinite
});

test("spearman is 1 for a perfect staircase and -1 when reversed", () => {
  const idx = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.ok(Math.abs(spearman(idx, idx.map((k) => k * 0.01)) - 1) < 1e-12);
  assert.ok(Math.abs(spearman(idx, idx.map((k) => -k * 0.01)) + 1) < 1e-12);
});

test("spearman is monotone-invariant, not linear", () => {
  // A convex but strictly increasing mapping still ranks identically, which is
  // the whole reason the monotonicity gate uses ranks and not Pearson.
  const idx = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.ok(Math.abs(spearman(idx, idx.map((k) => k ** 3)) - 1) < 1e-12);
});

test("spearman handles ties by averaging their ranks", () => {
  assert.equal(spearman([1, 2, 3], [5, 5, 5]), 0);
});

test("spearman is near zero for a jumbled ordering", () => {
  const idx = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const jumbled = [5, 1, 9, 3, 7, 2, 10, 4, 8, 6];
  assert.ok(Math.abs(spearman(idx, jumbled)) < 0.5);
});

test("splitBlocks puts the remainder in the last block", () => {
  // 59 months into 6 blocks must be 10/10/10/10/10/9 — the sizes the spec pins.
  const xs = Array.from({ length: 59 }, (_, i) => i);
  const blocks = splitBlocks(xs, 6);
  assert.deepEqual(blocks.map((b) => b.length), [10, 10, 10, 10, 10, 9]);
  assert.deepEqual(blocks.flat(), xs, "blocks must be contiguous and lose nothing");
});

test("turnover counts names that were not held before", () => {
  assert.equal(turnover(null, ["A", "B"]), 1); // first rebalance: everything is new
  assert.equal(turnover(["A", "B"], ["A", "B"]), 0);
  assert.equal(turnover(["A", "B"], ["A", "C"]), 0.5);
  assert.equal(turnover(["A"], []), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/backtest/crossMomentum/stats.test.ts`
Expected: FAIL — `Cannot find module './stats'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/backtest/crossMomentum/stats.ts`:

```ts
// Plain statistics, kept separate from the study so they can be tested against
// hand-computable values rather than against backtest output.

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

/** Sample standard deviation (n - 1). 0 for fewer than two observations. */
export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let sq = 0;
  for (const x of xs) sq += (x - m) ** 2;
  return Math.sqrt(sq / (xs.length - 1));
}

/**
 * mean / standard error. Reported for readers who look for it; deliberately not
 * a gate, because at N = 59 the t = 2 bar demands an annual Sharpe near 0.90
 * while published momentum spreads run 0.5-0.6.
 */
export function tStat(xs: number[]): number {
  const sd = stdev(xs);
  if (!(sd > 0)) return 0;
  return mean(xs) / (sd / Math.sqrt(xs.length));
}

/** 1-based ranks, ties sharing their average rank. */
function ranks(xs: number[]): number[] {
  const order = xs.map((_, i) => i).sort((p, q) => xs[p] - xs[q]);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && xs[order[j + 1]] === xs[order[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k]] = avg;
    i = j + 1;
  }
  return out;
}

/**
 * Spearman's rho: Pearson correlation of the ranks. Rank-based on purpose — the
 * monotonicity gate asks whether bucket returns climb in order, not whether they
 * climb linearly.
 */
export function spearman(a: number[], b: number[]): number {
  const ra = ranks(a);
  const rb = ranks(b);
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    const x = ra[i] - ma;
    const y = rb[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? 0 : num / den;
}

/**
 * Contiguous, non-overlapping blocks. Ceil boundaries push the remainder into
 * the final block, so 59 into 6 gives 10/10/10/10/10/9 rather than 9/10/10/10/10/10.
 */
export function splitBlocks<T>(xs: T[], blocks: number): T[][] {
  const out: T[][] = [];
  for (let k = 0; k < blocks; k++) {
    const lo = Math.ceil((k * xs.length) / blocks);
    const hi = Math.ceil(((k + 1) * xs.length) / blocks);
    out.push(xs.slice(lo, hi));
  }
  return out;
}

/** Fraction of `next` that was not already held. The first rebalance is all new. */
export function turnover(prev: string[] | null, next: string[]): number {
  if (next.length === 0) return 0;
  if (prev === null) return 1;
  const held = new Set(prev);
  let changed = 0;
  for (const s of next) if (!held.has(s)) changed++;
  return changed / next.length;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/backtest/crossMomentum/stats.test.ts`
Expected: PASS, 9 tests

- [ ] **Step 5: Verify the block-size test is load-bearing (mutation check)**

Temporarily change both `Math.ceil` calls in `splitBlocks` to `Math.floor`.

Run: `npx tsx --test src/lib/backtest/crossMomentum/stats.test.ts`
Expected: FAIL, with `splitBlocks puts the remainder in the last block` among the failures.

**Restore.** Run again and confirm PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/backtest/crossMomentum/stats.ts src/lib/backtest/crossMomentum/stats.test.ts
git commit -m "feat(crossMomentum): statistics helpers"
```

---

### Task 7: The permutation null

**Files:**
- Create: `src/lib/backtest/crossMomentum/permutation.ts`
- Test: `src/lib/backtest/crossMomentum/permutation.test.ts`

**Interfaces:**
- Consumes: `mulberry32`, `shuffle` from `./rng`; `bucketize`, `meanAt` from `./deciles`; `mean` from `./stats`; `Snapshot`, `ScoreLeg` from `./types`.
- Produces: `spreadSeries(snapshots: Snapshot[], leg: ScoreLeg, buckets: number): number[]`; `permutationPValue(snapshots: Snapshot[], leg: ScoreLeg, buckets: number, iterations: number, seed: number): { p: number; observed: number; nullMean: number }`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/backtest/crossMomentum/permutation.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { permutationPValue, spreadSeries } from "./permutation";
import { mulberry32 } from "./rng";
import type { Snapshot } from "./types";

/** `months` snapshots of `n` symbols, with returns tied to scores by `link`. */
function build(months: number, n: number, seed: number, link: (score: number, noise: number) => number): Snapshot[] {
  const rand = mulberry32(seed);
  return Array.from({ length: months }, (_, m) => {
    const scores = Array.from({ length: n }, () => rand());
    const returns = scores.map((s) => link(s, rand() - 0.5));
    return {
      day: 1_000 + m,
      symbols: scores.map((_, i) => `S${i}`),
      scores: { raw: scores, volAdj: [...scores].reverse() },
      returns,
    };
  });
}

test("a signal unrelated to returns lands mid-distribution", () => {
  // Scores drawn independently of returns: there is nothing to find, so the
  // observed spread must be an unremarkable draw from its own null.
  const snaps = build(40, 100, 11, (_s, noise) => noise);
  const { p } = permutationPValue(snaps, "raw", 10, 500, 99);
  assert.ok(p > 0.15 && p < 0.85, `expected a middling p, got ${p}`);
});

test("a signal that IS the return is rejected by the null", () => {
  // Vacuity guard for the test above: if the null cannot detect a perfect
  // signal, a middling p proves nothing about the noise case.
  const snaps = build(40, 100, 12, (s, noise) => s * 0.1 + noise * 0.001);
  const { p } = permutationPValue(snaps, "raw", 10, 500, 99);
  assert.ok(p < 0.01, `expected a tiny p, got ${p}`);
});

test("the p-value is reproducible from its seed", () => {
  const snaps = build(20, 60, 13, (_s, noise) => noise);
  const a = permutationPValue(snaps, "raw", 10, 200, 7);
  const b = permutationPValue(snaps, "raw", 10, 200, 7);
  assert.deepEqual(a, b);
  assert.notEqual(permutationPValue(snaps, "raw", 10, 200, 8).p, a.p);
});

test("p is never zero", () => {
  // The +1 on both sides of the ratio: a null that never beat the observed
  // value gives 1/(B+1), not a claim of impossibility.
  const snaps = build(30, 80, 14, (s) => s);
  const { p } = permutationPValue(snaps, "raw", 10, 100, 5);
  assert.ok(p >= 1 / 101, `p must be at least 1/(B+1), got ${p}`);
});

test("permuting does not mutate the snapshots", () => {
  const snaps = build(10, 40, 15, (_s, noise) => noise);
  const before = snaps.map((s) => [...s.scores.raw]);
  permutationPValue(snaps, "raw", 10, 50, 2);
  assert.deepEqual(snaps.map((s) => s.scores.raw), before);
});

test("spreadSeries returns one observation per snapshot", () => {
  const snaps = build(17, 50, 16, (_s, noise) => noise);
  assert.equal(spreadSeries(snaps, "raw", 10).length, 17);
});

test("spreadSeries reads the leg it is asked for", () => {
  // volAdj is the reversed score array, so its spread must be the negation.
  const snaps = build(12, 40, 17, (s) => s);
  const raw = spreadSeries(snaps, "raw", 10);
  const vol = spreadSeries(snaps, "volAdj", 10);
  assert.notDeepEqual(raw, vol);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/backtest/crossMomentum/permutation.test.ts`
Expected: FAIL — `Cannot find module './permutation'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/backtest/crossMomentum/permutation.ts`:

```ts
// The null hypothesis, made concrete: what spread would this cross-section have
// produced if the ranking carried no information at all? Shuffling the scores
// against fixed returns destroys the score-return link and nothing else — the
// eligible set, the realized returns, and the time-series structure survive
// untouched, which is what makes the comparison fair.
import { bucketize, meanAt } from "./deciles";
import { mulberry32, shuffle } from "./rng";
import { mean } from "./stats";
import type { ScoreLeg, Snapshot } from "./types";

function spreadFrom(scores: number[], returns: number[], buckets: number): number {
  const groups = bucketize(scores, buckets);
  return meanAt(returns, groups[buckets - 1]) - meanAt(returns, groups[0]);
}

/** Top-minus-bottom spread, one observation per rebalance. */
export function spreadSeries(snapshots: Snapshot[], leg: ScoreLeg, buckets: number): number[] {
  return snapshots.map((s) => spreadFrom(s.scores[leg], s.returns, buckets));
}

export interface PermutationResult {
  /** (1 + #{null >= observed}) / (iterations + 1). Never exactly zero. */
  p: number;
  observed: number;
  /** Mean of the null distribution — should sit near zero. */
  nullMean: number;
}

export function permutationPValue(
  snapshots: Snapshot[],
  leg: ScoreLeg,
  buckets: number,
  iterations: number,
  seed: number,
): PermutationResult {
  const observed = mean(spreadSeries(snapshots, leg, buckets));
  const rand = mulberry32(seed);
  const nullMeans: number[] = [];
  let atLeast = 0;

  for (let b = 0; b < iterations; b++) {
    let sum = 0;
    for (const snap of snapshots) {
      // Copy before shuffling: the caller's snapshots are shared across legs,
      // the mega-cap run, and every later iteration.
      sum += spreadFrom(shuffle([...snap.scores[leg]], rand), snap.returns, buckets);
    }
    const m = sum / snapshots.length;
    nullMeans.push(m);
    if (m >= observed) atLeast++;
  }

  return { p: (1 + atLeast) / (iterations + 1), observed, nullMean: mean(nullMeans) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/backtest/crossMomentum/permutation.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 5: Verify the null is load-bearing (mutation check)**

Temporarily remove the shuffle — change `shuffle([...snap.scores[leg]], rand)` to `[...snap.scores[leg]]`.

Run: `npx tsx --test src/lib/backtest/crossMomentum/permutation.test.ts`
Expected: FAIL, with `a signal unrelated to returns lands mid-distribution` among the failures (an unshuffled null equals the observed value every time, driving p to 1).

Then temporarily change `(1 + atLeast) / (iterations + 1)` to `atLeast / iterations`.
Expected: FAIL, with `p is never zero` among the failures.

**Restore both.** Run again and confirm PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/backtest/crossMomentum/permutation.ts src/lib/backtest/crossMomentum/permutation.test.ts
git commit -m "feat(crossMomentum): permutation null"
```

---

### Task 8: The gate battery

**Files:**
- Create: `src/lib/backtest/crossMomentum/gates.ts`
- Test: `src/lib/backtest/crossMomentum/gates.test.ts`

**Interfaces:**
- Consumes: `bucketMonth`, `spreadOf` from `./deciles`; `mean`, `tStat`, `spearman`, `splitBlocks`, `turnover` from `./stats`; `spreadSeries`, `permutationPValue` from `./permutation`; `MomentumConfig`, `ScoreLeg`, `Snapshot`, `GateReport` from `./types`.
- Produces: exported constants `RHO_MIN = 0.6`, `P_MAX = 0.05`, `BLOCKS_POSITIVE_MIN = 4`; `evaluateGates(args: { leg: ScoreLeg; snapshots: Snapshot[]; megaCapSnapshots: Snapshot[]; cfg: MomentumConfig }): GateReport`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/backtest/crossMomentum/gates.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateGates, RHO_MIN, P_MAX, BLOCKS_POSITIVE_MIN } from "./gates";
import { mulberry32 } from "./rng";
import type { MomentumConfig, Snapshot } from "./types";

const cfg: MomentumConfig = {
  lookback: 252, skip: 21, buckets: 10, minEligible: 10,
  costBps: 5, seed: 4, iterations: 200, blocks: 6,
};

/**
 * `months` snapshots of 100 symbols. `strength` scales how much of a symbol's
 * return its score explains; 0 is pure noise.
 */
function synth(months: number, strength: number, seed: number): Snapshot[] {
  const rand = mulberry32(seed);
  return Array.from({ length: months }, (_, m) => {
    const scores = Array.from({ length: 100 }, () => rand() - 0.5);
    return {
      day: 1_000 + m,
      symbols: scores.map((_, i) => `S${i}`),
      scores: { raw: scores, volAdj: scores.map((s) => s * 0.5) },
      returns: scores.map((s) => s * strength + (rand() - 0.5) * 0.02),
    };
  });
}

test("a strong, monotone signal passes every gate", () => {
  const snaps = synth(59, 0.05, 21);
  const r = evaluateGates({ leg: "raw", snapshots: snaps, megaCapSnapshots: snaps, cfg });
  assert.ok(r.monotonicity.pass, `rho ${r.monotonicity.rho}`);
  assert.ok(r.permutation.pass, `p ${r.permutation.p}`);
  assert.ok(r.crossDefinition.pass);
  assert.ok(r.notTopOnly.pass);
  assert.ok(r.megaCap.pass);
  assert.ok(r.subPeriods.pass);
  assert.ok(r.passed);
  assert.equal(r.months, 59);
});

test("pure noise fails", () => {
  const snaps = synth(59, 0, 22);
  assert.equal(evaluateGates({ leg: "raw", snapshots: snaps, megaCapSnapshots: snaps, cfg }).passed, false);
});

test("passed is an AND — one failing gate sinks the report", () => {
  const snaps = synth(59, 0.05, 23);
  // Break only the mega-cap gate by handing it a reversed cross-section.
  const reversed = snaps.map((s) => ({ ...s, returns: s.returns.map((r) => -r) }));
  const r = evaluateGates({ leg: "raw", snapshots: snaps, megaCapSnapshots: reversed, cfg });
  assert.equal(r.megaCap.pass, false);
  assert.equal(r.monotonicity.pass, true, "the other gates must still pass, or this proves nothing");
  assert.equal(r.passed, false);
});

test("an edge living only in the top bucket fails the survivorship gate", () => {
  // Every bucket flat except the top one: the shape survivorship fabricates.
  const rand = mulberry32(24);
  const snaps: Snapshot[] = Array.from({ length: 59 }, (_, m) => {
    const scores = Array.from({ length: 100 }, (_, i) => i);
    return {
      day: 1_000 + m,
      symbols: scores.map((_, i) => `S${i}`),
      scores: { raw: scores, volAdj: scores },
      returns: scores.map((s) => (s >= 90 ? 0.05 : 0) + (rand() - 0.5) * 0.002),
    };
  });
  const r = evaluateGates({ leg: "raw", snapshots: snaps, megaCapSnapshots: snaps, cfg });
  assert.equal(r.notTopOnly.pass, false, "the bottom bucket does not underperform the universe");
  assert.equal(r.passed, false);
});

test("the cross-definition gate reads the OTHER leg", () => {
  const snaps = synth(59, 0.05, 25);
  // volAdj scaled negative: same information, opposite sign, so the other leg's
  // mean spread turns negative while this leg's stays positive.
  const opposed = snaps.map((s) => ({ ...s, scores: { raw: s.scores.raw, volAdj: s.scores.raw.map((x) => -x) } }));
  const r = evaluateGates({ leg: "raw", snapshots: opposed, megaCapSnapshots: opposed, cfg });
  assert.ok(r.crossDefinition.otherMeanSpread < 0);
  assert.equal(r.crossDefinition.pass, false);
});

test("sub-period consistency counts blocks, not months", () => {
  const snaps = synth(59, 0.05, 26);
  const r = evaluateGates({ leg: "raw", snapshots: snaps, megaCapSnapshots: snaps, cfg });
  assert.equal(r.subPeriods.of, 6);
  assert.equal(r.subPeriods.blockMeans.length, 6);
  assert.ok(r.subPeriods.positive >= BLOCKS_POSITIVE_MIN);
});

test("net returns sit below gross, and turnover is reported", () => {
  const snaps = synth(59, 0.05, 27);
  const r = evaluateGates({ leg: "raw", snapshots: snaps, megaCapSnapshots: snaps, cfg });
  assert.ok(r.netMeanSpread < r.meanSpread, "costs must reduce the spread");
  assert.ok(r.meanTurnover > 0 && r.meanTurnover <= 1);
});

test("the reported figures are present and finite", () => {
  const snaps = synth(59, 0.05, 28);
  const r = evaluateGates({ leg: "raw", snapshots: snaps, megaCapSnapshots: snaps, cfg });
  assert.equal(r.bucketMeans.length, 10);
  assert.ok(Number.isFinite(r.tStat));
  assert.ok(Number.isFinite(r.meanSpread));
});

test("the thresholds are the values the spec pins", () => {
  assert.equal(RHO_MIN, 0.6);
  assert.equal(P_MAX, 0.05);
  assert.equal(BLOCKS_POSITIVE_MIN, 4);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/backtest/crossMomentum/gates.test.ts`
Expected: FAIL — `Cannot find module './gates'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/backtest/crossMomentum/gates.ts`:

```ts
// The six gates, declared before any result was seen. They are an AND, not a
// scorecard: a report that passes five is a rejection.
import { bucketMonth, spreadOf } from "./deciles";
import { permutationPValue, spreadSeries } from "./permutation";
import { mean, spearman, splitBlocks, tStat, turnover } from "./stats";
import type { GateReport, MomentumConfig, ScoreLeg, Snapshot } from "./types";

/** Spearman rho across the buckets. One-sided p at 0.60 with n = 10 is ~0.07. */
export const RHO_MIN = 0.6;
export const P_MAX = 0.05;
export const BLOCKS_POSITIVE_MIN = 4;

const OTHER: Record<ScoreLeg, ScoreLeg> = { raw: "volAdj", volAdj: "raw" };

export function evaluateGates(args: {
  leg: ScoreLeg;
  snapshots: Snapshot[];
  megaCapSnapshots: Snapshot[];
  cfg: MomentumConfig;
}): GateReport {
  const { leg, snapshots, megaCapSnapshots, cfg } = args;
  const months = snapshots.map((s) => bucketMonth(s, leg, cfg.buckets));
  const spread = months.map(spreadOf);

  // Gate 1 — monotonicity across the buckets, not merely a gap at the ends.
  const bucketMeans = Array.from({ length: cfg.buckets }, (_, k) => mean(months.map((m) => m.bucketReturns[k])));
  const rho = spearman(
    Array.from({ length: cfg.buckets }, (_, k) => k + 1),
    bucketMeans,
  );

  // Gate 2 — could a ranking with no information have produced this?
  const perm = permutationPValue(snapshots, leg, cfg.buckets, cfg.iterations, cfg.seed);

  // Gate 3 — direction agreement only. Requiring the other leg to PASS would
  // collapse the two pre-registered legs into a single test.
  const otherMeanSpread = mean(spreadSeries(snapshots, OTHER[leg], cfg.buckets));

  // Gate 4 — survivorship inflates the top bucket and deflates the bottom, so
  // an edge that exists only at the top is the artifact, not the signal. The
  // bottom bucket has to actually underperform the universe.
  const shortLegExcess = mean(months.map((m) => m.universeReturn - m.bucketReturns[0]));

  // Gate 5 — the same question on names that were index members throughout.
  const megaMonths = megaCapSnapshots.map((s) => bucketMonth(s, leg, cfg.buckets));
  const megaSpread = mean(megaMonths.map(spreadOf));

  // Gate 6 — contiguous sub-periods.
  const blockMeans = splitBlocks(spread, cfg.blocks).map(mean);
  const positive = blockMeans.filter((x) => x > 0).length;

  // Reported, not gated: cost drag on both legs of the spread.
  const top = cfg.buckets - 1;
  let turnoverSum = 0;
  const netSpread = months.map((m, i) => {
    const prev = i === 0 ? null : months[i - 1];
    const tTop = turnover(prev?.bucketSymbols[top] ?? null, m.bucketSymbols[top]);
    const tBot = turnover(prev?.bucketSymbols[0] ?? null, m.bucketSymbols[0]);
    turnoverSum += (tTop + tBot) / 2;
    // Each changed name is bought and later sold, so the cost is charged twice.
    return spread[i] - ((tTop + tBot) * 2 * cfg.costBps) / 10_000;
  });

  const gates = {
    monotonicity: { rho, pass: rho >= RHO_MIN },
    permutation: { p: perm.p, pass: perm.p <= P_MAX },
    crossDefinition: { otherMeanSpread, pass: otherMeanSpread > 0 },
    notTopOnly: { meanShortLegExcess: shortLegExcess, pass: shortLegExcess > 0 },
    megaCap: { meanSpread: megaSpread, months: megaMonths.length, pass: megaSpread > 0 },
    subPeriods: { positive, of: cfg.blocks, blockMeans, pass: positive >= BLOCKS_POSITIVE_MIN },
  };

  return {
    leg,
    months: months.length,
    ...gates,
    passed: Object.values(gates).every((g) => g.pass),
    meanSpread: mean(spread),
    tStat: tStat(spread),
    netMeanSpread: mean(netSpread),
    meanTurnover: months.length === 0 ? 0 : turnoverSum / months.length,
    bucketMeans,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/backtest/crossMomentum/gates.test.ts`
Expected: PASS, 9 tests

If `a strong, monotone signal passes every gate` fails because the synthetic edge is too weak or too strong, adjust the `strength` argument in that test only — never the thresholds in `gates.ts`.

- [ ] **Step 5: Verify the AND is load-bearing (mutation check)**

Temporarily change `passed` to `Object.values(gates).some((g) => g.pass)`.

Run: `npx tsx --test src/lib/backtest/crossMomentum/gates.test.ts`
Expected: FAIL, with `passed is an AND — one failing gate sinks the report` among the failures.

Then temporarily change gate 4 to `pass: true`.
Expected: FAIL, with `an edge living only in the top bucket fails the survivorship gate` among the failures.

**Restore both.** Run again and confirm PASS.

- [ ] **Step 6: Typecheck and full suite**

Run: `npm run typecheck && npm test`
Expected: clean typecheck; full suite passes

- [ ] **Step 7: Commit**

```bash
git add src/lib/backtest/crossMomentum/gates.ts src/lib/backtest/crossMomentum/gates.test.ts
git commit -m "feat(crossMomentum): six-gate battery"
```

---

### Task 9: Runner script and results document

**Files:**
- Create: `scripts/decile-momentum-study.mts`
- Create: `docs/quant/2026-08-16-cross-sectional-momentum-results.md` (written by running the script, then edited to add the verdict)

**Interfaces:**
- Consumes: `buildSnapshots`, `topByDollarVolume`, `subsetBars` from `@/lib/backtest/crossMomentum/study`; `evaluateGates` from `@/lib/backtest/crossMomentum/gates`; `alignUniverse` from `@/lib/backtest/crossSectional/calendar`; `MomentumConfig`, `ScoreLeg` from `@/lib/backtest/crossMomentum/types`.
- Produces: nothing importable — this is the impure edge.

- [ ] **Step 1: Write the runner**

Create `scripts/decile-momentum-study.mts`:

```ts
// Runs the decile study on the cached daily bars and prints the gate report for
// both pre-registered legs. This file owns every impure thing the module is
// forbidden: reading the cache, printing, and writing the results doc.
//
// Usage: npx tsx scripts/decile-momentum-study.mts
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { alignUniverse } from "@/lib/backtest/crossSectional/calendar";
import { evaluateGates } from "@/lib/backtest/crossMomentum/gates";
import { buildSnapshots, subsetBars, topByDollarVolume } from "@/lib/backtest/crossMomentum/study";
import type { MomentumConfig, ScoreLeg } from "@/lib/backtest/crossMomentum/types";
import type { Candle } from "@/lib/indicators";

const CACHE = ".cache/bars/sp500-1d.json";
const OUT = "docs/quant/2026-08-16-cross-sectional-momentum-results.md";
const MEGA_CAP_COUNT = 200;
const DOLLAR_VOL_WINDOW = 63;

const cfg: MomentumConfig = {
  lookback: 252,
  skip: 21,
  buckets: 10,
  minEligible: 100,
  costBps: 5,
  seed: 20_260_816,
  iterations: 1_000,
  blocks: 6,
};

const raw = JSON.parse(await readFile(CACHE, "utf8")) as { fetchedAt: string; bars: Record<string, Candle[]> };
const bars = new Map(Object.entries(raw.bars));
// SPY is an index proxy, not a cross-section member.
bars.delete("SPY");

const iso = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);

const full = buildSnapshots(bars, cfg);
if (full.snapshots.length === 0) throw new Error("no rebalance dates produced — check the cache");

const { days } = alignUniverse(bars);
const megaSymbols = topByDollarVolume(bars, days, full.snapshots[0].day, DOLLAR_VOL_WINDOW, MEGA_CAP_COUNT);
const mega = buildSnapshots(subsetBars(bars, megaSymbols), cfg);

const legs: ScoreLeg[] = ["raw", "volAdj"];
const reports = legs.map((leg) =>
  evaluateGates({ leg, snapshots: full.snapshots, megaCapSnapshots: mega.snapshots, cfg }),
);

const pct = (x: number) => `${(x * 100).toFixed(3)}%`;
const yn = (b: boolean) => (b ? "**PASS**" : "**FAIL**");

const lines: string[] = [
  "# Cross-Sectional Momentum — Decile Study Results",
  "",
  `**Run date:** 2026-08-16 · **Cache fetched:** ${raw.fetchedAt}`,
  `**Spec:** \`docs/superpowers/specs/2026-08-16-cross-sectional-momentum-design.md\``,
  "",
  "This is a diagnostic, not a strategy. The strongest outcome available is NOT REJECTED.",
  "",
  "## Sample",
  "",
  `- symbols: ${bars.size}`,
  `- rebalances: **${full.snapshots.length}** (${iso(full.snapshots[0].day)} → ${iso(full.snapshots[full.snapshots.length - 1].day)})`,
  `- eligible per rebalance: min ${Math.min(...full.snapshots.map((s) => s.symbols.length))}, max ${Math.max(...full.snapshots.map((s) => s.symbols.length))}`,
  `- fill/exit substitutions: ${full.substitutions}`,
  `- unfillable selections (dropped, no measurable return): ${full.unfillable}`,
  `- mega-cap subset: ${megaSymbols.size} symbols, ${mega.snapshots.length} rebalances`,
  `- config: lookback ${cfg.lookback}, skip ${cfg.skip}, buckets ${cfg.buckets}, seed ${cfg.seed}, ${cfg.iterations} permutations`,
  "",
];

for (const r of reports) {
  lines.push(
    `## Leg ${r.leg === "raw" ? "A — classic 12-1" : "B — volatility-adjusted"}`,
    "",
    `### Verdict: ${r.passed ? "**NOT REJECTED**" : "**REJECTED**"}`,
    "",
    "| # | Gate | Value | Threshold | Result |",
    "|---|---|---|---|---|",
    `| 1 | Monotonicity (Spearman ρ) | ${r.monotonicity.rho.toFixed(3)} | ≥ 0.60 | ${yn(r.monotonicity.pass)} |`,
    `| 2 | Permutation p | ${r.permutation.p.toFixed(4)} | ≤ 0.05 | ${yn(r.permutation.pass)} |`,
    `| 3 | Other leg's mean spread | ${pct(r.crossDefinition.otherMeanSpread)} | > 0 | ${yn(r.crossDefinition.pass)} |`,
    `| 4 | Bottom bucket vs universe | ${pct(r.notTopOnly.meanShortLegExcess)} | > 0 | ${yn(r.notTopOnly.pass)} |`,
    `| 5 | Mega-cap mean spread | ${pct(r.megaCap.meanSpread)} | > 0 | ${yn(r.megaCap.pass)} |`,
    `| 6 | Positive sub-periods | ${r.subPeriods.positive} of ${r.subPeriods.of} | ≥ 4 | ${yn(r.subPeriods.pass)} |`,
    "",
    "Reported, not gated:",
    "",
    `- mean monthly spread: **${pct(r.meanSpread)}** (net of 5 bps/side: ${pct(r.netMeanSpread)})`,
    `- t-statistic: **${r.tStat.toFixed(2)}** over ${r.months} months`,
    `- mean turnover per rebalance: ${pct(r.meanTurnover)}`,
    `- bucket means (1 = losers → ${cfg.buckets} = winners): ${r.bucketMeans.map((x) => pct(x)).join(", ")}`,
    `- sub-period means: ${r.subPeriods.blockMeans.map((x) => pct(x)).join(", ")}`,
    "",
  );
  console.log(`${r.leg}: ${r.passed ? "NOT REJECTED" : "REJECTED"}  rho=${r.monotonicity.rho.toFixed(3)} p=${r.permutation.p.toFixed(4)} spread=${pct(r.meanSpread)} t=${r.tStat.toFixed(2)}`);
}

lines.push(
  "## Reading these numbers",
  "",
  `At ${full.snapshots.length} monthly observations, \`t = 2\` requires an annual Sharpe near 0.90, while`,
  "published momentum decile spreads run 0.5-0.6 over far longer samples. The t-statistic above is",
  "therefore reported for reference and is not one of the gates. A leg marked NOT REJECTED has cleared",
  "six pre-registered hurdles on a short sample; it has not been validated.",
  "",
  "The universe is the **current** S&P 500 membership backfilled, so it is survivorship-biased in the",
  "direction that manufactures momentum. Gates 4 and 5 exist to test that explanation directly.",
  "",
);

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, lines.join("\n"));
console.log(`\nwrote ${OUT}`);
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/decile-momentum-study.mts`
Expected: two summary lines on stdout (one per leg) and `wrote docs/quant/2026-08-16-cross-sectional-momentum-results.md`.

- [ ] **Step 3: Sanity-check the output before believing it**

Read the generated document and confirm each of these. Any mismatch is a defect to fix, not a number to accept:

- rebalance count is **59** and the range is `2021-08-31 → 2026-06-30`
- eligible-per-rebalance minimum is comfortably above `minEligible` (expect 400+)
- the mega-cap subset holds exactly 200 symbols
- substitutions is small (single digits); a large count means the bar cache has gaps worth investigating
- unfillable is small (single digits). A large count means many selected names had no measurable
  next-month return at all — that is the delisting bias this study cannot correct, and it must be
  stated in the results doc rather than left in the console output
- `bucketMeans` has 10 entries and none is `NaN`
- the two legs' mean spreads are not bit-identical (that would mean one leg is reading the other's scores)

- [ ] **Step 4: Confirm reproducibility**

Run: `npx tsx scripts/decile-momentum-study.mts`
Expected: byte-identical output to the first run. If not, something in the module is reading a non-deterministic source — find it before continuing.

- [ ] **Step 5: Write the verdict section**

Append a `## Verdict` section to the generated document stating, in plain language: which legs passed, which gates failed and by how much, and the single-sentence conclusion — `REJECTED` or `NOT REJECTED`. If NOT REJECTED, add one paragraph naming what Stage 2 must answer (5 whole-share slots, no short leg, real costs) before any of this becomes tradable. Never write "validated".

- [ ] **Step 6: Full suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: clean typecheck; full suite passes

- [ ] **Step 7: Commit**

```bash
git add scripts/decile-momentum-study.mts docs/quant/2026-08-16-cross-sectional-momentum-results.md
git commit -m "feat(crossMomentum): decile study runner and results"
```

---

## Self-review notes

**Spec coverage.** Signal definitions → Task 3. Warm-up of 273 → Task 3 Step 1. Universe and eligibility → Tasks 3 and 5. Missing fill/exit bars → Task 5. Calendar and month ends → Task 1. Fills at the open → Task 5. Decile orientation → Task 4 (Global Constraints restate it). Costs reported not gated → Task 8. Gates 1–6 → Task 8. Permutation determinism → Tasks 2 and 7. Mega-cap subset → Task 5. Sub-period block sizes → Task 6. Test discipline → the mutation-check step in Tasks 3, 4, 5, 6, 7, 8. Results doc → Task 9.

**Deviation from the spec's file table, deliberate.** The spec listed a `calendar.ts` in the new module; this plan reuses `alignUniverse`/`dayKey` from `crossSectional/calendar.ts` and adds only `monthEnds.ts`, because duplicating fifteen tested lines to avoid a cross-module import would be the worse trade. The spec's `study.ts` also absorbs the mega-cap selector, which is universe construction and belongs beside the loop that consumes it.

**Not covered by a task, by design.** Stage 2 (whole shares, 5 slots, no short leg), regime filters, and anything touching `crossSectional/` or the walk-forward harness — all listed as out of scope in the spec.
