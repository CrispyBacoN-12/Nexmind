# Cross-Sectional Mean Reversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a portfolio-level cross-sectional backtester and use it to reach a go/no-go decision on a long-only mean-reversion strategy for US stocks, judged against the acceptance gates written in the spec.

**Architecture:** A new pure module tree under `src/lib/backtest/crossSectional/` — types, a shared trading-day calendar, per-symbol indicator series, a day-by-day portfolio loop, and equity-curve metrics. Three `.mts` scripts sit on top: one caches daily bars to disk, one sweeps the parameter grid, one runs the walk-forward and scores the gates. The library performs no I/O, so every rule is unit-testable on synthetic bars.

**Tech Stack:** TypeScript (strict), `node:test` via `tsx --test`, existing `src/lib/indicators.ts` primitives, `fetchCandlesBatch` for data, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-15-cross-sectional-mean-reversion-design.md`

## Global Constraints

- **Tests run with `npm test`** = `tsx --test "src/**/*.test.ts"`. Test files sit beside their module as `<name>.test.ts` and use `node:test` + `node:assert/strict`.
- **Every module under `src/lib/backtest/crossSectional/` must stay pure** — no database, no network, no `process.env`. This is what makes it testable and what the no-lookahead test depends on.
- **Never import a runtime value from `src/lib/backtest/engine.ts`.** That file imports `trading/scanner.ts` → `research/adapter.ts` → Prisma at module scope, which needs `DATABASE_URL` to construct. Use `import type { CostModel } from "@/lib/backtest/engine"` — type-only imports are erased at compile time and pull in nothing. `DEFAULT_COST_MODEL` is a *value*, so only the `.mts` scripts (which load dotenv) may import it.
- **Path alias:** `@/*` maps to `./src/*` (`tsconfig.json`).
- **Candle type:** `{ t: number; o: number; h: number; l: number; c: number; v: number }` from `@/lib/indicators`. `t` is **epoch seconds**.
- **Indicator helpers return `(number | null)[]` aligned to the input array**, with `null` during the warm-up period. Reuse `sma`, `rsi`, `atr` from `@/lib/indicators` — do not reimplement them.
- **Scripts** live in `scripts/` as `.mts`, run via `npx tsx scripts/<name>.mts`. Scripts that touch Alpaca/Webull need env vars: run them as `node --env-file=.env --import tsx scripts/<name>.mts`.
- **Cost model:** `{ slippageBps: 0.5, commissionBps: 1 }` (the value of `DEFAULT_COST_MODEL`) so results stay comparable with every earlier experiment in this project.
- **Commit after every task.** Current branch is `webull-shadow-execution`; the working tree has unrelated modified files — `git add` only the files each task names, never `git add -A`.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/backtest/crossSectional/types.ts` | Config, trade, equity-point, and summary shapes. No logic. |
| `src/lib/backtest/crossSectional/calendar.ts` | Normalize timestamps to UTC day keys; build the shared trading-day calendar and per-symbol lookup index. |
| `src/lib/backtest/crossSectional/signals.ts` | Per-symbol indicator series, the point-in-time eligibility filter, and the ranking score. |
| `src/lib/backtest/crossSectional/summary.ts` | Equity-curve metrics: CAGR, max drawdown, time-in-market, profit factor. |
| `src/lib/backtest/crossSectional/engine.ts` | The day-by-day portfolio loop. Consumes all of the above. |
| `scripts/cache-daily-bars.mts` | Fetch daily bars for a universe + SPY, write a disk cache, report history depth. |
| `scripts/sweep-cross-sectional.mts` | Train/test split sweep over the parameter grid. |
| `scripts/walkforward-cross-sectional.mts` | 6-block walk-forward, cost stress, universe haircut, SPY benchmark, gate scoring. |

**Deviation from the spec, deliberate:** the spec named a single file `crossSectional.ts`. Split into five focused files because the day loop, the ranking rules, and the metrics have genuinely separate reasons to change, and each is easier to test alone. The public entry point is still one function, `crossSectionalBacktest`.

**Out of scope for this plan:** everything in the spec's Section 5 (the live runner `scripts/scan-cross-sectional.mts`, the AI stage, the scheduler, Webull routing). The spec gates deployment on all seven acceptance gates passing, so it cannot be planned until Task 7 produces a result. This plan ends at the go/no-go decision.

---

### Task 1: Daily-bar cache and history-depth measurement

Do this first. The spec's Open Risks flag that free-tier Alpaca daily depth is unmeasured, and that if history is shorter than ~8 years the validation plan needs revisiting **before** the sweep. This task answers that question and produces the cache every later task depends on.

**Files:**
- Create: `scripts/cache-daily-bars.mts`
- Create: `.cache/` entry in `.gitignore`

**Interfaces:**
- Consumes: `fetchCandlesBatch(symbols, range, interval)` from `@/lib/marketData` (returns `Map<string, CandleResponse>`; unfetchable symbols are omitted), `UNIVERSES` from `@/lib/trading/universe`.
- Produces: a JSON cache file per universe at `.cache/bars/<universe>-1d.json` with shape `{ fetchedAt: string; bars: Record<string, Candle[]> }`. Later scripts read this file; they never call the network.

- [ ] **Step 1: Add the cache directory to .gitignore**

Append to `.gitignore`:

```
.cache/
```

- [ ] **Step 2: Write the cache script**

Create `scripts/cache-daily-bars.mts`:

```ts
// Fetches daily bars for a universe (plus SPY, the regime input) and writes them
// to a disk cache. Sweeps re-run dozens of times; without this they would re-pull
// ~500 symbols per run, which is slow and rate-limit hostile.
//
// Usage: node --env-file=.env --import tsx scripts/cache-daily-bars.mts [universe] [range]
//   universe: dow30 | nasdaq100 | sp500   (default sp500)
//   range:    5y | max                    (default max)
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fetchCandlesBatch } from "@/lib/marketData";
import { UNIVERSES } from "@/lib/trading/universe";
import type { Range } from "@/lib/yahoo";

const REGIME_SYMBOL = "SPY";

const universeKey = process.argv[2] ?? "sp500";
const range = (process.argv[3] ?? "max") as Range;

const universe = UNIVERSES[universeKey];
if (!universe) {
  console.error(`unknown universe "${universeKey}" — expected one of: ${Object.keys(UNIVERSES).join(", ")}`);
  process.exit(1);
}

const symbols = [...new Set([...universe.symbols, REGIME_SYMBOL])];
console.log(`fetching ${symbols.length} symbols, range=${range}, interval=1d ...`);

const started = Date.now();
const fetched = await fetchCandlesBatch(symbols, range, "1d");
console.log(`fetched ${fetched.size}/${symbols.length} symbols in ${((Date.now() - started) / 1000).toFixed(1)}s`);

const bars: Record<string, { t: number; o: number; h: number; l: number; c: number; v: number }[]> = {};
for (const [sym, resp] of fetched) bars[sym] = resp.candles;

// Depth report — the number this task exists to produce.
const counts = Object.values(bars).map((b) => b.length).sort((a, b) => a - b);
const median = counts[Math.floor(counts.length / 2)] ?? 0;
const earliest = Math.min(...Object.values(bars).flatMap((b) => (b.length ? [b[0].t] : [])));
const latest = Math.max(...Object.values(bars).flatMap((b) => (b.length ? [b[b.length - 1].t] : [])));
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

console.log(`\n--- history depth ---`);
console.log(`bars per symbol: min=${counts[0]} median=${median} max=${counts[counts.length - 1]}`);
console.log(`date span: ${iso(earliest)} .. ${iso(latest)}  (~${(median / 252).toFixed(1)} years median)`);
console.log(`SPY bars: ${bars[REGIME_SYMBOL]?.length ?? 0}`);
const missing = symbols.filter((s) => !bars[s]);
if (missing.length) console.log(`missing (${missing.length}): ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? " ..." : ""}`);

const outPath = `.cache/bars/${universeKey}-1d.json`;
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify({ fetchedAt: new Date().toISOString(), bars }));
console.log(`\nwrote ${outPath}`);
```

- [ ] **Step 3: Run it on the smallest universe first**

Run: `node --env-file=.env --import tsx scripts/cache-daily-bars.mts dow30 max`

Expected: 31 symbols fetched (Dow 30 + SPY), a depth report, and `.cache/bars/dow30-1d.json` written. If Webull keys are set, `fetchCandlesBatch` tries Webull first at concurrency 8 — note in the output whether Webull or Alpaca served the bars, since their history depth differs.

- [ ] **Step 4: Run it on the full universe**

Run: `node --env-file=.env --import tsx scripts/cache-daily-bars.mts sp500 max`

Expected: ~490 symbols, depth report, `.cache/bars/sp500-1d.json` written.

- [ ] **Step 5: CHECKPOINT — report the depth before continuing**

Report the median years of history to the user. The spec's validation plan assumes roughly 8+ years.

- **Median ≥ 8 years:** proceed to Task 2 unchanged.
- **Median 4–8 years:** proceed, but flag that gate 1 (≥500 trades per half) and the 6-block walk-forward may compete for data; Task 7 will have to report which one had to give.
- **Median < 4 years:** **stop and re-plan.** The validation design cannot be honoured and continuing would produce numbers we have already agreed not to trust.

- [ ] **Step 6: Commit**

```bash
git add .gitignore scripts/cache-daily-bars.mts
git commit -m "feat(quant): daily-bar disk cache + history-depth report for cross-sectional work"
```

---

### Task 2: Types and the shared trading-day calendar

**Files:**
- Create: `src/lib/backtest/crossSectional/types.ts`
- Create: `src/lib/backtest/crossSectional/calendar.ts`
- Test: `src/lib/backtest/crossSectional/calendar.test.ts`

**Interfaces:**
- Consumes: `Candle` from `@/lib/indicators`, `CostModel` from `@/lib/backtest/engine` (**type-only import**).
- Produces: `CsConfig`, `CsTrade`, `EquityPoint`, `CsSummary`, `CsResult` (types.ts); `dayKey(t)`, `alignUniverse(bars)`, `AlignedUniverse` (calendar.ts). Tasks 3–5 rely on these exact names.

- [ ] **Step 1: Write the types module**

Create `src/lib/backtest/crossSectional/types.ts`:

```ts
// Shapes for the cross-sectional (rank-the-universe) backtester. No logic here.
import type { CostModel } from "@/lib/backtest/engine"; // type-only: engine.ts pulls in Prisma at runtime

/** How "how far has it fallen" is measured. */
export type FallMeasure = "atrReturn" | "rsi2";

