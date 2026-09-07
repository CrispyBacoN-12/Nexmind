# Weekly-Bar Mechanism Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-run the existing six-mechanism library on weekly bars, at the next-open fill, on `fit` and `select` only, and find out whether the entry axis is closed everywhere or only on daily bars.

**Architecture:** Three additions, no engine change. A pure resampler (`src/lib/research/weekly.ts`) folds the daily caches already on disk into weekly `Candle[]` and asserts each weekly bar against its daily source. `sliceFold` gains a `warmup` parameter so a weekly fold can use a weekly-sized warm-up prefix. One pre-registered script (`scripts/weekly-mechanism-screen.mts`) runs the unmodified `MECHANISMS` entries through the existing `computeEntrySignals` → `simulateFold` → `runControl` pipeline with `shift1` + `entryAt: "open"`.

**Tech Stack:** TypeScript, `tsx`, `node:test` + `node:assert/strict`, the existing `src/lib/research/*` panel harness. No new dependency, no network call, no DB write.

**Spec:** `docs/superpowers/specs/2026-09-08-weekly-bar-mechanism-screen-design.md`

## Global Constraints

- **No engine change.** `src/lib/backtest/engine.ts` is not modified by any task. `entryAt: "open"` and `atrs[i-1]` sizing already exist.
- **Nothing in `src/` that serves the live desk is touched.** The only `src/` files this plan may modify are `src/lib/research/panelRun.ts` (one added optional parameter) and `src/lib/research/panelRun.test.ts`.
- **`PANEL_SEED` is a constant, not a parameter.** No script added here may accept a seed flag.
- **The livable fill is the only fill reported.** Decided at the close of weekly bar `i`, filled at the open of weekly bar `i+1`. No close-fill number is printed as a result anywhere in the new script's output.
- **Screening folds are `fit` and `select` only.** `FOLDS.test1/2/3` and every `DEEP_FOLDS` entry are not read, not printed, and not sliced.

  *One spec ambiguity resolved here, flagged rather than buried.* The spec's SCREENING FOLDS
  clause reads "`fit` and `select` only. TEST1-3 are printed for the audit trail and choosing
  from them spends data." Those two sentences pull opposite ways. The plan takes the stricter
  reading — TEST1-3 are **not** printed — because the spec's own PROMOTION BAR makes reading
  them a *consequence* of advancing ("Advancing means: read its TEST rows, then…"), and because
  a printed number is a read number. If the owner intended the audit trail, adding the TEST
  rows later costs one line; unreading them costs a fold.
