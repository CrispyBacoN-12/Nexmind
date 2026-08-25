import "dotenv/config"; // @/lib/backtest/engine reaches prisma through scanner.ts, which constructs a client at module scope — same reason blindTest.test.ts does this
// panelRun.ts is pure — it takes a Panel and a SignalSource callback, so these
// tests need neither the 89MB bar cache nor prisma.
import { test } from "node:test";
import assert from "node:assert/strict";
import { WARMUP, type BacktestSummary, type EntrySignals } from "@/lib/backtest/engine";
import type { Candle } from "@/lib/indicators";
import type { Fold, Panel } from "./panel";
import { FOLDS } from "./panel";
import {
  sliceFold, withSignals, simulateFold, runControl, panelFoldVerdict,
  MIN_PANEL_TRADES, MIN_PANEL_SYMBOLS, PANEL_LOT,
  type FoldRun, type PanelExit, type PreparedSymbol,
} from "./panelRun";
import type { BootstrapResult, ControlDistribution } from "./control";

const DAY = 86_400;
const epoch = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;

/** A steady uptrend: close rises by `step` each bar, range ±1 around it. */
function uptrend(startIso: string, n: number, step = 1): Candle[] {
  const t0 = epoch(startIso);
  return Array.from({ length: n }, (_, i) => {
    const c = 100 + i * step;
    return { t: t0 + i * DAY, o: c - step, h: c + 1, l: c - step - 1, c, v: 1_000 };
  });
}

function panelOf(bars: Record<string, Candle[]>): Panel {
  return { fetchedAt: "2026-08-14T00:00:00.000Z", cachePath: ".cache/bars/test.json", symbols: Object.keys(bars), bars };
}

/** Signals with a long entry on the given indices, ATR fixed at 1 so stops are exact. */
function longsAt(n: number, indices: number[]): EntrySignals {
  const sides: ("long" | "short" | null)[] = new Array(n).fill(null);
  for (const i of indices) sides[i] = "long";
  return { sides, atrs: new Array(n).fill(1) };
}

// ---- sliceFold / withSignals ----

test("sliceFold drops symbols with no bars in the fold instead of zero-filling them", () => {
  // A name that listed in 2021 did not participate in a 2020 fold. Counting it
  // as a silent zero would push symbolsInFold up and make the participation
  // floor read as a strategy failure when it is a listing date.
  const panel = panelOf({
    OLD: uptrend("2019-01-01", 900),        // spans the fold
    LATE: uptrend("2024-01-01", 200),       // lists after it
    EMPTY: [],
  });
  const rows = sliceFold(panel, FOLDS.test1);
  assert.deepEqual(rows.map((r) => r.symbol), ["OLD"]);
  assert.ok(rows[0].entryFrom > 0, "the surviving symbol keeps its warm-up prefix");
});

test("sliceFold honours an explicit symbol subset", () => {
  const panel = panelOf({ A: uptrend("2019-01-01", 900), B: uptrend("2019-01-01", 900) });
  assert.deepEqual(sliceFold(panel, FOLDS.test1, ["B"]).map((r) => r.symbol), ["B"]);
});

test("withSignals asks the SignalSource for each symbol's own sliced bars", () => {
  // The slice, not the full history — passing the whole series would compute
  // indicators over bars the fold does not contain and quietly leak later data
  // into an earlier fold's signals.
  const panel = panelOf({ A: uptrend("2019-01-01", 900), B: uptrend("2019-01-01", 900) });
  const slices = sliceFold(panel, FOLDS.test1);
  const seen: Array<{ symbol: string; bars: number }> = [];
  withSignals(slices, (symbol, candles) => {
    seen.push({ symbol, bars: candles.length });
    return longsAt(candles.length, []);
  });
  assert.deepEqual(seen.map((s) => s.symbol), ["A", "B"]);
  assert.deepEqual(seen.map((s) => s.bars), slices.map((s) => s.candles.length));
});

// ---- simulateFold ----

const FIXTURE_FOLD: Fold = { name: "test1", from: "2020-01-01", to: "2022-01-01", regime: "fixture" };
const EXIT: PanelExit = { tp1Mult: 2, slMult: 1.5, singleTarget: true, lot: PANEL_LOT };

test("simulateFold aggregates trades across symbols and counts only those that traded", () => {
  const bars = uptrend("2020-01-01", 400);
  const prepared: PreparedSymbol[] = [
    { symbol: "WINS", candles: bars, entryFrom: 0, signals: longsAt(bars.length, [100, 200]) },
    { symbol: "SILENT", candles: bars, entryFrom: 0, signals: longsAt(bars.length, []) },
  ];
  const run = simulateFold(prepared, FIXTURE_FOLD, EXIT);
  assert.equal(run.symbolsInFold, 2, "a symbol that never fires still participated in the fold");
  assert.equal(run.symbolsTraded, 1);
  assert.equal(run.signals, 2);
  assert.equal(run.trades.length, 2);
  assert.ok(run.trades.every((t) => t.symbol === "WINS"));
  assert.equal(run.summary.trades, 2);
});