/** Market-wide on/off switch for opening new positions. */
export type RegimeMode = "off" | "spySma200" | "spySlope";

export interface CsConfig {
  /** Lookback in bars for the fall measure (ignored when measure is "rsi2"). */
  lookback: number;
  measure: FallMeasure;
  /**
   * A candidate must score at or below this to be entered at all. Ranking alone
   * is not enough: in a market where nothing has fallen, the top-ranked name is
   * merely the least-rising stock, which is not a mean-reversion setup. 0 for
   * "atrReturn" (the price must actually be down over K days); ~10 for "rsi2".
   * null disables the gate and reverts to pure ranking.
   */
  maxRankScore: number | null;
  /** Minimum close price on the signal bar. */
  minPrice: number;
  /** Minimum 20-day average dollar volume (close * volume) on the signal bar. */
  minDollarVol: number;
  /** Require the signal-bar close to sit above the symbol's own SMA200. */
  requireAboveSma200: boolean;
  regime: RegimeMode;
  /** Drop symbols whose largest close-to-close move in the trailing 20 bars exceeds this %. null = off. */
  maxSingleDayMovePct: number | null;
  /** Concurrent position slots. */
  slots: number;
  /** Bars to hold before the scheduled exit. */
  holdDays: number;
  /** Also exit early when the close crosses back above SMA5. */
  exitOnSma5: boolean;
  /** ATR multiple for the protective stop. null = no stop. */
  stopAtrMult: number | null;
  costs: CostModel;
  /** Starting equity. */
  capital: number;
  /** Symbol supplying the regime input; excluded from the tradable set. */
  regimeSymbol: string;
}

export type ExitReason = "hold-expiry" | "stop" | "sma5" | "end-of-data";

export interface CsTrade {
  symbol: string;
  entryT: number; // epoch seconds of the bar the fill happened on
  exitT: number;
  entry: number; // fill price, cost-adjusted
  exit: number; // fill price, cost-adjusted
  shares: number; // fractional shares are allowed
  grossPnl: number;
  pnl: number; // net of slippage + commission
  retPct: number; // pnl as a % of the capital allocated to this position
  /** pnl / risk-per-share*shares. null when stopAtrMult is null (no defined risk unit). */
  rMultiple: number | null;
  reason: ExitReason;
  daysHeld: number;
}

export interface EquityPoint {
  t: number; // epoch seconds of the trading day
  equity: number; // cash + marked-to-market open positions
  positions: number; // open position count that day
}

export interface CsSummary {
  trades: number;
  wins: number;
  winRate: number; // %
  totalPnl: number;
  profitFactor: number | null; // null when there are no losing trades
  avgR: number | null; // null when the config has no stop
  avgRetPct: number | null;
  cagrPct: number | null;
  maxDrawdownPct: number | null; // positive magnitude
  timeInMarketPct: number; // % of trading days with at least one open position
  tradingDays: number;
}

export interface CsResult {
  trades: CsTrade[];
  equityCurve: EquityPoint[];
  summary: CsSummary;
}
```

- [ ] **Step 2: Write the failing calendar test**

Create `src/lib/backtest/crossSectional/calendar.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { dayKey, alignUniverse } from "./calendar";
import type { Candle } from "@/lib/indicators";

const DAY = 86_400;
function bar(t: number, c: number): Candle {
  return { t, o: c, h: c, l: c, c, v: 1000 };
}

test("dayKey collapses different intraday timestamps on the same UTC day", () => {
  // Providers stamp daily bars differently: some at midnight UTC, some at the
  // 13:30 UTC US open. Both must land on the same calendar day.
  assert.equal(dayKey(10 * DAY), dayKey(10 * DAY + 13 * 3600 + 1800));
  assert.notEqual(dayKey(10 * DAY), dayKey(11 * DAY));
});

test("alignUniverse builds a sorted union of trading days", () => {
  const bars = new Map<string, Candle[]>([
    ["AAA", [bar(1 * DAY, 10), bar(3 * DAY, 12)]],
    ["BBB", [bar(2 * DAY, 20), bar(3 * DAY, 21)]],
  ]);
  const u = alignUniverse(bars);
  assert.deepEqual(u.days, [dayKey(1 * DAY), dayKey(2 * DAY), dayKey(3 * DAY)]);
});

test("alignUniverse indexes each symbol's bar position by day", () => {
  const bars = new Map<string, Candle[]>([
    ["AAA", [bar(1 * DAY, 10), bar(3 * DAY, 12)]],
    ["BBB", [bar(2 * DAY, 20), bar(3 * DAY, 21)]],
  ]);
  const u = alignUniverse(bars);
  assert.equal(u.index.get("AAA")?.get(dayKey(3 * DAY)), 1);
  assert.equal(u.index.get("BBB")?.get(dayKey(3 * DAY)), 1);
  // AAA has no bar on day 2 — a symbol that had not listed yet, or a halt.
  assert.equal(u.index.get("AAA")?.get(dayKey(2 * DAY)), undefined);
});