- **Verdict cost model is `DEFAULT_COST_MODEL`** (0.5 bps slippage + 1 bp commission), with a 5 bps + 1 bp block printed as a separate pre-registered statement.
- **Weekly fold warm-up is 104 bars.** `WEEKLY_PANEL_WARMUP_BARS = 104`.
- **Harness tolerance is 0.002R.**
- **The pre-registered header in `scripts/weekly-mechanism-screen.mts` is written before the first run and is not edited afterwards.** Fixing a crash is allowed; changing a threshold, a fold list, a mechanism list or a pass rule after seeing a number is not.
- Commands: `npm test` (= `tsx --test "src/**/*.test.ts"`), `npm run typecheck` (= `tsc --noEmit`), `npm run lint` (= `eslint`).
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/research/weekly.ts` **(create)** | Pure daily→weekly resampling. `weekIndex`, `toWeeklyBars`, `assertWeeklyMatchesDaily`, `weeklyPanel`, `WEEKLY_PANEL_WARMUP_BARS`. No I/O — it takes a `Panel` and returns a `Panel`. |
| `src/lib/research/weekly.test.ts` **(create)** | Unit tests for the above, including both cache time-of-day conventions. |
| `src/lib/research/panelRun.ts` **(modify)** | `sliceFold` gains a 4th parameter `warmup`, defaulted to `PANEL_WARMUP_BARS`, threaded into `foldSlice`. Backwards compatible. |
| `src/lib/research/panelRun.test.ts` **(modify)** | One test that the new parameter reaches `foldSlice`. |
| `scripts/weekly-mechanism-screen.mts` **(create)** | The pre-registered screen: harness check, resampler check, voiding check, realised weekly R, then six mechanisms × two folds × two cost models at the livable fill, each against its matched control. |
| `scripts/weekly-mechanism-screen.log` **(create)** | The committed output of the one run. |

Why the resampler is its own file rather than a function inside `panel.ts`: `panel.ts` is the *window policy* — folds, warm-up, cache paths, the survivorship caveat. Bar-class conversion is a different responsibility, it is the thing under test here, and it must be unit-testable without touching an 89MB cache. `weekly.ts` imports the `Panel` type from `panel.ts` and nothing else from it.

## Facts an implementer needs and cannot guess

These were measured from the repo on 2026-09-08. Do not re-derive them; do verify any that a task's test depends on.

**Bar timestamps use two different times of day, and both land on the correct UTC calendar date.**

```
.cache/bars/sp500-1d.json       (Alpaca)  AAPL[0] t=1451883600 = 2016-01-04T05:00:00Z   (t % 86400 = 18000)
.cache/bars/sp500-1d-deep.json  (Yahoo)   AAPL[0] t= 883751400 = 1998-01-02T14:30:00Z   (t % 86400 = 52200)
```

So `Math.floor(t / 86400)` is the correct UTC day number for both caches, and week bucketing off that day number is convention-independent. The resampler test must cover both offsets or this is untested.

**`Candle`** (`src/lib/indicators.ts:9`):
```ts
export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
```
`t` is epoch **seconds**.

**`Panel`** (`src/lib/research/panel.ts:162`):
```ts
export interface Panel {
  fetchedAt: string;
  cachePath: string;
  symbols: string[];
  bars: Record<string, Candle[]>;
  droppedBars: Record<string, number>;
}
```

**`foldSlice`** (`src/lib/research/panel.ts:200`) already takes warm-up as a parameter:
```ts
export function foldSlice(bars: Candle[], fold: Fold, warmup = PANEL_WARMUP_BARS): FoldSlice
```

**`ControlDistribution`** (`src/lib/research/control.ts:123`):
```ts
export interface ControlDistribution { runs: number; avgRs: number[]; median: number; p95: number }
```

**`runControl`** (`src/lib/research/panelRun.ts:238`):
```ts
export function runControl(
  prepared: PreparedSymbol[], fold: Fold, exit: PanelExit,
  runs: number = CONTROL_RUNS, seed: number = PANEL_SEED,
): ControlDistribution | null
```
It re-simulates through the same `exit` object, so passing an `entryAt: "open"` exit makes the control fill at the open too. That is the whole reason `entryAt` lives on the exit.

**The six screened mechanisms** are `MECHANISMS.filter(m => m.rule && !m.entryAt)` — `baseline` has `rule: null`, and `gap-fade-open` / `gap-fade-open-nomanage` carry their own `entryAt` and are therefore not fill-comparable. That filter yields, in order: `mr-down3`, `nr7`, `gap-fade`, `turn-of-month`, `vol-dryup`, `range-expand`.

**The daily close-fill avgR the harness check must reproduce**, read from `scripts/mechanism-screen-control.log`:

| mechanism | fit | select |
|---|---|---|
| mr-down3 | 0.080 | 0.133 |
| nr7 | 0.002 | 0.015 |
| gap-fade | −0.013 | −0.031 |
| turn-of-month | 0.093 | 0.051 |
| vol-dryup | 0.108 | 0.083 |
| range-expand | −0.014 | 0.002 |

---

### Task 1: The weekly resampler

**Files:**
- Create: `src/lib/research/weekly.ts`
- Test: `src/lib/research/weekly.test.ts`

**Interfaces:**
- Consumes: `Candle` from `@/lib/indicators`.
- Produces:
  - `weekIndex(t: number): number` — epoch-week index, weeks running Monday 00:00 UTC through Sunday 23:59 UTC.
  - `toWeeklyBars(daily: Candle[]): Candle[]` — one weekly bar per distinct week present, in ascending order. Timestamp is the week's **last** daily bar's `t`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/research/weekly.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import { weekIndex, toWeeklyBars } from "./weekly";

const DAY = 86_400;

/** 2016-01-04 was a Monday. Alpaca stamps a daily bar at 05:00 UTC. */
const MON_2016_01_04 = Date.parse("2016-01-04T05:00:00Z") / 1000;
/** Yahoo stamps the same session at 14:30 UTC. Same calendar date, different offset. */
const MON_2016_01_04_YAHOO = Date.parse("2016-01-04T14:30:00Z") / 1000;

const bar = (t: number, o: number, h: number, l: number, c: number, v: number): Candle => ({ t, o, h, l, c, v });

test("weekIndex buckets Monday through Friday of one week together", () => {
  const days = [0, 1, 2, 3, 4].map((k) => weekIndex(MON_2016_01_04 + k * DAY));
  assert.deepEqual(days, [days[0], days[0], days[0], days[0], days[0]]);
});

test("weekIndex starts a new bucket on the following Monday", () => {
  assert.equal(weekIndex(MON_2016_01_04 + 7 * DAY), weekIndex(MON_2016_01_04) + 1);
});

test("weekIndex does not depend on the cache's time-of-day convention", () => {
  assert.equal(weekIndex(MON_2016_01_04_YAHOO), weekIndex(MON_2016_01_04));
  assert.equal(weekIndex(MON_2016_01_04_YAHOO + 4 * DAY), weekIndex(MON_2016_01_04));
});

test("toWeeklyBars composes OHLCV from the week's daily bars", () => {
  const daily: Candle[] = [
    bar(MON_2016_01_04 + 0 * DAY, 100, 104, 99, 101, 10),
    bar(MON_2016_01_04 + 1 * DAY, 101, 108, 100, 107, 20),
    bar(MON_2016_01_04 + 2 * DAY, 107, 107, 95, 96, 30),
    bar(MON_2016_01_04 + 3 * DAY, 96, 103, 96, 102, 40),
    bar(MON_2016_01_04 + 4 * DAY, 102, 105, 101, 103, 50),
  ];
  const weekly = toWeeklyBars(daily);
  assert.equal(weekly.length, 1);
  assert.deepEqual(weekly[0], {
    t: MON_2016_01_04 + 4 * DAY, // the week's LAST session, i.e. when the bar closed
    o: 100, // Monday's open
    h: 108, // the week's max high
    l: 95, // the week's min low
    c: 103, // Friday's close
    v: 150, // the week's summed volume
  });
});

test("toWeeklyBars keeps a short week rather than dropping it", () => {
  // A three-session holiday week is a real week, and refusing it would silently
  // remove bars from the fold rather than from the resampler.
  const daily: Candle[] = [
    bar(MON_2016_01_04 + 0 * DAY, 100, 101, 99, 100, 1),
    bar(MON_2016_01_04 + 1 * DAY, 100, 102, 98, 99, 2),
    bar(MON_2016_01_04 + 2 * DAY, 99, 100, 97, 98, 3),
  ];
  const weekly = toWeeklyBars(daily);
  assert.equal(weekly.length, 1);
  assert.deepEqual(weekly[0], { t: MON_2016_01_04 + 2 * DAY, o: 100, h: 102, l: 97, c: 98, v: 6 });
});

test("toWeeklyBars emits one bar per week across a weekend boundary", () => {
  const daily: Candle[] = [
    bar(MON_2016_01_04 + 4 * DAY, 100, 101, 99, 100, 1), // Friday
    bar(MON_2016_01_04 + 7 * DAY, 100, 106, 100, 105, 2), // the next Monday
  ];
  const weekly = toWeeklyBars(daily);
  assert.equal(weekly.length, 2);
  assert.equal(weekly[0].c, 100);
  assert.equal(weekly[1].o, 100);
  assert.equal(weekly[1].c, 105);
});

test("toWeeklyBars returns nothing for an empty series", () => {
  assert.deepEqual(toWeeklyBars([]), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx tsx --test src/lib/research/weekly.test.ts
```
Expected: FAIL — `Cannot find module './weekly'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/research/weekly.ts`:

```ts
// Daily bars, folded into weekly ones — the only variable that moves in
// docs/superpowers/specs/2026-09-08-weekly-bar-mechanism-screen-design.md.
//
// WHY RESAMPLE RATHER THAN FETCH
//
// .cache/bars/sp500-1d-deep.json (1998-01-02..2016-01-04) and
// .cache/bars/sp500-1d.json (2016-01-04..2026-08-14) abut exactly, are already
// sanitized on load, and are the series every existing number in this repo was
// measured on. Asking a provider for `1wk` instead would import a second set of
// split- and dividend-adjustment conventions and put that seam INSIDE the
// tradable data, where nothing downstream could see it.
//
// WHY THE WEEK IS BUCKETED OFF THE UTC DAY NUMBER
//
// The two caches stamp a session at different times of day — Alpaca at 05:00
// UTC (= 00:00 ET), Yahoo at 14:30 UTC (= 09:30 ET) — but both land on the
// session's correct UTC calendar date, so Math.floor(t / 86400) is the same day
// number for both and the bucketing is convention-independent. Epoch day 0
// (1970-01-01) was a Thursday, hence the +3 that moves week boundaries onto
// Monday.

import type { Candle } from "@/lib/indicators";

const SEC_PER_DAY = 86_400;

/** Epoch-week index. Weeks run Monday 00:00 UTC through Sunday 23:59 UTC. */
export function weekIndex(t: number): number {
  return Math.floor((Math.floor(t / SEC_PER_DAY) + 3) / 7);
}

/**
 * Fold a daily series into weekly bars.
 *
 * The weekly bar is stamped with its LAST daily bar's `t`, i.e. the session at
 * which it closed. That is what makes `entryAt: "open"` mean what the spec says:
 * the decision is taken at the close of week `i` (Friday 16:00 ET) and the fill
 * happens at the open of week `i+1` (Monday 09:30 ET).
 *
 * Short weeks are kept. A holiday week is a real week, and dropping it would
 * remove bars from the fold rather than from the resampler.
 */
export function toWeeklyBars(daily: Candle[]): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let curWeek = NaN;

  for (const b of daily) {
    const w = weekIndex(b.t);
    if (!cur || w !== curWeek) {
      if (cur) out.push(cur);
      cur = { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
      curWeek = w;
      continue;
    }
    cur.t = b.t;
    cur.h = Math.max(cur.h, b.h);
    cur.l = Math.min(cur.l, b.l);
    cur.c = b.c;
    cur.v += b.v;
  }
  if (cur) out.push(cur);
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx tsx --test src/lib/research/weekly.test.ts
```
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/research/weekly.ts src/lib/research/weekly.test.ts && git commit -m "$(printf 'feat(research): daily-to-weekly bar resampler\n\nWeeks bucket off the UTC day number, so the two caches'"'"' different\ntime-of-day stamps (Alpaca 05:00Z, Yahoo 14:30Z) produce identical\nbuckets. The weekly bar carries its last session'"'"'s timestamp, which is\nwhat makes entryAt "open" fill at the following Monday.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 2: The resampler check and the weekly panel

**Files:**
- Modify: `src/lib/research/weekly.ts`
- Test: `src/lib/research/weekly.test.ts`

**Interfaces:**
- Consumes: `weekIndex`, `toWeeklyBars` from Task 1. `Panel` type from `./panel`.
- Produces:
  - `WEEKLY_PANEL_WARMUP_BARS: number` (= 104)
  - `assertWeeklyMatchesDaily(symbol: string, daily: Candle[], weekly: Candle[]): void` — throws on any disagreement.
  - `weeklyPanel(panel: Panel): Panel` — resamples every symbol and asserts each one. `cachePath` is suffixed `#weekly`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/research/weekly.test.ts` (and extend the import at the top of the file to
`import { weekIndex, toWeeklyBars, assertWeeklyMatchesDaily, weeklyPanel, WEEKLY_PANEL_WARMUP_BARS } from "./weekly";`,
plus `import type { Panel } from "./panel";`):

```ts
/** Five sessions a week for `weeks` weeks, prices walking up by 1 a session. */
function dailySeries(weeks: number, t0 = MON_2016_01_04): Candle[] {
  const out: Candle[] = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 5; d++) {
      const n = w * 5 + d;
      const c = 100 + n;
      out.push(bar(t0 + (w * 7 + d) * DAY, c - 1, c + 2, c - 3, c, 1_000 + n));
    }
  }
  return out;
}

test("assertWeeklyMatchesDaily accepts the resampler's own output", () => {
  const daily = dailySeries(6);
  assert.doesNotThrow(() => assertWeeklyMatchesDaily("TEST", daily, toWeeklyBars(daily)));
});

test("assertWeeklyMatchesDaily rejects a wrong high", () => {
  const daily = dailySeries(3);
  const weekly = toWeeklyBars(daily);
  weekly[1].h += 1;
  assert.throws(() => assertWeeklyMatchesDaily("TEST", daily, weekly), /TEST.*\bh\b/);
});

test("assertWeeklyMatchesDaily rejects a wrong volume sum", () => {
  const daily = dailySeries(3);
  const weekly = toWeeklyBars(daily);
  weekly[0].v -= 1;
  assert.throws(() => assertWeeklyMatchesDaily("TEST", daily, weekly), /TEST.*\bv\b/);
});

test("assertWeeklyMatchesDaily rejects a dropped week", () => {
  const daily = dailySeries(3);
  const weekly = toWeeklyBars(daily).slice(0, 2);
  assert.throws(() => assertWeeklyMatchesDaily("TEST", daily, weekly), /2 weekly bars from 3/);
});

test("weeklyPanel resamples every symbol and tags its cachePath", () => {
  const panel: Panel = {
    fetchedAt: "2026-08-14T00:00:00.000Z",
    cachePath: ".cache/bars/test.json",
    symbols: ["AAA", "BBB"],
    bars: { AAA: dailySeries(4), BBB: dailySeries(4, MON_2016_01_04_YAHOO) },
    droppedBars: { AAA: 3 },
  };
  const weekly = weeklyPanel(panel);
  assert.deepEqual(weekly.symbols, ["AAA", "BBB"]);
  assert.equal(weekly.bars.AAA.length, 4);
  assert.equal(weekly.bars.BBB.length, 4);
  assert.equal(weekly.cachePath, ".cache/bars/test.json#weekly");
  assert.equal(weekly.fetchedAt, panel.fetchedAt);
  assert.deepEqual(weekly.droppedBars, { AAA: 3 });
});

test("weeklyPanel throws rather than returning an empty panel", () => {
  const panel: Panel = {
    fetchedAt: "x", cachePath: ".cache/bars/empty.json", symbols: ["AAA"], bars: { AAA: [] }, droppedBars: {},
  };
  assert.throws(() => weeklyPanel(panel), /produced no weekly series/);
});