test("simulateFold never opens a position before entryFrom, so warm-up bars stay untradable", () => {
  // The warm-up prefix is real history from BEFORE the fold. A trade opened
  // there is a trade in another fold's data — on a TEST fold, that is a trade in
  // the training set.
  const bars = uptrend("2020-01-01", 400);
  const entryFrom = 150;
  const prepared: PreparedSymbol[] = [
    { symbol: "A", candles: bars, entryFrom, signals: longsAt(bars.length, [80, 120, 200]) },
  ];
  const run = simulateFold(prepared, FIXTURE_FOLD, EXIT);
  assert.equal(run.signals, 1, "the two signals inside the warm-up prefix are not entries");
  assert.ok(run.trades.every((t) => t.openedAt.getTime() >= bars[entryFrom].t * 1000));
});

test("simulateFold holds one position per symbol — a signal inside an open trade is not a new entry", () => {
  const bars = uptrend("2020-01-01", 400);
  const prepared: PreparedSymbol[] = [
    { symbol: "A", candles: bars, entryFrom: 0, signals: longsAt(bars.length, [100, 101, 102]) },
  ];
  const run = simulateFold(prepared, FIXTURE_FOLD, EXIT);
  assert.ok(run.trades.length < 3, `expected fewer trades than signals, got ${run.trades.length}`);
});

// ---- runControl ----

test("runControl produces a distribution of the same shape the real run is judged against", () => {
  const bars = uptrend("2020-01-01", 400);
  const prepared: PreparedSymbol[] = [
    { symbol: "A", candles: bars, entryFrom: 0, signals: longsAt(bars.length, [100, 180, 260, 340]) },
    { symbol: "B", candles: bars, entryFrom: 0, signals: longsAt(bars.length, [120, 200, 300]) },
  ];
  const control = runControl(prepared, FIXTURE_FOLD, EXIT, 20, 20260825);
  assert.ok(control);
  assert.equal(control.runs, 20);
  assert.ok(control.median <= control.p95);
  assert.deepEqual(control.avgRs, [...control.avgRs].sort((a, b) => a - b), "avgRs must come back ascending");
  // Reproducible from the seed alone — the property that makes a stored verdict
  // re-checkable months later.
  assert.deepEqual(runControl(prepared, FIXTURE_FOLD, EXIT, 20, 20260825), control);
});

test("runControl returns null when the control never trades, rather than an empty-looking distribution", () => {
  const bars = uptrend("2020-01-01", 400);
  const prepared: PreparedSymbol[] = [
    { symbol: "A", candles: bars, entryFrom: 0, signals: longsAt(bars.length, []) },
  ];
  assert.equal(runControl(prepared, FIXTURE_FOLD, EXIT, 10, 1), null);
});

test("runControl leaves the caller's prepared signals untouched", () => {
  // It re-places entries per run; if it mutated in place, run 2 would be a
  // control of a control and every later fold would inherit shuffled entries.
  const bars = uptrend("2020-01-01", 400);
  const signals = longsAt(bars.length, [100, 200, 300]);
  const before = [...signals.sides];
  runControl([{ symbol: "A", candles: bars, entryFrom: 0, signals }], FIXTURE_FOLD, EXIT, 5, 1);
  assert.deepEqual(signals.sides, before);
});

// ---- panelFoldVerdict ----

function summary(overrides: Partial<BacktestSummary> = {}): BacktestSummary {
  return {
    trades: 400, wins: 240, losses: 160, winRate: 60, totalPnl: 500,
    avgR: 0.3, expectancy: 10, profitFactor: 1.5, maxDrawdownPct: -5,
    sharpeRatio: 1, sortinoRatio: 1, totalCostsUsd: 10,
    ...overrides,
  };
}

function foldRun(overrides: Partial<FoldRun> = {}): FoldRun {
  return {
    fold: FIXTURE_FOLD,
    symbolsInFold: 480,
    symbolsTraded: 300,
    signals: 900,
    trades: [],
    summary: summary(),
    ...overrides,
  };
}

const FIT = { expectancy: 12, avgR: 0.4 };
const CONTROL: ControlDistribution = { runs: 200, avgRs: [], median: 0.05, p95: 0.12 };
const BOOTSTRAP: BootstrapResult = { runs: 1000, blocks: 24, p5: 0.04, p50: 0.3, p95: 0.6 };

test("panelFoldVerdict passes a fold that clears every arm of the bar", () => {
  const v = panelFoldVerdict(FIT, foldRun(), CONTROL, BOOTSTRAP);
  assert.equal(v.passed, true);
  assert.deepEqual(v.reasons, []);
});