test("alignUniverse keeps the last bar when a symbol has two bars on one day", () => {
  const bars = new Map<string, Candle[]>([
    ["AAA", [bar(1 * DAY, 10), bar(1 * DAY + 3600, 11)]],
  ]);
  const u = alignUniverse(bars);
  assert.deepEqual(u.days, [dayKey(1 * DAY)]);
  assert.equal(u.index.get("AAA")?.get(dayKey(1 * DAY)), 1);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx tsx --test src/lib/backtest/crossSectional/calendar.test.ts`
Expected: FAIL — cannot find module `./calendar`.

- [ ] **Step 4: Write the calendar module**

Create `src/lib/backtest/crossSectional/calendar.ts`:

```ts
// The cross-sectional loop walks a shared calendar of trading days rather than
// each symbol's own bar array, so that "rank everything eligible today" is a
// well-defined operation. Daily bars arrive stamped at different times of day
// depending on the provider, so every timestamp is collapsed to a UTC day key
// before anything is compared.
import type { Candle } from "@/lib/indicators";

const DAY_SECONDS = 86_400;

/** Collapse an epoch-second timestamp to the UTC calendar day it falls in. */
export function dayKey(t: number): number {
  return Math.floor(t / DAY_SECONDS);
}

export interface AlignedUniverse {
  /** Sorted union of every day any symbol has a bar for. */
  days: number[];
  /** symbol -> (day key -> index into that symbol's candle array). */
  index: Map<string, Map<number, number>>;
}

export function alignUniverse(bars: Map<string, Candle[]>): AlignedUniverse {
  const daySet = new Set<number>();
  const index = new Map<string, Map<number, number>>();

  for (const [symbol, candles] of bars) {
    const perDay = new Map<number, number>();
    candles.forEach((candle, i) => {
      const key = dayKey(candle.t);
      daySet.add(key);
      perDay.set(key, i); // later bar on the same day wins
    });
    index.set(symbol, perDay);
  }

  return { days: [...daySet].sort((a, b) => a - b), index };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx tsx --test src/lib/backtest/crossSectional/calendar.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Verify the type module compiles**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/backtest/crossSectional/types.ts src/lib/backtest/crossSectional/calendar.ts src/lib/backtest/crossSectional/calendar.test.ts
git commit -m "feat(quant): cross-sectional types + shared trading-day calendar"
```

---

### Task 3: Per-symbol series, eligibility filter, and ranking score

**Files:**
- Create: `src/lib/backtest/crossSectional/signals.ts`
- Test: `src/lib/backtest/crossSectional/signals.test.ts`

**Interfaces:**
- Consumes: `sma`, `rsi`, `atr`, `Candle` from `@/lib/indicators`; `CsConfig` from `./types`.
- Produces: `SymbolSeries`, `buildSeries(candles)`, `isEligible(series, i, cfg)`, `rankScore(series, i, cfg)`. Task 5's engine calls all three.

Ranking convention: **lower score = better candidate** (more oversold). `rankScore` returns `null` when the score cannot be computed at that index.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/backtest/crossSectional/signals.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSeries, isEligible, rankScore } from "./signals";
import type { CsConfig } from "./types";
import type { Candle } from "@/lib/indicators";

const DAY = 86_400;

/** A flat series at `price`, long enough for SMA200 to exist. */
function flatSeries(n: number, price: number, volume = 1_000_000): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    t: (i + 1) * DAY, o: price, h: price * 1.01, l: price * 0.99, c: price, v: volume,
  }));
}

/**
 * A gently rising series. Wilder's RSI needs at least some up-moves to produce
 * distinguishable values — on a series with none, avgGain stays exactly 0 and
 * every RSI reading pins to 0 (or to 100 while avgLoss is also 0).
 */
function risingSeries(n: number, start: number, step = 0.1, volume = 1_000_000): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const p = start + i * step;
    return { t: (i + 1) * DAY, o: p, h: p * 1.01, l: p * 0.99, c: p, v: volume };
  });
}

// Optional filters start OFF here so each test can switch on exactly the one it
// is exercising. A fixture built to trip the SMA200 filter also trips the
// news filter, and vice versa — turning both on by default would make every
// assertion pass for the wrong reason.
const baseCfg: CsConfig = {
  lookback: 3, measure: "atrReturn", maxRankScore: 0,
  minPrice: 5, minDollarVol: 10_000_000,
  requireAboveSma200: false, regime: "off", maxSingleDayMovePct: null,
  slots: 5, holdDays: 5, exitOnSma5: false, stopAtrMult: null,
  costs: {}, capital: 10_000, regimeSymbol: "SPY",
};

test("buildSeries returns arrays aligned to the input length", () => {
  const s = buildSeries(flatSeries(250, 100));
  assert.equal(s.candles.length, 250);
  assert.equal(s.atr.length, 250);
  assert.equal(s.sma200.length, 250);
  assert.equal(s.sma5.length, 250);
  assert.equal(s.rsi2.length, 250);
  assert.equal(s.dollarVol20.length, 250);
  assert.equal(s.maxMovePct20.length, 250);
});

test("dollarVol20 averages close * volume over the trailing 20 bars", () => {
  const s = buildSeries(flatSeries(250, 100, 500_000));
  assert.equal(s.dollarVol20[249], 100 * 500_000);
  assert.equal(s.dollarVol20[5], null); // not enough history yet
});

test("isEligible rejects a symbol below the price floor", () => {
  const s = buildSeries(flatSeries(250, 3));
  assert.equal(isEligible(s, 249, baseCfg), false);
});

test("isEligible rejects a symbol below the dollar-volume floor", () => {
  const s = buildSeries(flatSeries(250, 100, 1000)); // $100k/day, well under $10M
  assert.equal(isEligible(s, 249, baseCfg), false);
});

test("isEligible rejects a symbol under its own SMA200 when the quality filter is on", () => {
  const candles = flatSeries(250, 100);
  for (let i = 240; i < 250; i++) { // sharp drop below the long average
    candles[i] = { ...candles[i], o: 50, h: 51, l: 49, c: 50 };
  }
  const s = buildSeries(candles);
  assert.equal(isEligible(s, 249, { ...baseCfg, requireAboveSma200: true }), false);
  assert.equal(isEligible(s, 249, baseCfg), true); // filter off: nothing else objects
});

test("isEligible rejects a symbol with a news-sized single-day move", () => {
  const candles = flatSeries(250, 100);
  candles[245] = { ...candles[245], o: 100, h: 130, l: 100, c: 125 }; // +25% day
  const s = buildSeries(candles);
  assert.equal(isEligible(s, 249, { ...baseCfg, maxSingleDayMovePct: 15 }), false);
  assert.equal(isEligible(s, 249, baseCfg), true); // filter off: nothing else objects
});

test("isEligible rejects indexes before the warm-up period completes", () => {
  const s = buildSeries(flatSeries(250, 100));
  assert.equal(isEligible(s, 10, baseCfg), false);
});

test("rankScore: atrReturn is negative for a faller and positive for a riser", () => {
  const down = flatSeries(250, 100);
  for (let i = 247; i < 250; i++) down[i] = { ...down[i], o: 95, h: 96, l: 94, c: 95 };
  const up = flatSeries(250, 100);
  for (let i = 247; i < 250; i++) up[i] = { ...up[i], o: 105, h: 106, l: 104, c: 105 };

  const downScore = rankScore(buildSeries(down), 249, baseCfg);
  const upScore = rankScore(buildSeries(up), 249, baseCfg);
  assert.ok(downScore !== null && upScore !== null);
  assert.ok(downScore < 0, `expected faller to score negative, got ${downScore}`);
  assert.ok(upScore > 0, `expected riser to score positive, got ${upScore}`);
  assert.ok(downScore < upScore); // lower = better candidate
});

test("rankScore: the rsi2 measure ranks the more oversold symbol lower", () => {
  const cfg: CsConfig = { ...baseCfg, measure: "rsi2" };
  // Rising baseline, not flat — see risingSeries. Each fixture's drop is written
  // relative to the previous close so the numbers do not depend on `step`.
  const mild = risingSeries(250, 100);
  const mPrev = mild[248].c;
  mild[249] = { ...mild[249], o: mPrev, h: mPrev, l: mPrev - 0.9, c: mPrev - 0.9 };

  const severe = risingSeries(250, 100);
  const sPrev = severe[247].c;
  severe[248] = { ...severe[248], o: sPrev, h: sPrev, l: sPrev - 5, c: sPrev - 5 };
  const sPrev2 = severe[248].c;
  severe[249] = { ...severe[249], o: sPrev2, h: sPrev2, l: sPrev2 - 5, c: sPrev2 - 5 };

  const mildScore = rankScore(buildSeries(mild), 249, cfg);
  const severeScore = rankScore(buildSeries(severe), 249, cfg);
  assert.ok(mildScore !== null && severeScore !== null);
  assert.ok(severeScore < mildScore, `expected ${severeScore} < ${mildScore}`);
});

test("rankScore returns null before the lookback window is available", () => {
  assert.equal(rankScore(buildSeries(flatSeries(250, 100)), 1, baseCfg), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test src/lib/backtest/crossSectional/signals.test.ts`
Expected: FAIL — cannot find module `./signals`.

- [ ] **Step 3: Write the signals module**

Create `src/lib/backtest/crossSectional/signals.ts`:

```ts
// Per-symbol series and the two decisions the ranker needs: is this symbol
// eligible today, and how far has it fallen. Everything reads bar indices <= i,
// which is what makes the whole backtest causal.
import { sma, rsi, atr, type Candle } from "@/lib/indicators";
import type { CsConfig } from "./types";

const VOL_WINDOW = 20;
const MOVE_WINDOW = 20;
/** SMA200 is the longest input, so nothing is trustworthy before this index. */
const WARMUP = 200;

export interface SymbolSeries {
  candles: Candle[];
  atr: (number | null)[];
  sma200: (number | null)[];
  sma5: (number | null)[];
  rsi2: (number | null)[];
  /** Trailing 20-bar average of close * volume. */
  dollarVol20: (number | null)[];
  /** Largest absolute close-to-close % move in the trailing 20 bars. */
  maxMovePct20: (number | null)[];
}

export function buildSeries(candles: Candle[]): SymbolSeries {
  const closes = candles.map((c) => c.c);

  const dollarVol20: (number | null)[] = candles.map((_, i) => {
    if (i < VOL_WINDOW - 1) return null;
    let sum = 0;
    for (let j = i - VOL_WINDOW + 1; j <= i; j++) sum += candles[j].c * candles[j].v;
    return sum / VOL_WINDOW;
  });

  const maxMovePct20: (number | null)[] = candles.map((_, i) => {
    if (i < MOVE_WINDOW) return null;
    let worst = 0;
    for (let j = i - MOVE_WINDOW + 1; j <= i; j++) {
      const prev = candles[j - 1].c;
      if (prev <= 0) continue;
      worst = Math.max(worst, Math.abs((candles[j].c - prev) / prev) * 100);
    }
    return worst;
  });

  return {
    candles,
    atr: atr(candles, 14),
    sma200: sma(closes, 200),
    sma5: sma(closes, 5),
    rsi2: rsi(closes, 2),
    dollarVol20,
    maxMovePct20,
  };
}

/** Point-in-time tradability check for bar `i`. Every input reads index <= i. */
export function isEligible(s: SymbolSeries, i: number, cfg: CsConfig): boolean {
  if (i < WARMUP) return false;

  const bar = s.candles[i];
  if (bar.c < cfg.minPrice) return false;

  const dv = s.dollarVol20[i];
  if (dv == null || dv < cfg.minDollarVol) return false;

  if (cfg.requireAboveSma200) {
    const s200 = s.sma200[i];
    if (s200 == null || bar.c <= s200) return false;
  }

  if (cfg.maxSingleDayMovePct != null) {
    const move = s.maxMovePct20[i];
    if (move == null || move > cfg.maxSingleDayMovePct) return false;
  }

  return true;
}

/**
 * How oversold the symbol is at bar `i`. **Lower is a better candidate.**
 * - atrReturn: the K-bar price change divided by ATR, so a $400 stock and a $20
 *   stock are on the same scale.
 * - rsi2: the 2-period RSI itself, which is already low when oversold.
 * Returns null when the inputs are unavailable at this index.
 */
export function rankScore(s: SymbolSeries, i: number, cfg: CsConfig): number | null {
  if (cfg.measure === "rsi2") return s.rsi2[i];

  const back = i - cfg.lookback;
  if (back < 0) return null;
  const a = s.atr[i];
  if (a == null || a <= 0) return null;
  return (s.candles[i].c - s.candles[back].c) / a;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test src/lib/backtest/crossSectional/signals.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/backtest/crossSectional/signals.ts src/lib/backtest/crossSectional/signals.test.ts
git commit -m "feat(quant): point-in-time eligibility filter + oversold ranking score"
```

---

### Task 4: Equity-curve metrics

**Files:**
- Create: `src/lib/backtest/crossSectional/summary.ts`
- Test: `src/lib/backtest/crossSectional/summary.test.ts`

**Interfaces:**
- Consumes: `CsTrade`, `EquityPoint`, `CsSummary` from `./types`.
- Produces: `summarizeCrossSectional(trades, equityCurve, capital)` returning `CsSummary`. Task 5's engine calls it; Task 6 and 7 read its fields.

Written before the engine so the engine has a finished summariser to call.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/backtest/crossSectional/summary.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeCrossSectional } from "./summary";
import type { CsTrade, EquityPoint } from "./types";

const DAY = 86_400;

function trade(pnl: number, r: number | null = null): CsTrade {
  return {
    symbol: "AAA", entryT: DAY, exitT: 5 * DAY, entry: 100, exit: 100 + pnl,
    shares: 1, grossPnl: pnl, pnl, retPct: pnl, rMultiple: r,
    reason: "hold-expiry", daysHeld: 4,
  };
}

function curve(values: number[], positionsPerDay: number[]): EquityPoint[] {
  return values.map((equity, i) => ({ t: (i + 1) * DAY, equity, positions: positionsPerDay[i] }));
}

test("counts wins and computes win rate", () => {
  const s = summarizeCrossSectional([trade(10), trade(-5), trade(20)], curve([100, 100, 100], [0, 0, 0]), 100);
  assert.equal(s.trades, 3);
  assert.equal(s.wins, 2);
  assert.ok(Math.abs(s.winRate - 66.6667) < 0.01);
});

test("profit factor is gross win over gross loss, and null with no losers", () => {
  assert.equal(summarizeCrossSectional([trade(10), trade(-5)], curve([100], [0]), 100).profitFactor, 2);
  assert.equal(summarizeCrossSectional([trade(10)], curve([100], [0]), 100).profitFactor, null);
});

test("avgR is null when no trade carries an R-multiple", () => {
  assert.equal(summarizeCrossSectional([trade(10), trade(-5)], curve([100], [0]), 100).avgR, null);
  assert.equal(summarizeCrossSectional([trade(10, 2), trade(-5, -1)], curve([100], [0]), 100).avgR, 0.5);
});

test("max drawdown is the largest peak-to-trough as a positive percentage", () => {
  // 100 -> 120 -> 90: trough is 25% below the 120 peak.
  const s = summarizeCrossSectional([], curve([100, 120, 90, 110], [0, 0, 0, 0]), 100);
  assert.ok(s.maxDrawdownPct !== null);
  assert.ok(Math.abs(s.maxDrawdownPct - 25) < 0.01);
});

test("max drawdown is 0 on a monotonically rising curve", () => {
  const s = summarizeCrossSectional([], curve([100, 110, 120], [0, 0, 0]), 100);
  assert.equal(s.maxDrawdownPct, 0);
});

test("time in market counts days with at least one open position", () => {
  const s = summarizeCrossSectional([], curve([100, 100, 100, 100], [0, 2, 1, 0]), 100);
  assert.equal(s.timeInMarketPct, 50);
  assert.equal(s.tradingDays, 4);
});

test("CAGR annualises the equity change over the curve's span", () => {
  // 100 -> 200 across roughly one year of trading days.
  const days = 252;
  const values = Array.from({ length: days }, (_, i) => 100 + (100 * i) / (days - 1));
  const s = summarizeCrossSectional([], curve(values, new Array(days).fill(1)), 100);
  assert.ok(s.cagrPct !== null);
  assert.ok(Math.abs(s.cagrPct - 100) < 5, `expected ~100%, got ${s.cagrPct}`);
});

test("an empty curve yields null CAGR and null drawdown rather than NaN", () => {
  const s = summarizeCrossSectional([], [], 100);
  assert.equal(s.cagrPct, null);
  assert.equal(s.maxDrawdownPct, null);
  assert.equal(s.timeInMarketPct, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test src/lib/backtest/crossSectional/summary.test.ts`
Expected: FAIL — cannot find module `./summary`.

- [ ] **Step 3: Write the summary module**

Create `src/lib/backtest/crossSectional/summary.ts`:

```ts
// Headline metrics for a cross-sectional run. Unlike the single-symbol engine's
// summary, these are computed from a real daily equity curve, which is what
// makes max drawdown, CAGR, and time-in-market meaningful. Time-in-market is
// reported because a regime filter that sits flat most of the year changes what
// the strategy is, and a profit factor alone hides that.
import type { CsSummary, CsTrade, EquityPoint } from "./types";

const TRADING_DAYS_PER_YEAR = 252;

export function summarizeCrossSectional(
  trades: CsTrade[],
  equityCurve: EquityPoint[],
  capital: number,
): CsSummary {
  const n = trades.length;
  const wins = trades.filter((t) => t.pnl > 0).length;
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);

  const grossWin = trades.reduce((s, t) => s + Math.max(t.pnl, 0), 0);
  const grossLoss = trades.reduce((s, t) => s + Math.max(-t.pnl, 0), 0);

  const rs = trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
  const rets = trades.map((t) => t.retPct);

  let maxDrawdownPct: number | null = null;
  let cagrPct: number | null = null;
  if (equityCurve.length) {
    let peak = equityCurve[0].equity;
    let worst = 0;
    for (const p of equityCurve) {
      if (p.equity > peak) peak = p.equity;
      if (peak > 0) worst = Math.max(worst, ((peak - p.equity) / peak) * 100);
    }
    maxDrawdownPct = worst;

    const finalEquity = equityCurve[equityCurve.length - 1].equity;
    const years = equityCurve.length / TRADING_DAYS_PER_YEAR;
    if (years > 0 && capital > 0 && finalEquity > 0) {
      cagrPct = (Math.pow(finalEquity / capital, 1 / years) - 1) * 100;
    }
  }

  const daysInMarket = equityCurve.filter((p) => p.positions > 0).length;

  return {
    trades: n,
    wins,
    winRate: n ? (wins / n) * 100 : 0,
    totalPnl,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    avgR: rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : null,
    avgRetPct: rets.length ? rets.reduce((s, r) => s + r, 0) / rets.length : null,
    cagrPct,
    maxDrawdownPct,
    timeInMarketPct: equityCurve.length ? (daysInMarket / equityCurve.length) * 100 : 0,
    tradingDays: equityCurve.length,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test src/lib/backtest/crossSectional/summary.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/backtest/crossSectional/summary.ts src/lib/backtest/crossSectional/summary.test.ts
git commit -m "feat(quant): equity-curve metrics for cross-sectional runs"
```

---

### Task 5: The day-by-day portfolio loop

The core of the plan. Everything above exists to serve this.

**Files:**
- Create: `src/lib/backtest/crossSectional/engine.ts`
- Test: `src/lib/backtest/crossSectional/engine.test.ts`

**Interfaces:**
- Consumes: `alignUniverse`, `dayKey` from `./calendar`; `buildSeries`, `isEligible`, `rankScore`, `SymbolSeries` from `./signals`; `summarizeCrossSectional` from `./summary`; every type from `./types`.
- Produces: `crossSectionalBacktest(bars, cfg): CsResult`. The single public entry point; Tasks 6 and 7 call only this.

**Execution rules this task must implement exactly:**

1. Signals are computed from the bar at day t. New entries fill at the **open of day t+1**.
2. Scheduled exits (hold expiry, SMA5 recross) are decided at a close and fill at the **next open**.
3. Stops are intraday: if the day's low touches the stop, the fill is the stop price — unless the day opened below the stop, in which case the fill is the open (an honest gap).
4. Costs: entry fills are worsened by `slippageBps`, exit fills likewise; `commissionBps` is charged once per closed trade against entry notional.
5. When more candidates qualify than there are free slots, take them strictly in ascending rank order. Ties break by symbol name, so the result is deterministic.
6. Position size at entry is `equity / slots`, allowing fractional shares. Equity compounds.
7. A symbol already held is never entered again while the position is open.
8. Any position still open on the final day is closed at that day's close with reason `end-of-data`.
9. The regime symbol is never traded.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/backtest/crossSectional/engine.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { crossSectionalBacktest } from "./engine";
import type { CsConfig } from "./types";
import type { Candle } from "@/lib/indicators";

const DAY = 86_400;

/** Build a series from an explicit close path; O/H/L are derived from the close. */
function series(closes: number[], volume = 5_000_000): Candle[] {
  return closes.map((c, i) => ({
    t: (i + 1) * DAY, o: c, h: c * 1.01, l: c * 0.99, c, v: volume,
  }));
}

/** A rising baseline long enough to clear the 200-bar warm-up. */
function risingBase(n: number, start = 100): number[] {
  return Array.from({ length: n }, (_, i) => start + i * 0.1);
}

// Filters off, maxRankScore at 0: on a rising baseline nothing qualifies, so
// each fixture's single engineered dip produces exactly one trade to assert on.
const cfg: CsConfig = {
  lookback: 3, measure: "atrReturn", maxRankScore: 0,
  minPrice: 5, minDollarVol: 1_000_000,
  requireAboveSma200: false, regime: "off", maxSingleDayMovePct: null,
  slots: 1, holdDays: 3, exitOnSma5: false, stopAtrMult: null,
  costs: {}, capital: 10_000, regimeSymbol: "SPY",
};

test("a symbol that dips is bought at the NEXT day's open, not the signal close", () => {
  const closes = risingBase(260);
  closes[254] = closes[254] - 8; // the dip; signal fires on this bar
  const bars = new Map<string, Candle[]>([["AAA", series(closes)]]);

  const res = crossSectionalBacktest(bars, cfg);
  assert.equal(res.trades.length, 1);
  // Entry fills on bar 255 (the day after the dip), at its open.
  assert.equal(res.trades[0].entryT, 256 * DAY);
  assert.equal(res.trades[0].entry, series(closes)[255].o);
});

test("future bars cannot change the result (no lookahead)", () => {
  const closes = risingBase(260);
  closes[254] = closes[254] - 8;
  const baseline = crossSectionalBacktest(new Map([["AAA", series(closes)]]), cfg);

  // Same history, then a wildly favourable future appended. Trades that were
  // already decided must be byte-identical; only later trades may differ.
  const withFuture = [...closes, ...Array.from({ length: 20 }, (_, i) => 500 + i)];
  const extended = crossSectionalBacktest(new Map([["AAA", series(withFuture)]]), cfg);

  const first = baseline.trades[0];
  const firstExtended = extended.trades[0];
  assert.deepEqual(
    { t: first.entryT, e: first.entry, x: first.exitT },
    { t: firstExtended.entryT, e: firstExtended.entry, x: firstExtended.exitT },
  );
});

test("a position closes after holdDays and reports hold-expiry", () => {
  const closes = risingBase(260);
  closes[254] = closes[254] - 8;
  const res = crossSectionalBacktest(new Map([["AAA", series(closes)]]), cfg);
  assert.equal(res.trades[0].reason, "hold-expiry");
  assert.equal(res.trades[0].daysHeld, 3);
});

test("slots cap concurrent positions and selection follows rank order", () => {
  // Two symbols dip on the same day; BBB falls harder, so with one slot BBB wins.
  const aCloses = risingBase(260);
  aCloses[254] = aCloses[254] - 4;
  const bCloses = risingBase(260);
  bCloses[254] = bCloses[254] - 12;

  const bars = new Map<string, Candle[]>([["AAA", series(aCloses)], ["BBB", series(bCloses)]]);
  const res = crossSectionalBacktest(bars, cfg);

  assert.equal(res.trades.filter((t) => t.entryT === 256 * DAY).length, 1);
  assert.equal(res.trades[0].symbol, "BBB");
});

test("the regime symbol is never traded", () => {
  const closes = risingBase(260);
  closes[254] = closes[254] - 8;
  const bars = new Map<string, Candle[]>([["SPY", series(closes)]]);
  const res = crossSectionalBacktest(bars, cfg);
  assert.equal(res.trades.length, 0);
});

test("regime spySma200 blocks new entries while SPY is below its SMA200", () => {
  const closes = risingBase(260);
  closes[254] = closes[254] - 8;

  // SPY falls steadily, so it sits under its own SMA200 throughout the signal window.
  const spyCloses = Array.from({ length: 260 }, (_, i) => 300 - i * 0.5);

  const bars = new Map<string, Candle[]>([["AAA", series(closes)], ["SPY", series(spyCloses)]]);
  const blocked = crossSectionalBacktest(bars, { ...cfg, regime: "spySma200" });
  const allowed = crossSectionalBacktest(bars, { ...cfg, regime: "off" });

  assert.equal(blocked.trades.length, 0);
  assert.ok(allowed.trades.length > 0);
});

test("a stop closes the position and reports a loss", () => {
  const closes = risingBase(260);
  closes[254] = closes[254] - 8; // the dip that triggers entry at 255's open
  // Then keep collapsing, so the stop is well clear of the entry-day ATR.
  closes[256] = 80;
  closes[257] = 60;
  closes[258] = 55;
  closes[259] = 50;
  const bars = new Map<string, Candle[]>([["AAA", series(closes)]]);

  const res = crossSectionalBacktest(bars, { ...cfg, stopAtrMult: 2 });
  // Do not assert a trade *count*: the bar that trips the stop is itself a large
  // decline, so the engine correctly re-enters afterwards. What this test pins is
  // the stopped trade, and that the stop is what produced it.
  const stopped = res.trades.find((t) => t.reason === "stop");
  assert.ok(stopped, `expected a stop exit, reasons were: ${res.trades.map((t) => t.reason).join(", ")}`);
  assert.equal(res.trades[0], stopped); // the stop is the first exit taken
  assert.ok(stopped.pnl < 0);
  assert.ok(stopped.rMultiple !== null);
  // holdDays is 3, so a hold-expiry exit would not have fired by bar 256.
  assert.ok(stopped.daysHeld < cfg.holdDays);

  // Control: the collapse alone does not produce a stop. Without stopAtrMult the
  // same bars exit on the hold clock, which is what makes the case above causal.
  const noStop = crossSectionalBacktest(bars, cfg);
  assert.ok(!noStop.trades.some((t) => t.reason === "stop"));
});

test("rMultiple is null when the config has no stop", () => {
  const closes = risingBase(260);
  closes[254] = closes[254] - 8;
  const res = crossSectionalBacktest(new Map([["AAA", series(closes)]]), cfg);
  assert.equal(res.trades[0].rMultiple, null);
});

test("costs make an otherwise flat round trip lose money", () => {
  const closes = risingBase(260);
  closes[254] = closes[254] - 8;
  const bars = new Map<string, Candle[]>([["AAA", series(closes)]]);

  const free = crossSectionalBacktest(bars, cfg);
  const costed = crossSectionalBacktest(bars, { ...cfg, costs: { slippageBps: 0.5, commissionBps: 1 } });
  assert.ok(costed.trades[0].pnl < free.trades[0].pnl);
  assert.ok(costed.trades[0].grossPnl !== costed.trades[0].pnl);
});

test("the equity curve covers every trading day and tracks open positions", () => {
  const closes = risingBase(260);
  closes[254] = closes[254] - 8;
  const res = crossSectionalBacktest(new Map([["AAA", series(closes)]]), cfg);

  assert.equal(res.equityCurve.length, 260);
  assert.ok(res.equityCurve.some((p) => p.positions === 1));
  assert.equal(res.summary.tradingDays, 260);
  assert.ok(res.summary.timeInMarketPct > 0);
});

test("a position still open on the final bar is closed as end-of-data", () => {
  const closes = risingBase(260);
  closes[258] = closes[258] - 8; // dips so late that holdDays cannot elapse
  const res = crossSectionalBacktest(new Map([["AAA", series(closes)]]), cfg);
  assert.equal(res.trades.length, 1);
  assert.equal(res.trades[0].reason, "end-of-data");
});

test("an empty universe returns an empty result rather than throwing", () => {
  const res = crossSectionalBacktest(new Map(), cfg);
  assert.equal(res.trades.length, 0);
  assert.equal(res.equityCurve.length, 0);
  assert.equal(res.summary.trades, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test src/lib/backtest/crossSectional/engine.test.ts`
Expected: FAIL — cannot find module `./engine`.

- [ ] **Step 3: Write the engine**

Create `src/lib/backtest/crossSectional/engine.ts`:

```ts
// The cross-sectional portfolio loop. Walks a shared trading-day calendar, ranks
// every eligible symbol each day, and holds the top N. This is the piece the
// single-symbol engine (backtest/engine.ts) cannot express: it holds one position
// at a time and has no notion of choosing between symbols.
//
// Fidelity rules, all deliberate:
// - Signals read bar t; entries fill at the open of t+1. Entering at the signal
//   close would be lookahead and would inflate every result.
// - Scheduled exits are decided at a close and fill at the next open.
// - Stops are intraday. A gap through the stop fills at the open, not the stop.
// - When candidates outnumber free slots, selection is strictly by rank, ties
//   broken by symbol, so runs are reproducible.
import type { Candle } from "@/lib/indicators";
import { alignUniverse } from "./calendar";
import { buildSeries, isEligible, rankScore, type SymbolSeries } from "./signals";
import { summarizeCrossSectional } from "./summary";
import type { CsConfig, CsResult, CsTrade, EquityPoint, ExitReason } from "./types";

const SPY_SMA_SLOPE_LOOKBACK = 10;

interface OpenPos {
  symbol: string;
  entryT: number;
  entryPrice: number; // cost-adjusted
  rawEntry: number; // pre-cost, for notional/commission
  shares: number;
  allocated: number;
  stop: number | null;
  riskPerShare: number | null;
  barsHeld: number;
  exitQueued: ExitReason | null; // decided at a close, filled at the next open
}

const bps = (v: number | undefined) => (v ?? 0) / 10_000;

/** Is the market-wide switch on for opening positions on day `key`? */
function regimeOpen(cfg: CsConfig, spy: SymbolSeries | undefined, spyIdx: number | undefined): boolean {
  if (cfg.regime === "off") return true;
  if (!spy || spyIdx == null) return false; // no regime data = stay flat, the safe default

  if (cfg.regime === "spySma200") {
    const s200 = spy.sma200[spyIdx];
    return s200 != null && spy.candles[spyIdx].c > s200;
  }

  // spySlope: SPY's own SMA200 must be rising over the last 10 bars. This mirrors
  // the higher-timeframe alignment that proved to be the real lever on gold.
  const now = spy.sma200[spyIdx];
  const then = spy.sma200[spyIdx - SPY_SMA_SLOPE_LOOKBACK];
  return now != null && then != null && now > then;
}

export function crossSectionalBacktest(bars: Map<string, Candle[]>, cfg: CsConfig): CsResult {
  const aligned = alignUniverse(bars);
  const seriesBySymbol = new Map<string, SymbolSeries>();
  for (const [symbol, candles] of bars) seriesBySymbol.set(symbol, buildSeries(candles));

  const spy = seriesBySymbol.get(cfg.regimeSymbol);
  const tradable = [...bars.keys()].filter((s) => s !== cfg.regimeSymbol).sort();

  const trades: CsTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  const open = new Map<string, OpenPos>();
  let cash = cfg.capital;
  let pending: string[] = []; // symbols queued yesterday, to fill at today's open

  const slipIn = 1 + bps(cfg.costs.slippageBps);
  const slipOut = 1 - bps(cfg.costs.slippageBps);
  const commission = bps(cfg.costs.commissionBps);

  const idxOf = (symbol: string, day: number) => aligned.index.get(symbol)?.get(day);

  /** Cash plus every open position valued at today's close. */
  const markToMarket = (day: number) => {
    let total = cash;
    for (const pos of open.values()) {
      const i = idxOf(pos.symbol, day);
      total += i == null ? pos.allocated : seriesBySymbol.get(pos.symbol)!.candles[i].c * pos.shares;
    }
    return total;
  };

  const closeTrade = (pos: OpenPos, day: number, price: number, reason: ExitReason) => {
    const exitPrice = price * slipOut;
    const gross = (price - pos.rawEntry) * pos.shares;
    const commissionUsd = pos.rawEntry * pos.shares * commission;
    const net = (exitPrice - pos.entryPrice) * pos.shares - commissionUsd;
    cash += pos.allocated + net;
    trades.push({
      symbol: pos.symbol,
      entryT: pos.entryT,
      exitT: day * 86_400,
      entry: pos.entryPrice,
      exit: exitPrice,
      shares: pos.shares,
      grossPnl: gross,
      pnl: net,
      retPct: pos.allocated > 0 ? (net / pos.allocated) * 100 : 0,
      rMultiple: pos.riskPerShare && pos.riskPerShare > 0 ? net / (pos.riskPerShare * pos.shares) : null,
      reason,
      daysHeld: pos.barsHeld,
    });
    open.delete(pos.symbol);
  };

  for (let d = 0; d < aligned.days.length; d++) {
    const day = aligned.days[d];
    const isLastDay = d === aligned.days.length - 1;

    // --- 1. Fill exits queued at yesterday's close, at today's open ---
    for (const pos of [...open.values()]) {
      if (!pos.exitQueued) continue;
      const i = idxOf(pos.symbol, day);
      if (i == null) continue; // no bar today (halt); try again tomorrow
      closeTrade(pos, day, seriesBySymbol.get(pos.symbol)!.candles[i].o, pos.exitQueued);
    }

    // --- 2. Fill entries queued at yesterday's close, at today's open ---
    // Size off total equity, not cash. Sizing off cash would shrink each
    // successive allocation geometrically as the book fills up, so the fifth
    // slot would get a fraction of the first — silently un-equal weighting.
    const equityForSizing = markToMarket(day);
    for (const symbol of pending) {
      if (open.size >= cfg.slots || open.has(symbol)) continue;
      const s = seriesBySymbol.get(symbol);
      const i = idxOf(symbol, day);
      if (!s || i == null) continue;

      const allocated = equityForSizing / cfg.slots;
      if (allocated <= 0 || allocated > cash) continue; // never allocate cash we don't hold

      const raw = s.candles[i].o;
      const fill = raw * slipIn;
      if (fill <= 0) continue;

      const a = s.atr[i];
      const riskPerShare = cfg.stopAtrMult != null && a != null ? cfg.stopAtrMult * a : null;

      const shares = allocated / fill;
      cash -= allocated;
      open.set(symbol, {
        symbol,
        entryT: day * 86_400,
        entryPrice: fill,
        rawEntry: raw,
        shares,
        allocated,
        stop: riskPerShare != null ? fill - riskPerShare : null,
        riskPerShare,
        barsHeld: 0,
        exitQueued: null,
      });
    }
    pending = [];

    // --- 3. Intraday stops on positions held through today ---
    for (const pos of [...open.values()]) {
      if (pos.stop == null) continue;
      const s = seriesBySymbol.get(pos.symbol)!;
      const i = idxOf(pos.symbol, day);
      if (i == null) continue;
      const bar = s.candles[i];
      if (bar.l <= pos.stop) {
        // A gap through the stop fills at the open — an honest bad fill.
        closeTrade(pos, day, Math.min(bar.o, pos.stop), "stop");
      }
    }

    // --- 4. Age positions and queue scheduled exits at today's close ---
    for (const pos of open.values()) {
      const s = seriesBySymbol.get(pos.symbol)!;
      const i = idxOf(pos.symbol, day);
      if (i == null) continue;
      pos.barsHeld += 1;

      if (pos.barsHeld >= cfg.holdDays) {
        pos.exitQueued = "hold-expiry";
        continue;
      }
      if (cfg.exitOnSma5) {
        const s5 = s.sma5[i];
        if (s5 != null && s.candles[i].c > s5) pos.exitQueued = "sma5";
      }
    }

    // --- 5. Rank today's eligible set and queue tomorrow's entries ---
    const freeSlots = cfg.slots - open.size;
    if (!isLastDay && freeSlots > 0 && regimeOpen(cfg, spy, spy ? idxOf(cfg.regimeSymbol, day) : undefined)) {
      const candidates: { symbol: string; score: number }[] = [];
      for (const symbol of tradable) {
        if (open.has(symbol)) continue;
        const s = seriesBySymbol.get(symbol)!;
        const i = idxOf(symbol, day);
        if (i == null || !isEligible(s, i, cfg)) continue;
        const score = rankScore(s, i, cfg);
        if (score == null) continue;
        // Rank order alone would buy the least-rising stock on a day when
        // nothing fell. Require a real decline before anything is a candidate.
        if (cfg.maxRankScore != null && score > cfg.maxRankScore) continue;
        candidates.push({ symbol, score });
      }
      candidates.sort((a, b) => (a.score === b.score ? a.symbol.localeCompare(b.symbol) : a.score - b.score));
      pending = candidates.slice(0, freeSlots).map((c) => c.symbol);
    }

    // --- 6. Mark to market ---
    equityCurve.push({ t: day * 86_400, equity: markToMarket(day), positions: open.size });

    // --- 7. Force-close anything still open on the final day ---
    if (isLastDay) {
      for (const pos of [...open.values()]) {
        const s = seriesBySymbol.get(pos.symbol)!;
        const i = idxOf(pos.symbol, day);
        if (i == null) continue;
        closeTrade(pos, day, s.candles[i].c, "end-of-data");
      }
    }
  }

  return { trades, equityCurve, summary: summarizeCrossSectional(trades, equityCurve, cfg.capital) };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx tsx --test src/lib/backtest/crossSectional/engine.test.ts`
Expected: PASS, 12 tests.

If the entry-timing or rank-order tests fail, fix the engine — not the test. Those two encode the rules the whole result depends on.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test`
Expected: PASS, including all pre-existing tests.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/backtest/crossSectional/engine.ts src/lib/backtest/crossSectional/engine.test.ts
git commit -m "feat(quant): cross-sectional portfolio backtester (day loop, rank, slots, stops)"
```

---

### Task 6: Parameter sweep with a chronological train/test split

**Files:**
- Create: `scripts/sweep-cross-sectional.mts`

**Interfaces:**
- Consumes: the cache written by Task 1 at `.cache/bars/<universe>-1d.json`; `crossSectionalBacktest` and the `CsConfig` type; `DEFAULT_COST_MODEL` from `@/lib/backtest/engine` (a script, so the runtime import is fine — it loads dotenv).
- Produces: console output only. Task 7 reads the chosen configs from that output.

- [ ] **Step 1: Write the sweep script**

Create `scripts/sweep-cross-sectional.mts`:

```ts
// Sweeps the cross-sectional grid on a chronological 65/35 train/test split and
// prints, for every combo that clears the train bar, its untouched TEST metrics
// beside its train ones. Same protocol as scripts/sweep-*.mts on gold.
//
// Usage: node --env-file=.env --import tsx scripts/sweep-cross-sectional.mts [universe]
import { readFile } from "node:fs/promises";
import { crossSectionalBacktest } from "@/lib/backtest/crossSectional/engine";
import { summarizeCrossSectional } from "@/lib/backtest/crossSectional/summary";
import type { CsConfig, CsSummary, FallMeasure, RegimeMode } from "@/lib/backtest/crossSectional/types";
import { DEFAULT_COST_MODEL } from "@/lib/backtest/engine";
import type { Candle } from "@/lib/indicators";

const universeKey = process.argv[2] ?? "sp500";
const TRAIN_FRACTION = 0.65;

const raw = JSON.parse(await readFile(`.cache/bars/${universeKey}-1d.json`, "utf8")) as {
  fetchedAt: string;
  bars: Record<string, Candle[]>;
};
console.log(`loaded ${Object.keys(raw.bars).length} symbols from cache (fetched ${raw.fetchedAt})`);

// Split on a shared date, not per-symbol bar counts, so every symbol's train and
// test windows cover the same calendar period.
const uniqueTimes = [...new Set(Object.values(raw.bars).flatMap((b) => b.map((c) => c.t)))].sort((a, b) => a - b);
const cutoff = uniqueTimes[Math.floor(uniqueTimes.length * TRAIN_FRACTION)];
console.log(`split at ${new Date(cutoff * 1000).toISOString().slice(0, 10)}`);

// `isEligible` refuses every index below 200 (the SMA200 warm-up), so handing the
// engine a bare slice would kill the first 200 trading days of EVERY window — the
// test half would lose ~200 of its ~530 days, and gate 1 would fail for reasons
// that have nothing to do with the edge. Each window therefore carries a warm-up
// prefix taken from before its start. Exactly 200 bars, not more: at that length
// the prefix is entirely ineligible, so it warms the indicators without
// generating a single trade of its own.
const WARMUP_BARS = 200;

/** Bars from `fromT` (inclusive) to `toT` (exclusive), preceded by the warm-up prefix. */
function window(fromT: number | null, toT: number | null): Map<string, Candle[]> {
  const out = new Map<string, Candle[]>();
  for (const [sym, candles] of Object.entries(raw.bars)) {
    let start = 0;
    if (fromT != null) {
      const at = candles.findIndex((c) => c.t >= fromT);
      if (at === -1) continue; // symbol stopped trading before this window opens
      start = Math.max(0, at - WARMUP_BARS);
    }
    const endAt = toT == null ? -1 : candles.findIndex((c) => c.t >= toT);
    const part = candles.slice(start, endAt === -1 ? candles.length : endAt);
    if (part.length) out.set(sym, part);
  }
  return out;
}

/**
 * Run one window and summarise only the part inside it: trades entered during the
 * warm-up prefix and equity points before `windowStart` are dropped, so drawdown,
 * CAGR and time-in-market describe the window itself rather than the prefix.
 */
function runWindow(bars: Map<string, Candle[]>, cfg: CsConfig, windowStart: number): CsSummary {
  const res = crossSectionalBacktest(bars, cfg);
  const trades = res.trades.filter((t) => t.entryT >= windowStart);
  const curve = res.equityCurve.filter((p) => p.t >= windowStart);
  if (!curve.length) return summarizeCrossSectional(trades, [], cfg.capital);
  // Rebase to the window's own opening equity so a drawdown is measured against
  // the capital the window actually started with.
  const base = curve[0].equity;
  const scale = base > 0 ? cfg.capital / base : 1;
  return summarizeCrossSectional(trades, curve.map((p) => ({ ...p, equity: p.equity * scale })), cfg.capital);
}

// The train window has no pre-history to borrow, so its own first WARMUP_BARS days
// are genuinely untradable — nobody can trade before their indicators exist.
const trainBars = window(null, cutoff);
const trainStart = uniqueTimes[WARMUP_BARS];
const testBars = window(cutoff, null);
console.log(
  `train from ${new Date(trainStart * 1000).toISOString().slice(0, 10)}, test from cutoff` +
  ` (each window warmed by ${WARMUP_BARS} prior bars)`,
);

const BASE: CsConfig = {
  lookback: 3, measure: "atrReturn", maxRankScore: 0,
  minPrice: 5, minDollarVol: 10_000_000,
  requireAboveSma200: true, regime: "spySma200", maxSingleDayMovePct: 15,
  slots: 5, holdDays: 5, exitOnSma5: false, stopAtrMult: null,
  costs: DEFAULT_COST_MODEL, capital: 10_000, regimeSymbol: "SPY",
};

const GRID = {
  measure: ["atrReturn", "rsi2"] as FallMeasure[],
  lookback: [2, 3, 5],
  requireAboveSma200: [true, false],
  regime: ["off", "spySma200", "spySlope"] as RegimeMode[],
  slots: [3, 5, 10],
  holdDays: [3, 5, 10],
  stopAtrMult: [null, 2, 3],
};

const combos: CsConfig[] = [];
for (const measure of GRID.measure)
  for (const lookback of GRID.lookback)
    for (const requireAboveSma200 of GRID.requireAboveSma200)
      for (const regime of GRID.regime)
        for (const slots of GRID.slots)
          for (const holdDays of GRID.holdDays)
            for (const stopAtrMult of GRID.stopAtrMult) {
              // lookback is meaningless for rsi2; keep one representative to avoid duplicates.
              if (measure === "rsi2" && lookback !== GRID.lookback[0]) continue;
              // The two measures live on different scales: atrReturn is negative
              // when a stock has fallen, RSI(2) is a 0-100 level. A single
              // threshold would silently admit everything under one and nothing
              // under the other.
              const maxRankScore = measure === "rsi2" ? 10 : 0;
              combos.push({ ...BASE, measure, maxRankScore, lookback, requireAboveSma200, regime, slots, holdDays, stopAtrMult });
            }

console.log(`sweeping ${combos.length} combos ...\n`);

const label = (c: CsConfig) =>
  `${c.measure}${c.measure === "atrReturn" ? `/k=${c.lookback}` : ""} sma200=${c.requireAboveSma200 ? "y" : "n"} regime=${c.regime} slots=${c.slots} hold=${c.holdDays} stop=${c.stopAtrMult ?? "off"}`;

const rows: { label: string; train: CsSummary; test: CsSummary }[] = [];
for (const combo of combos) {
  const train = runWindow(trainBars, combo, trainStart);
  // Train bar: a real edge must be clearly profitable in-sample AND have enough
  // trades to mean anything. 500 is gate 1 from the spec.
  if (train.trades < 500 || (train.profitFactor ?? 0) < 1.1) continue;
  const test = runWindow(testBars, combo, cutoff);
  rows.push({ label: label(combo), train, test });
}

rows.sort((a, b) => (b.test.profitFactor ?? 0) - (a.test.profitFactor ?? 0));

console.log(`${rows.length}/${combos.length} combos passed the train bar\n`);
console.log("params".padEnd(62), "trainPF  testPF  testTrades  testRet%  testDD%  inMkt%");
for (const r of rows) {
  console.log(
    r.label.padEnd(62),
    (r.train.profitFactor ?? 0).toFixed(2).padStart(7),
    (r.test.profitFactor ?? 0).toFixed(2).padStart(7),
    String(r.test.trades).padStart(11),
    (r.test.avgRetPct ?? 0).toFixed(3).padStart(9),
    (r.test.maxDrawdownPct ?? 0).toFixed(1).padStart(8),
    r.test.timeInMarketPct.toFixed(0).padStart(7),
  );
}

// Failure-mode diagnostic, same as the gold sweeps: distinguish "no combo made
// enough trades" from "plenty of trades, no edge".
if (!rows.length) {
  const sample = runWindow(trainBars, BASE, trainStart);
  console.log(`\nno combo passed. baseline train: ${sample.trades} trades over ${sample.tradingDays} days, PF ${(sample.profitFactor ?? 0).toFixed(2)}`);
  console.log(sample.trades < 500 ? "→ TRADE STARVATION: loosen filters or shorten holdDays" : "→ NO EDGE: the mechanism does not work here");
}
```

- [ ] **Step 2: Run the sweep on Dow 30 first**

Run: `node --env-file=.env --import tsx scripts/sweep-cross-sectional.mts dow30`

Expected: a table, or the no-combo diagnostic. Dow 30 is small and fast — use it to confirm the script runs end to end before spending time on 490 symbols.

- [ ] **Step 3: Run the sweep on the full universe**

Run: `node --env-file=.env --import tsx scripts/sweep-cross-sectional.mts sp500`

Expected: the same table over the full universe. Save the top rows — Task 7 needs them.

- [ ] **Step 4: Commit**

```bash
git add scripts/sweep-cross-sectional.mts
git commit -m "feat(quant): cross-sectional train/test parameter sweep"
```

---

### Task 7: Walk-forward, stress tests, and the gate scorecard

**Files:**
- Create: `scripts/walkforward-cross-sectional.mts`
- Create: `docs/quant/2026-08-15-cross-sectional-mean-reversion-results.md`

**Interfaces:**
- Consumes: the cache from Task 1, `crossSectionalBacktest`, and the winning configs from Task 6's output (passed on the command line).
- Produces: a printed scorecard against all seven gates, and a results document recording the verdict.

- [ ] **Step 1: Write the walk-forward script**

Create `scripts/walkforward-cross-sectional.mts`:

```ts
// Scores one config against the spec's acceptance gates: 6-block walk-forward,
// 3x cost stress, universe haircut, and the SPY benchmark. Gates 1-3 and 5-7 are
// mechanical here; gate 4 (parameter plateau) is read off the Task 6 sweep table.
//
// Usage: node --env-file=.env --import tsx scripts/walkforward-cross-sectional.mts \
//          [universe] [measure] [lookback] [regime] [slots] [holdDays] [stop|off] [sma200:y|n]
import { readFile } from "node:fs/promises";
import { crossSectionalBacktest } from "@/lib/backtest/crossSectional/engine";
import { summarizeCrossSectional } from "@/lib/backtest/crossSectional/summary";
import type { CsConfig, CsSummary, FallMeasure, RegimeMode } from "@/lib/backtest/crossSectional/types";
import { DEFAULT_COST_MODEL } from "@/lib/backtest/engine";
import type { Candle } from "@/lib/indicators";

const BLOCKS = 6;

const [, , universeKey = "sp500", measure = "atrReturn", lookback = "3", regime = "spySma200",
  slots = "5", holdDays = "5", stop = "off", sma200 = "y"] = process.argv;

async function loadBars(key: string): Promise<Map<string, Candle[]>> {
  const raw = JSON.parse(await readFile(`.cache/bars/${key}-1d.json`, "utf8")) as { bars: Record<string, Candle[]> };
  return new Map(Object.entries(raw.bars));
}

const cfg: CsConfig = {
  measure: measure as FallMeasure,
  maxRankScore: measure === "rsi2" ? 10 : 0,
  lookback: Number(lookback),
  minPrice: 5, minDollarVol: 10_000_000,
  requireAboveSma200: sma200 === "y",
  regime: regime as RegimeMode,
  maxSingleDayMovePct: 15,
  slots: Number(slots),
  holdDays: Number(holdDays),
  exitOnSma5: false,
  stopAtrMult: stop === "off" ? null : Number(stop),
  costs: DEFAULT_COST_MODEL,
  capital: 10_000,
  regimeSymbol: "SPY",
};

const bars = await loadBars(universeKey);
console.log(`config: ${JSON.stringify({ ...cfg, costs: undefined })}\n`);

// `isEligible` refuses every index below 200 (the SMA200 warm-up), so a bare window
// slice would kill its own first 200 trading days. The blocks below are only ~220
// days long, so bare slicing would leave ~20 usable days each and gates 2-3 would
// fail for reasons that have nothing to do with the edge. Every window therefore
// carries a warm-up prefix of exactly 200 bars: long enough to warm each indicator,
// short enough that the prefix is wholly ineligible and adds no trades of its own.
const WARMUP_BARS = 200;

function windowBars(all: Map<string, Candle[]>, from: number, to: number): Map<string, Candle[]> {
  const out = new Map<string, Candle[]>();
  for (const [sym, candles] of all) {
    const at = candles.findIndex((c) => c.t >= from);
    if (at === -1) continue; // symbol stopped trading before this window opens
    const endAt = candles.findIndex((c) => c.t >= to);
    const part = candles.slice(Math.max(0, at - WARMUP_BARS), endAt === -1 ? candles.length : endAt);
    if (part.length) out.set(sym, part);
  }
  return out;
}

/** Run one window and summarise only the part that falls inside the window itself. */
function runWindow(all: Map<string, Candle[]>, from: number, to: number): CsSummary {
  const res = crossSectionalBacktest(windowBars(all, from, to), cfg);
  const trades = res.trades.filter((t) => t.entryT >= from);
  const curve = res.equityCurve.filter((p) => p.t >= from);
  if (!curve.length) return summarizeCrossSectional(trades, [], cfg.capital);
  // Rebase to the window's own opening equity so a drawdown is measured against the
  // capital this window actually started with.
  const base = curve[0].equity;
  const scale = base > 0 ? cfg.capital / base : 1;
  return summarizeCrossSectional(trades, curve.map((p) => ({ ...p, equity: p.equity * scale })), cfg.capital);
}

const times = [...new Set([...bars.values()].flatMap((b) => b.map((c) => c.t)))].sort((a, b) => a - b);
// Walk forward over the TRADABLE span only. The dataset's first WARMUP_BARS days can
// never produce a trade, and including them would hand block 1 a couple hundred dead
// days that blocks 2-6 do not have, making the blocks incomparable.
const start = times[WARMUP_BARS];
const end = times[times.length - 1];
const span = (end - start) / BLOCKS;
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

// --- Gates 2 and 3: both halves positive, and 5/6 walk-forward blocks positive ---
console.log("--- walk-forward blocks ---");
let positiveBlocks = 0;
for (let b = 0; b < BLOCKS; b++) {
  const from = start + b * span;
  const to = b === BLOCKS - 1 ? end + 1 : start + (b + 1) * span;
  const s = runWindow(bars, from, to);
  const positive = s.totalPnl > 0;
  if (positive) positiveBlocks++;
  console.log(
    `${iso(from)}..${iso(to)}`.padEnd(26),
    `trades=${String(s.trades).padStart(5)}`,
    `PF=${(s.profitFactor ?? 0).toFixed(2)}`,
    `pnl=${s.totalPnl.toFixed(0).padStart(8)}`,
    `DD=${(s.maxDrawdownPct ?? 0).toFixed(1)}%`,
    positive ? "+" : "-",
  );
}

const mid = start + (end - start) * 0.65;
const trainS = runWindow(bars, start, mid);
const testS = runWindow(bars, mid, end + 1);

// --- Gate 5: 3x cost stress ---
const stressed = crossSectionalBacktest(bars, {
  ...cfg,
  costs: { slippageBps: (DEFAULT_COST_MODEL.slippageBps ?? 0) * 3, commissionBps: (DEFAULT_COST_MODEL.commissionBps ?? 0) * 3 },
}).summary;

// --- Gate 6: universe haircut ---
console.log("\n--- universe haircut (narrower list = more survivorship bias) ---");
const haircut: Record<string, number> = {};
for (const key of ["dow30", "nasdaq100", "sp500"]) {
  try {
    const s = crossSectionalBacktest(await loadBars(key), cfg).summary;
    haircut[key] = s.profitFactor ?? 0;
    console.log(`${key.padEnd(12)} PF=${(s.profitFactor ?? 0).toFixed(2)} trades=${s.trades}`);
  } catch {
    console.log(`${key.padEnd(12)} (no cache — run cache-daily-bars.mts for this universe)`);
  }
}

// --- Gate 7: SPY benchmark, return per unit of max drawdown ---
const full = crossSectionalBacktest(bars, cfg).summary;
const spy = bars.get("SPY") ?? [];
let spyReturnPct = 0;
let spyMaxDdPct = 0;
if (spy.length) {
  spyReturnPct = ((spy[spy.length - 1].c - spy[0].c) / spy[0].c) * 100;
  let peak = spy[0].c;
  for (const c of spy) {
    peak = Math.max(peak, c.c);
    spyMaxDdPct = Math.max(spyMaxDdPct, ((peak - c.c) / peak) * 100);
  }
}
const stratReturnPct = ((full.totalPnl) / cfg.capital) * 100;
const stratRatio = full.maxDrawdownPct ? stratReturnPct / full.maxDrawdownPct : null;
const spyRatio = spyMaxDdPct ? spyReturnPct / spyMaxDdPct : null;

// --- Scorecard ---
const gates: [string, boolean, string][] = [
  ["1. >=500 trades per half", trainS.trades >= 500 && testS.trades >= 500, `train=${trainS.trades} test=${testS.trades}`],
  ["2. positive in both halves", trainS.totalPnl > 0 && testS.totalPnl > 0, `train=${trainS.totalPnl.toFixed(0)} test=${testS.totalPnl.toFixed(0)}`],
  ["3. >=5/6 walk-forward blocks", positiveBlocks >= 5, `${positiveBlocks}/6`],
  ["4. parameter plateau", false, "MANUAL — read the Task 6 sweep table"],
  ["5. survives 3x costs", stressed.totalPnl > 0, `pnl=${stressed.totalPnl.toFixed(0)}`],
  ["6. no improvement as universe narrows", (haircut.dow30 ?? 0) <= (haircut.sp500 ?? 0), `dow30=${(haircut.dow30 ?? 0).toFixed(2)} sp500=${(haircut.sp500 ?? 0).toFixed(2)}`],
  ["7. beats SPY return/maxDD", stratRatio != null && spyRatio != null && stratRatio > spyRatio, `strat=${stratRatio?.toFixed(2)} spy=${spyRatio?.toFixed(2)}`],
];

console.log("\n--- gate scorecard ---");
for (const [name, pass, detail] of gates) console.log(`${pass ? "PASS" : "FAIL"}  ${name.padEnd(38)} ${detail}`);
console.log(`\nverdict: ${gates.every(([, p]) => p) ? "ALL GATES PASS" : "FAILED — see above"}`);
```

- [ ] **Step 2: Run it on the best config from Task 6**

Run (substituting the winning params from Task 6's table):

```bash
node --env-file=.env --import tsx scripts/walkforward-cross-sectional.mts sp500 atrReturn 3 spySma200 5 5 off y
```

Expected: block table, haircut table, and the 7-gate scorecard.

- [ ] **Step 3: Run it on the runner-up config**

Run the same command with the second-best row from Task 6. Gate 4 (plateau) is judged by whether neighbouring configs score similarly — if the best config passes and its neighbours collapse, gate 4 fails regardless of the headline numbers.

- [ ] **Step 4: Write the results document**

Create `docs/quant/2026-08-15-cross-sectional-mean-reversion-results.md` recording, in the style of `docs/quant/2026-07-22-di-dominance-retune-proposal.md`:

- the measured history depth from Task 1 and which provider served the bars
- the sweep table (top rows) and how many combos passed
- the full gate scorecard for the best and runner-up configs
- the verdict: which gates failed, or that all passed
- **if it failed:** what the failure mode was (trade starvation vs no edge vs bias-dependent), stated clearly enough that a future session does not re-explore this mechanism — the same purpose the Donchian and candlestick rejection notes serve
- the explicit reminder that every number is an upper bound because the universe is survivorship-biased

- [ ] **Step 5: Commit**

```bash
git add scripts/walkforward-cross-sectional.mts docs/quant/2026-08-15-cross-sectional-mean-reversion-results.md
git commit -m "feat(quant): cross-sectional walk-forward + gate scorecard, with results"
```

- [ ] **Step 6: CHECKPOINT — report the verdict**

Report the scorecard to the user.

- **All seven gates pass:** the spec's Section 5 (live runner, AI stage, scheduler, Webull routing) becomes plannable. Write that plan next.
- **Any gate fails:** stop. The results document is the deliverable. Do not re-tune to chase a pass — that is exactly the behaviour the gates exist to prevent.

---

## Self-Review

**Spec coverage:**

| Spec section | Covered by |
|---|---|
| §1 survivorship mitigations 1 (point-in-time filters) | Task 3 `isEligible` + its tests |
| §1 mitigation 2 (universe haircut) | Task 7 haircut block, gate 6 |
| §1 mitigation 3 (higher bar) | Task 6 train bar PF ≥ 1.1 + Task 7 gates |
| §1 mitigation 4 (upper-bound labelling) | Task 7 Step 4 results doc |
| §1 fetching and caching | Task 1 |
| §2 parameter grid | Task 2 `CsConfig` (all 8 axes), Task 6 `GRID` (7 axes swept — see the note below) |
| §2 optional stop | `stopAtrMult: null` supported and swept |
| §2 time-based exit | Task 5 rule 2, `hold-expiry` |
| §2 entry at t+1 open | Task 5 rule 1 + its two tests |
| §2 equal-weight sizing, fractional shares | Task 5 rule 6 |
| §3 module + interface | Tasks 2–5 |
| §3 day loop steps 1–6 | Task 5 engine sections 1–7 |
| §3 no-lookahead test | Task 5 test "future bars cannot change the result" |
| §3 rank-order slot allocation | Task 5 rule 5 + its test |
| §3 DEFAULT_COST_MODEL | Task 6/7 scripts |
| §3 drawdown, CAGR, time-in-market | Task 4 |
| §4 gates 1–7 | Task 7 scorecard (gate 4 flagged manual) |
| §4 split and walk-forward protocol | Task 6 (65/35), Task 7 (6 blocks) |
| §4 stop on failure | Task 7 Step 6 checkpoint |
| §5 deployment | **Deferred by design** — gated on Task 7's verdict, as the spec requires |
| Open risk: unmeasured data depth | Task 1 Step 5 checkpoint |
| Open risk: fractional shares | Assumed in Task 5; verification is a live-broker question, not a backtest one |

**One parameter added beyond the spec: `maxRankScore`.** The spec describes the mechanism as "rank eligible stocks and trade the extremes", which on its own has no floor — on a day when nothing fell, the top-ranked name is simply the least-rising stock, and the engine would buy it as though it were oversold. `maxRankScore` requires a genuine decline (≤ 0 for the ATR-return measure, ≤ 10 for RSI(2)) before a symbol is a candidate at all. It is held fixed rather than swept, so it adds no search freedom. Flag it to the user when reporting Task 5, since it is a change to the approved design rather than an implementation detail.

**Note on gate 4:** the plateau check is a judgement made by reading the Task 6 sweep table, not a computation. The scorecard prints it as FAIL/MANUAL so it cannot be silently skipped.

**Note on the sweep's coverage vs the spec's grid.** The spec lists eight swept axes. All eight are real parameters on `CsConfig` and all eight are honoured by the engine, but the Task 6 primary grid varies only seven of them, and holds three at their defaults:

| Spec axis | In `CsConfig` | In the Task 6 grid |
|---|---|---|
| Fall measure, lookback K | yes | yes |
| Quality filter (SMA200) | yes | yes |
| Market regime | yes | yes |
| Slots | yes | yes |
| Hold H | yes | yes |
| Stop | yes | yes |
| Liquidity threshold (5/10/25M) | yes | **held at $10M** |
| News filter (10/15/20/off) | yes | **held at 15%** |
| Alternative exit (close > SMA5) | yes | **held off** |

Held constant because the full cross product is ~2,600 combos on 490 symbols, and sweeping every filter simultaneously is itself a way to overfit. These three are second-pass axes: if the primary grid produces a config that clears the Task 7 gates, re-sweep it across the three held axes to confirm it sits on a plateau there too. If nothing clears the primary grid, they are irrelevant. This is a deliberate ordering, not an omission — record it in the Task 7 results document either way.