test("the weekly warm-up is two years and clears the engine's own 60-bar warm-up", () => {
  assert.equal(WEEKLY_PANEL_WARMUP_BARS, 104);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx tsx --test src/lib/research/weekly.test.ts
```
Expected: FAIL — `assertWeeklyMatchesDaily is not a function` (or a TypeScript resolution error on the new import names).

- [ ] **Step 3: Write the minimal implementation**

Append to `src/lib/research/weekly.ts`, and add `import type { Panel } from "./panel";` beside the existing `Candle` import:

```ts
/**
 * Warm-up prefix for a WEEKLY fold, in weekly bars.
 *
 * PANEL_WARMUP_BARS = 250 is a calendar year of daily bars and five years of
 * weekly ones, which no fold boundary in this repo can pay. 104 is two years —
 * comfortably past the point where a 14-period Wilder average has forgotten its
 * seed, above the engine's own WARMUP = 60 with margin, and exactly what the
 * deep cache can supply between DEEP_CACHE_START (1998-01-01) and deep1's
 * 2000-01-01 start, so the same constant serves both cache eras.
 */
export const WEEKLY_PANEL_WARMUP_BARS = 104;

const FIELDS = ["t", "o", "h", "l", "c", "v"] as const;

/**
 * The RESAMPLER CHECK, pre-registered in the design spec.
 *
 * A resampler that is wrong in a plausible way — an off-by-one on the week
 * boundary, a high taken from the wrong member — produces a corrupt panel that
 * runs cleanly and reports numbers. That failure would look exactly like a
 * discovery, which is the one shape this project cannot afford, so the weekly
 * series is re-derived from its daily source and compared field by field
 * rather than spot-checked.
 *
 * Throws on the first disagreement. Callers do not catch it: a failed assertion
 * must abort the run.
 */
export function assertWeeklyMatchesDaily(symbol: string, daily: Candle[], weekly: Candle[]): void {
  const groups = new Map<number, Candle[]>();
  const order: number[] = [];
  for (const b of daily) {
    const w = weekIndex(b.t);
    let g = groups.get(w);
    if (!g) {
      g = [];
      groups.set(w, g);
      order.push(w);
    }
    g.push(b);
  }

  if (weekly.length !== order.length) {
    throw new Error(`${symbol}: ${weekly.length} weekly bars from ${order.length} distinct weeks in the daily source`);
  }

  for (let k = 0; k < order.length; k++) {
    const g = groups.get(order[k])!;
    const w = weekly[k];
    const want: Candle = {
      t: g[g.length - 1].t,
      o: g[0].o,
      h: Math.max(...g.map((b) => b.h)),
      l: Math.min(...g.map((b) => b.l)),
      c: g[g.length - 1].c,
      v: g.reduce((a, b) => a + b.v, 0),
    };
    for (const f of FIELDS) {
      if (w[f] !== want[f]) {
        throw new Error(`${symbol}: weekly bar ${k} field ${f} is ${w[f]}, its daily source says ${want[f]}`);
      }
    }
    if (weekIndex(g[0].t) !== weekIndex(g[g.length - 1].t)) {
      throw new Error(`${symbol}: weekly bar ${k} spans a week boundary`);
    }
  }
}

/**
 * Resample a whole panel to weekly bars, asserting every symbol on the way.
 *
 * The assertion lives here rather than at the call site for the reason
 * loadPanel sanitizes on load: a check one script remembers to run is a check
 * that decides verdicts by which script ran.
 *
 * `cachePath` is suffixed `#weekly` so a pasted log identifies its own bar
 * class as well as its own data.
 */
export function weeklyPanel(panel: Panel): Panel {
  const bars: Record<string, Candle[]> = {};
  for (const symbol of panel.symbols) {
    const daily = panel.bars[symbol];
    if (!daily?.length) continue;
    const weekly = toWeeklyBars(daily);
    assertWeeklyMatchesDaily(symbol, daily, weekly);
    bars[symbol] = weekly;
  }

  const symbols = Object.keys(bars).sort();
  if (!symbols.length) throw new Error(`weeklyPanel: ${panel.cachePath} produced no weekly series`);

  return {
    fetchedAt: panel.fetchedAt,
    cachePath: `${panel.cachePath}#weekly`,
    symbols,
    bars,
    droppedBars: panel.droppedBars,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx tsx --test src/lib/research/weekly.test.ts
```
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/research/weekly.ts src/lib/research/weekly.test.ts && git commit -m "$(printf 'feat(research): weeklyPanel, with the resampler asserted per symbol\n\nA resampler that is wrong in a plausible way produces a corrupt panel\nthat runs cleanly and reports numbers, which would look exactly like a\ndiscovery. Every weekly bar is re-derived from its daily source and\ncompared field by field; a failure throws rather than warns.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 3: `sliceFold` takes a warm-up

**Files:**
- Modify: `src/lib/research/panelRun.ts:166` (the `sliceFold` signature and its `foldSlice` call), and the `./panel` import at line 25
- Test: `src/lib/research/panelRun.test.ts`

**Interfaces:**
- Consumes: `foldSlice(bars, fold, warmup)` and `PANEL_WARMUP_BARS`, both from `./panel`.
- Produces: `sliceFold(panel: Panel, fold: Fold, symbols?: string[], warmup?: number): FoldSliceRow[]`. The `warmup` parameter defaults to `PANEL_WARMUP_BARS`, so every existing call site is unchanged.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/research/panelRun.test.ts`:

```ts
test("sliceFold's warmup parameter changes how much prefix a fold carries", () => {
  // 400 daily bars ending inside FOLDS.fit, starting well before it, so the
  // fold's first bar has more than 250 bars of history available.
  const bars = uptrend("2015-01-01", 400);
  const panel = panelOf({ AAA: bars });

  const wide = sliceFold(panel, FOLDS.fit)[0];
  const narrow = sliceFold(panel, FOLDS.fit, panel.symbols, 10)[0];

  assert.equal(wide.entryFrom, 250, "the default is PANEL_WARMUP_BARS");
  assert.equal(narrow.entryFrom, 10, "an explicit warmup wins");
  // Same tradable window either way — only the prefix differs.
  assert.equal(wide.candles.length - wide.entryFrom, narrow.candles.length - narrow.entryFrom);
});
```

Note for the implementer: `uptrend` and `panelOf` are the existing helpers at the top of that
file; `FOLDS` is already imported there. `FOLDS.fit` runs `2016-01-01` → `2019-01-01`, and
`uptrend("2015-01-01", 400)` steps one calendar day per bar, so bar 365 is the first bar at or
after `2016-01-01` and there is room for a 250-bar prefix.

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx tsx --test src/lib/research/panelRun.test.ts
```
Expected: FAIL — `narrow.entryFrom` is 250, not 10, because the 4th argument is currently ignored (TypeScript will also reject the extra argument under `npm run typecheck`).

- [ ] **Step 3: Write the minimal implementation**

In `src/lib/research/panelRun.ts`, extend the `./panel` import:

```ts
import { foldSlice, PANEL_WARMUP_BARS, type Fold, type Panel } from "./panel";
```

and change `sliceFold`:

```ts
export function sliceFold(
  panel: Panel,
  fold: Fold,
  symbols: string[] = panel.symbols,
  warmup: number = PANEL_WARMUP_BARS,
): FoldSliceRow[] {
  const out: FoldSliceRow[] = [];
  for (const symbol of symbols) {
    const bars = panel.bars[symbol];
    if (!bars?.length) continue;
    const slice = foldSlice(bars, fold, warmup);
    if (!slice.tradableBars) continue;
    out.push({ symbol, candles: slice.candles, entryFrom: slice.entryFrom });
  }
  return out;
}
```

Add to `sliceFold`'s existing doc comment, after the paragraph about slices being cut once per fold:

```
 * `warmup` is a parameter rather than a constant because PANEL_WARMUP_BARS is
 * 250 DAILY bars — one calendar year, and five calendar years of weekly ones.
 * A weekly panel passes WEEKLY_PANEL_WARMUP_BARS instead. The default keeps
 * every daily caller bit-identical.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
npx tsx --test src/lib/research/panelRun.test.ts && npm run typecheck
```
Expected: PASS on both. Then run the whole suite, because `sliceFold` is on the research hot path:
```bash
npm test
```
Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/lib/research/panelRun.ts src/lib/research/panelRun.test.ts && git commit -m "$(printf 'feat(research): sliceFold accepts a warm-up length\n\nPANEL_WARMUP_BARS = 250 is one calendar year of daily bars and five of\nweekly ones. foldSlice already took warm-up as a parameter; sliceFold\nnow threads it, defaulted so every daily call site is unchanged.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 4: The pre-registered weekly screen

**Files:**
- Create: `scripts/weekly-mechanism-screen.mts`
- Create: `scripts/weekly-mechanism-screen.log` (produced by running the script)

**Interfaces:**
- Consumes: `weeklyPanel`, `WEEKLY_PANEL_WARMUP_BARS` (Task 2); `sliceFold(..., warmup)` (Task 3); the existing `loadPanel`, `FOLDS`, `withSignals`, `simulateFold`, `runControl`, `CONTROL_RUNS`, `PANEL_SEED`, `LADDERS`, `MECHANISMS`, `computeEntrySignals`, `WARMUP`.
- Produces: a log file. Nothing imports this script.

This task has no unit test, matching every other screen in `scripts/`. Its correctness is
carried by three checks *inside* the script — the harness check, the resampler check (which
runs inside `weeklyPanel`) and the voiding check — each of which aborts the run rather than
printing a warning. Step 3 runs those checks alone before the expensive pass, so a wiring
mistake costs seconds instead of the full screen.

- [ ] **Step 1: Write the script**

Create `scripts/weekly-mechanism-screen.mts`:

```ts
// Do any of the six existing mechanisms survive on WEEKLY bars, at a fill the
// owner can actually place?
//
// WHY THIS EXISTS
//
// scripts/deep-holdout.log had mr-down3 passing 3/3 deep folds — filled at the
// bar's CLOSE, which on a US daily bar is 16:00 ET = 03:00 Thai. The owner has
// said a 03:00 routine is not acceptable, and both fills that remove the
// wake-up are now measured and dead: mr-down3-open-fill.log (next open,
// REJECTED — the edge is the overnight gap) and mr-down3-limit-fill.log
// (limit at the previous close, REJECTED, absolute 0/3, retention -157%).
//
// mr-down3-limit-fill.mts pre-registered the consequence before it ran: a FAIL
// does not license a search for a third fill, it says the design must change
// MECHANISM rather than fill. scripts/holding-period.log then measured what to
// change to — the gap tax is mechanism-specific, not universal (mr-down3 and
// turn-of-month shed ~0.055R on FIT, everything else ~0.01R, vol-dryup ~0), so
// a mechanism whose profit survives a livable fill is not a contradiction in
// terms.
//
// Design: docs/superpowers/specs/2026-09-08-weekly-bar-mechanism-screen-design.md
//
// PRE-REGISTRATION (fixed before the first run; not edited afterwards)
//
// HYPOTHESIS. At least one mechanism in the existing library, on weekly bars,
// at the livable fill, beats its matched random-entry control.
//
// EXACTLY ONE VARIABLE MOVES: the bar class. The same six MECHANISMS entries,
// unmodified. No new rule, no swept parameter, no swept ladder. A survivor
// therefore attributes to the bar class and to nothing else.
//
// SCREENING FOLDS. fit and select ONLY. TEST1-3 are not read. DEEP1-3 are not
// read — they are the only untouched window left for a mechanism that does not
// yet exist, and descriptive statistics count as reading them.
//
// FILL. Decided at the close of weekly bar i, filled at the open of weekly bar
// i+1 (shift1 + entryAt "open"). NO CLOSE-FILL NUMBER IS PRINTED AS A RESULT.
// Every screen in this repo until now reported a price the owner cannot trade;
// three runs were spent discovering that about one mechanism.
//
// COST MODEL. DEFAULT_COST_MODEL (0.5bps slip + 1bp comm) decides. A 5bps+1bp
// retail block is printed as a separate pre-registered statement.
//
// PROMOTION BAR. A mechanism advances only if it beats the CONTROL MEDIAN in
// BOTH fit and select, at DEFAULT_COST_MODEL. Advancing means: read its TEST
// rows, and if those hold, write a SEPARATE pre-registration and spend the deep
// hold-out once. Nothing is approved from this log.
//
// VOIDING CHECK. The fraction of weekly bars where open != close must be >= 0.99.
// A resampler that collapsed a week to one print would make entryAt "open"
// identical to "close" and the whole measurement would be meaningless.
//
// RESAMPLER CHECK. weeklyPanel re-derives every weekly bar from its daily
// source and compares field by field. It throws; this script does not catch it.
//
// HARNESS CHECK. The DAILY panel is re-run at the close fill and ASSERTED —
// not printed — to still reproduce scripts/mechanism-screen-control.log to
// within 0.002R. Only match/mismatch reaches the log, so no close-fill number
// is reported as a result. A resampler that corrupts the panel must not be able
// to look like a finding. On a mismatch the offending mechanism and fold are
// named without their numbers; the numbers are recoverable by re-running
// scripts/mechanism-screen.mts, so nothing is lost by withholding them here.
//
// CONSEQUENCE OF A FAIL. If no mechanism clears the bar: do not sweep the
// ladder, do not move the threshold, do not add a rule and re-run. It means the
// "price shape from daily OHLCV" axis is closed, and the design moves to a new
// data class or to changing what the product is. See the spec's final section.
//
// KNOWN CONSTRAINT, stated before the run. sp500-1d.json begins 2016-01-04, the
// same day FOLDS.fit begins, so FIT has NO warm-up prefix and loses its first
// 60 weekly bars to the engine's own WARMUP — fourteen months of a three-year
// fold. ~96 tradable weeks x ~474 symbols is still far above MIN_PANEL_TRADES.
// SELECT is 52 weekly bars. Both folds are weaker than their daily equivalents
// and are read that way. Splicing the deep cache in front of FIT as warm-up was
// rejected: it would put a provider seam at FIT's first tradable bar.
//
//   npx tsx scripts/weekly-mechanism-screen.mts --checks-only
//   npx tsx scripts/weekly-mechanism-screen.mts | tee scripts/weekly-mechanism-screen.log
//
import "dotenv/config";
import { loadPanel, FOLDS, type Fold, type Panel } from "@/lib/research/panel";
import { weeklyPanel, WEEKLY_PANEL_WARMUP_BARS } from "@/lib/research/weekly";
import {
  sliceFold,
  withSignals,
  simulateFold,
  runControl,
  CONTROL_RUNS,
  PANEL_SEED,
  type FoldSliceRow,
  type PanelExit,
  type PreparedSymbol,
} from "@/lib/research/panelRun";
import { LADDERS, MECHANISMS, type Mechanism } from "@/lib/research/mechanisms";
import { computeEntrySignals, WARMUP, type EntrySignals } from "@/lib/backtest/engine";

const EXIT = LADDERS.flat; // the ladder every screen and hold-out in this repo ran
const RETAIL_COSTS = { slippageBps: 5, commissionBps: 1 };
const SCREEN_FOLDS: Fold[] = [FOLDS.fit, FOLDS.select];

/**
 * The rule-bearing, fill-agnostic mechanisms: `baseline` is decideSetup() and
 * has no rule closure, and gap-fade-open* pin their own entryAt, so neither is
 * comparable at a fill this script chooses.
 */
const SCREENED = MECHANISMS.filter((m) => m.rule && !m.entryAt);

/** Close-fill DAILY avgR from scripts/mechanism-screen-control.log. Asserted, never printed. */
const DAILY_CLOSE_FILL: Record<string, Record<string, number>> = {
  "mr-down3": { fit: 0.08, select: 0.133 },
  nr7: { fit: 0.002, select: 0.015 },
  "gap-fade": { fit: -0.013, select: -0.031 },
  "turn-of-month": { fit: 0.093, select: 0.051 },
  "vol-dryup": { fit: 0.108, select: 0.083 },
  "range-expand": { fit: -0.014, select: 0.002 },
};
const HARNESS_TOLERANCE_R = 0.002;
const MIN_OPEN_DIFFERS = 0.99;

/** Push every signal one bar later, so a close-derived decision fills at the next open. */
const shift1 = (s: EntrySignals): EntrySignals => {
  const sides: EntrySignals["sides"] = new Array(s.sides.length).fill(null);
  for (let i = 0; i + 1 < s.sides.length; i++) sides[i + 1] = s.sides[i];
  return { sides, atrs: s.atrs };
};

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

// --- the three checks ------------------------------------------------------

/** VOIDING CHECK. If a week collapsed to one print, entryAt "open" means nothing. */
function openDiffersFraction(panel: Panel): number {
  let bars = 0;
  let differs = 0;
  for (const symbol of panel.symbols) {
    for (const b of panel.bars[symbol]) {
      bars++;
      if (b.o !== b.c) differs++;
    }
  }
  return bars ? differs / bars : NaN;
}

/** HARNESS CHECK. Returns the failing "mech/fold" labels — never the numbers. */
function harnessMismatches(daily: Panel): string[] {
  const bad: string[] = [];
  for (const fold of SCREEN_FOLDS) {
    const slices = sliceFold(daily, fold);
    for (const mech of SCREENED) {
      const expected = DAILY_CLOSE_FILL[mech.key]?.[fold.name];
      if (expected == null) {
        bad.push(`${mech.key}/${fold.name} (no recorded close-fill value)`);
        continue;
      }
      const prepared = withSignals(slices, (_sym, candles) =>
        computeEntrySignals(candles, undefined, mech.rule!(candles)),
      );
      const got = simulateFold(prepared, fold, { ...EXIT, entryAt: "close" }).summary.avgR;
      if (got == null || Math.abs(got - expected) > HARNESS_TOLERANCE_R) bad.push(`${mech.key}/${fold.name}`);
    }
  }
  return bad;
}

/**
 * Realised 1R as a fraction of price on the bars a mechanism fires on.
 *
 * The spec's cost table projects weekly 1R at ~8.3% of price by sqrt-of-time
 * scaling off a measured daily 3.70% (scripts/r-size-vs-costs.log). Printing
 * the realised figure is what makes that projection falsifiable rather than
 * decorative.
 */
function medianSignalR(prepared: PreparedSymbol[], slMult: number): number {
  const rs: number[] = [];
  for (const p of prepared) {
    const { sides, atrs } = p.signals;
    for (let i = 0; i < atrs.length; i++) {
      if (!sides[i]) continue;
      const r = (slMult * atrs[i]) / p.candles[i]?.c;
      if (r > 0 && r < 1) rs.push(r);
    }
  }
  rs.sort((a, b) => a - b);
  return quantile(rs, 0.5);
}

// --- the screen ------------------------------------------------------------

interface Row {
  fold: Fold;
  trades: number;
  symbolsTraded: number;
  avgR: number | null;
  /** BacktestSummary.winRate is already a PERCENT (0-100), not a fraction. Do not multiply it. */
  winRate: number;
  ctrlMed: number | null;
  ctrlP95: number | null;
  medianR: number;
}

/** Signals for one fold at the livable fill: decided on bar i, pushed to fill at bar i+1's open. */
function livablePrepared(slices: FoldSliceRow[], rule: NonNullable<Mechanism["rule"]>): PreparedSymbol[] {
  return withSignals(slices, (_sym, candles) =>
    computeEntrySignals(candles, undefined, rule(candles)),
  ).map((p) => ({ ...p, signals: shift1(p.signals) }));
}

function runRow(prepared: PreparedSymbol[], fold: Fold, exit: PanelExit): Omit<Row, "fold"> {
  const run = simulateFold(prepared, fold, exit);
  const ctrl = runControl(prepared, fold, exit, CONTROL_RUNS, PANEL_SEED);
  return {
    trades: run.trades.length,
    symbolsTraded: run.symbolsTraded,
    avgR: run.summary.avgR,
    winRate: run.summary.winRate,
    ctrlMed: ctrl?.median ?? null,
    ctrlP95: ctrl?.p95 ?? null,
    medianR: medianSignalR(prepared, exit.slMult),
  };
}

const f3 = (v: number | null) => (v == null || !Number.isFinite(v) ? "    —" : v.toFixed(3).padStart(7));

function printRow(r: Row): void {
  const margin = r.avgR != null && r.ctrlMed != null ? r.avgR - r.ctrlMed : null;
  const verdict = margin == null ? "no-control" : margin > 0 ? "beats-median" : "LOSES-to-median";
  console.log(
    `    ${r.fold.name.padEnd(8)}${String(r.trades).padStart(8)}${String(r.symbolsTraded).padStart(9)}  ` +
      `${f3(r.avgR)}  ${r.winRate.toFixed(1).padStart(5)}%  ` +
      `${f3(r.ctrlMed)}  ${f3(r.ctrlP95)}  ${f3(margin)}  ${(100 * r.medianR).toFixed(2).padStart(6)}%  ${verdict}`,
  );
}

async function main() {
  const checksOnly = process.argv.includes("--checks-only");

  console.log("weekly-bar mechanism screen — livable fill only, fit + select only");
  console.log("PRE-REGISTERED: see this script's header. Nothing here may be approved.");

  console.log("\nloading daily panel cache…");
  const daily = loadPanel();
  console.log(`panel ${daily.cachePath} — ${daily.symbols.length} symbols, fetchedAt ${daily.fetchedAt}`);

  // HARNESS CHECK — daily, close fill, asserted not printed.
  const bad = harnessMismatches(daily);
  console.log(`HARNESS CHECK (daily panel reproduces mechanism-screen-control.log to ${HARNESS_TOLERANCE_R}R): ` +
    (bad.length ? `mismatch — ${bad.join(", ")}` : "match"));
  if (bad.length) {
    console.error("aborting: the harness does not reproduce its own recorded numbers, so nothing below would mean anything.");
    process.exit(1);
  }

  // RESAMPLER CHECK — inside weeklyPanel; it throws, and nothing catches it.
  console.log("\nresampling to weekly bars (every bar asserted against its daily source)…");
  const weekly = weeklyPanel(daily);
  const totalWeeks = weekly.symbols.reduce((a, s) => a + weekly.bars[s].length, 0);
  console.log(`RESAMPLER CHECK: pass — ${weekly.symbols.length} symbols, ${totalWeeks} weekly bars from ${weekly.cachePath}`);

  // VOIDING CHECK.
  const frac = openDiffersFraction(weekly);
  console.log(`VOIDING CHECK (weekly bars with open != close): ${(100 * frac).toFixed(2)}% ` +
    `— bar is ${(100 * MIN_OPEN_DIFFERS).toFixed(0)}%`);
  if (!(frac >= MIN_OPEN_DIFFERS)) {
    console.error("aborting: VOID. A weekly bar whose open equals its close makes the livable fill identical to the close fill.");
    process.exit(1);
  }

  const slices: Record<string, FoldSliceRow[]> = {};
  for (const fold of SCREEN_FOLDS) {
    slices[fold.name] = sliceFold(weekly, fold, weekly.symbols, WEEKLY_PANEL_WARMUP_BARS);
    const rows = slices[fold.name];
    const tradable = rows.length ? rows[0].candles.length - rows[0].entryFrom : 0;
    console.log(`  ${fold.name}: ${rows.length} symbols participate, ` +
      `${rows.length ? rows[0].entryFrom : 0} warm-up + ${tradable} tradable weekly bars (first symbol)`);
  }

  if (checksOnly) {
    console.log("\n--checks-only: stopping before the screen.");
    return;
  }

  console.log(`\nfill: decided at the close of weekly bar i, filled at the open of bar i+1 ` +
    `(Friday 16:00 ET -> Monday 09:30 ET = Saturday 03:00 -> Monday 20:30 Thai)`);
  console.log(`ladder=flat tp1=${EXIT.tp1Mult} sl=${EXIT.slMult}  control=${CONTROL_RUNS} runs  seed=${PANEL_SEED}  ` +
    `engine WARMUP=${WARMUP} bars  fold warm-up=${WEEKLY_PANEL_WARMUP_BARS} weekly bars`);

  const blocks: { label: string; exit: PanelExit; decides: boolean }[] = [
    { label: "DEFAULT_COST_MODEL (0.5bps slip + 1bp comm) — THIS BLOCK DECIDES", exit: { ...EXIT, entryAt: "open" }, decides: true },
    { label: "retail (5bps slip + 1bp comm) — pre-registered second statement", exit: { ...EXIT, entryAt: "open", costs: RETAIL_COSTS }, decides: false },
  ];

  const promoted: string[] = [];

  for (const block of blocks) {
    console.log(`\n${"=".repeat(112)}\n${block.label}\n${"=".repeat(112)}`);
    for (const mech of SCREENED) {
      console.log(`\n${mech.key}`);
      console.log(`  ${mech.blurb}`);
      console.log("    fold      trades  symbols     avgR     win%   ctrl med  ctrl p95   margin      1R  verdict");
      const beats: boolean[] = [];
      for (const fold of SCREEN_FOLDS) {
        const prepared = livablePrepared(slices[fold.name], mech.rule!);
        const r = runRow(prepared, fold, block.exit);
        printRow({ fold, ...r });
        beats.push(r.avgR != null && r.ctrlMed != null && r.avgR > r.ctrlMed);
      }
      if (block.decides && beats.every(Boolean)) promoted.push(mech.key);
    }
  }

  console.log(`\n${"=".repeat(112)}`);
  console.log("PROMOTION BAR: beats the control MEDIAN in BOTH fit and select, at DEFAULT_COST_MODEL.");
  console.log(promoted.length
    ? `ADVANCES: ${promoted.join(", ")} — read its TEST rows, then write a SEPARATE pre-registration before spending the deep hold-out.`
    : "NO CANDIDATE. Per this script's header: do not sweep the ladder, do not move the threshold, do not add a rule and re-run.");
  console.log(`\n1R is the median of slMult x ATR / close over the bars each mechanism fires on. The spec projected ~8.3%`);
  console.log(`of price for weekly bars by sqrt-of-time scaling off a measured daily 3.70%; the column above is what`);
  console.log(`actually happened, and is the number that falsifies the cost arithmetic if it disagrees.`);
}

await main();
```

- [ ] **Step 2: Typecheck and lint the script**

Run:
```bash
npm run typecheck && npm run lint
```
Expected: PASS on both.

Two typing details that are easy to get wrong here, both verified against the source:
- `BacktestSummary.winRate` is **already a percent** (`engine.ts:495`, `// %`), and it is
  `number`, not `number | null`. `scripts/mechanism-screen.mts:132` prints it as
  `r.winRate.toFixed(1)` with no multiplication. Do not multiply by 100.
- `Mechanism["rule"]` is `((candles: Candle[]) => EntryRule) | null`, so `livablePrepared`'s
  parameter type is `NonNullable<Mechanism["rule"]>` — the same form `runCell` uses in
  `scripts/holding-period.mts:89`. No cast, no `any`.

- [ ] **Step 3: Run the checks alone, before spending the full screen**

Run:
```bash
npx tsx scripts/weekly-mechanism-screen.mts --checks-only
```
Expected output shape:
```
HARNESS CHECK (...): match
RESAMPLER CHECK: pass — 491 symbols, ~139000 weekly bars from .cache/bars/sp500-1d.json#weekly
VOIDING CHECK (weekly bars with open != close): 99.9x% — bar is 99%
  fit: ~474 symbols participate, 0 warm-up + ~156 tradable weekly bars (first symbol)
  select: ~476 symbols participate, 104 warm-up + 52 tradable weekly bars (first symbol)
```
`fit`'s warm-up being **0** is expected and is the constraint stated in the header — the cache
starts the same day the fold does. If any check fails, stop and diagnose; do not proceed to the
full run, and do not weaken a check to get past it.

- [ ] **Step 4: Run the screen and capture the log**

Run:
```bash
npx tsx scripts/weekly-mechanism-screen.mts | tee scripts/weekly-mechanism-screen.log
```
Expected: completes with a `PROMOTION BAR` block naming either the mechanisms that advance or
`NO CANDIDATE`. Six mechanisms × two folds × two cost models × (1 simulation + 200 control runs)
on weekly bars; weekly series are roughly a fifth the length of the daily ones, so expect this to
be faster than a daily `mechanism-screen.mts --control=200` run, not slower.

- [ ] **Step 5: Read the log against the pre-registration, and write nothing else**

Confirm before reporting:
- all three checks say pass/match,
- no TEST or DEEP fold appears anywhere in the log,
- no close-fill number appears anywhere in the log,
- the verdict quoted is the one from the `DEFAULT_COST_MODEL` block.

If the result is `NO CANDIDATE`, that is the pre-registered outcome and the consequence clause in
the header applies. Do not add a mechanism, widen a fold, or sweep the ladder in response.

- [ ] **Step 6: Commit the script and its log together**

```bash
git add scripts/weekly-mechanism-screen.mts scripts/weekly-mechanism-screen.log && git commit -m "$(printf 'research: weekly-bar mechanism screen at the livable fill\n\nSix existing mechanisms, unmodified, on weekly bars, decided at Friday'"'"'s\nclose and filled at Monday'"'"'s open. Exactly one variable moves: the bar\nclass. fit and select only; the deep folds stay untouched.\n\nHarness, resampler and voiding checks all abort the run rather than\nwarn. No close-fill number is reported as a result.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 5: Record the result where the next session will find it

**Files:**
- Modify: `docs/STATE.md` (§3 "Done recently" and §5 "Traps", as the result dictates)

**Interfaces:**
- Consumes: `scripts/weekly-mechanism-screen.log` from Task 4.
- Produces: nothing importable.

- [ ] **Step 1: Write the §3 entry**

Add a dated entry at the top of `docs/STATE.md` §3, one paragraph, in the file's existing style.
It must state: the pre-registered hypothesis, the three checks' outcomes, the promotion-bar
verdict, and — verbatim from the log — each mechanism's `fit` and `select` avgR and control
median at `DEFAULT_COST_MODEL`. Link the spec, the plan and the log.

State the two constraints as facts, not caveats to be discovered later: FIT carries **no**
warm-up prefix and loses its first 60 weekly bars, and SELECT is 52 weekly bars.

- [ ] **Step 2: If the result is a FAIL, add the trap**

Add to §5, so the direction is not re-funded:

> **Do not re-screen the existing six mechanisms on weekly bars.** Run 2026-09-08,
> pre-registered, at the livable fill on fit + select: <verdict>. The bar class was the one
> variable moved, and moving it did not rescue any of them. `scripts/weekly-mechanism-screen.log`.

If the result is a PASS, add nothing to §5 — add to §4 instead the next step the script's own
header names: read the survivor's TEST rows, then write a **separate** pre-registration before
spending the deep hold-out.

- [ ] **Step 3: Commit**

```bash
git add docs/STATE.md && git commit -m "$(printf 'docs: record the weekly-bar screen result in STATE\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

## Notes for the executor

**What must not happen, in order of how likely it is.**

1. **Do not read a TEST or DEEP fold.** Not to sanity-check, not "just to see". The deep folds
   are the only untouched window this project has left.
2. **Do not print a close-fill number as a result.** The harness check computes them and must
   emit only `match` / `mismatch`.
3. **Do not weaken a check to get past it.** All three checks abort on purpose. A failing
   resampler check means the weekly panel is wrong; a failing voiding check means the
   measurement is meaningless; a failing harness check means the daily pipeline moved under us.
4. **Do not edit the script header after the first run.** Fixing a crash is fine. Changing a
   threshold, a fold list, a mechanism list or a pass rule after seeing a number is not, and it
   is the specific failure the header exists to prevent.
5. **Do not touch the engine.** If a task appears to need an engine change, the plan is wrong —
   stop and say so rather than changing `src/lib/backtest/engine.ts`.