test("panelFoldVerdict applies the panel trade floor, not the single-symbol one", () => {
  // MIN_TRADES = 20 would pass here. On a panel where 491 names are correlated
  // at rho 0.24-0.47, 50 trades is nowhere near 50 observations.
  const v = panelFoldVerdict(FIT, foldRun({ summary: summary({ trades: 50 }) }), CONTROL, BOOTSTRAP);
  assert.equal(v.passed, false);
  assert.ok(v.reasons.some((r) => r.includes(`50 < ${MIN_PANEL_TRADES}`)));
});

test("panelFoldVerdict fails a result carried by too few names, however many trades it has", () => {
  // The failure the trade count alone cannot see: 400 trades in 8 names is a
  // claim about 8 names.
  const v = panelFoldVerdict(FIT, foldRun({ symbolsTraded: MIN_PANEL_SYMBOLS - 1 }), CONTROL, BOOTSTRAP);
  assert.equal(v.passed, false);
  assert.ok(v.reasons.some((r) => r.includes(`of 480 symbols traded`)));
});

test("panelFoldVerdict requires the edge to beat the control's p95, not zero", () => {
  // The point of the whole control: 69-87% of names rose in every window
  // measured, so a long-biased rule clears zero on beta alone.
  const v = panelFoldVerdict(FIT, foldRun({ summary: summary({ avgR: 0.11 }) }), CONTROL, BOOTSTRAP);
  assert.equal(v.passed, false);
  assert.ok(v.reasons.some((r) => /does not beat the random-entry control/.test(r)));
});

test("panelFoldVerdict treats an avgR exactly equal to the control p95 as a failure", () => {
  // Ties go to the null hypothesis. A margin of zero is not a margin.
  const v = panelFoldVerdict(FIT, foldRun({ summary: summary({ avgR: CONTROL.p95 }) }), CONTROL, BOOTSTRAP);
  assert.equal(v.passed, false);
});

test("panelFoldVerdict fails closed when the control could not be computed", () => {
  // "We could not check" must never read as "it passed" — the same rule
  // applyBlindTestVerdict applies to a fetch error.
  const v = panelFoldVerdict(FIT, foldRun(), null, BOOTSTRAP);
  assert.equal(v.passed, false);
  assert.ok(v.reasons.some((r) => /unverified, which is not a pass/.test(r)));
});

test("panelFoldVerdict fails closed when the bootstrap could not be computed", () => {
  const v = panelFoldVerdict(FIT, foldRun(), CONTROL, null);
  assert.equal(v.passed, false);
  assert.ok(v.reasons.some((r) => /unverified, not a pass/.test(r)));
});

test("panelFoldVerdict fails when the bootstrap's 5th percentile is not positive", () => {
  const v = panelFoldVerdict(FIT, foldRun(), CONTROL, { ...BOOTSTRAP, p5: -0.02 });
  assert.equal(v.passed, false);
  assert.ok(v.reasons.some((r) => /block bootstrap p5 is -0\.020/.test(r)));
});

test("panelFoldVerdict reports a fold with no R-multiples as uncomparable rather than as a control loss", () => {
  const v = panelFoldVerdict(FIT, foldRun({ summary: summary({ avgR: null }) }), CONTROL, BOOTSTRAP);
  assert.equal(v.passed, false);
  assert.ok(v.reasons.some((r) => /no R-multiples/.test(r)));
  assert.ok(!v.reasons.some((r) => /does not beat the random-entry control/.test(r)));
});

test("panelFoldVerdict still enforces the retention bar it inherits from evaluateHoldout", () => {
  // The panel checks are additions, not a replacement. A fold can beat its
  // control and still be a collapse against what it was fitted to.
  const v = panelFoldVerdict({ expectancy: 12, avgR: 0.9 }, foldRun({ summary: summary({ avgR: 0.3 }) }), CONTROL, BOOTSTRAP);
  assert.equal(v.passed, false);
  assert.ok(v.reasons.some((r) => /kept only 33% of in-sample/.test(r)));
});

test("panelFoldVerdict collects every failure rather than stopping at the first", () => {
  // The blind-test report prints these verbatim; a verdict that named one
  // problem at a time would take four re-runs to read.
  const v = panelFoldVerdict(FIT, foldRun({ symbolsTraded: 3, summary: summary({ trades: 10, avgR: 0.01 }) }), CONTROL, null);
  assert.equal(v.passed, false);
  assert.ok(v.reasons.length >= 4, `expected several reasons, got ${v.reasons.length}: ${v.reasons.join(" | ")}`);
});

test("the engine's WARMUP is below PANEL_WARMUP's intent, so entryFrom is what actually binds on a fold", () => {
  // simulateExits starts at max(WARMUP, entryFrom). The panel always passes a
  // 250-bar prefix, so entryFrom dominates — if WARMUP ever rose above it, folds
  // would silently lose their opening bars.
  assert.ok(WARMUP < 250);
});
