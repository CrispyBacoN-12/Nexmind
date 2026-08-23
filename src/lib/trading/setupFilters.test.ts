import "dotenv/config"; // scanner.ts -> research/adapter.ts constructs prisma at module scope
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideSetup, structureFields, DEFAULT_THRESHOLDS, type ScanSnapshot, type SetupThresholds } from "./scanner";
import type { Candle } from "@/lib/indicators";

/** A snapshot that fires a clean long under the base rules, so every assertion
 *  below isolates the filter under test rather than the trend gate. */
function longSetup(over: Partial<ScanSnapshot> = {}): ScanSnapshot {
  return {
    price: 100, sma20: 98, sma50: 95, rsi: 50, adx: 30, plusDI: 28, minusDI: 15,
    macdHist: 0.5, atr: 1.5, bbPercentB: 0.5, bbWidth: 0.05, stochK: 50, stochD: 50,
    vwapDevPct: 0.004, vpPos: 0, sweep: "long",
    lc: { prediction: 4, signal: 1, kernelBullish: true, kernelBearish: false },
    ...over,
  };
}

function shortSetup(over: Partial<ScanSnapshot> = {}): ScanSnapshot {
  return longSetup({
    sma20: 95, sma50: 98, plusDI: 15, minusDI: 28, macdHist: -0.5,
    bbPercentB: 0.5, stochK: 50, vwapDevPct: -0.004, sweep: "short",
    lc: { prediction: -4, signal: -1, kernelBullish: false, kernelBearish: true },
    ...over,
  });
}

const withFilters = (f: Partial<SetupThresholds>): SetupThresholds => ({ ...DEFAULT_THRESHOLDS, ...f });

test("decideSetup: the defaults are unchanged — every filter is inert unless asked for", () => {
  // The point of the whole exercise: adding the filters must not silently move
  // the baseline every existing backtest and live entry was measured against.
  assert.deepEqual(DEFAULT_THRESHOLDS, { adxFloor: 20, rsiLow: 35, rsiHigh: 70 });

  // Values that every filter would reject, judged with the defaults.
  const hostile = longSetup({
    bbPercentB: 0.99, bbWidth: 0.001, stochK: 99, vwapDevPct: -0.05, vpPos: 1, sweep: "short",
    lc: { prediction: -3, signal: -1, kernelBullish: false, kernelBearish: true },
  });
  assert.equal(decideSetup(hostile).side, "long");
});

test("decideSetup: Bollinger %B blocks the stretched side only", () => {
  const t = withFilters({ bbExtreme: 0.85 });
  assert.equal(decideSetup(longSetup({ bbPercentB: 0.9 }), t).side, null);
  assert.equal(decideSetup(longSetup({ bbPercentB: 0.6 }), t).side, "long");
  // Mirrored for shorts: the limit is 1 - bbExtreme = 0.15.
  assert.equal(decideSetup(shortSetup({ bbPercentB: 0.1 }), t).side, null);
  assert.equal(decideSetup(shortSetup({ bbPercentB: 0.4 }), t).side, "short");
  assert.match(decideSetup(longSetup({ bbPercentB: 0.9 }), t).note, /BB %B 0\.90 past 0\.85/);
});

test("decideSetup: bandwidth floor skips squeezes", () => {
  const t = withFilters({ bbWidthMin: 0.03 });
  assert.equal(decideSetup(longSetup({ bbWidth: 0.01 }), t).side, null);
  assert.equal(decideSetup(longSetup({ bbWidth: 0.04 }), t).side, "long");
});

test("decideSetup: Stochastic extreme mirrors for shorts", () => {
  const t = withFilters({ stochExtreme: 80 });
  assert.equal(decideSetup(longSetup({ stochK: 90 }), t).side, null);
  assert.equal(decideSetup(longSetup({ stochK: 70 }), t).side, "long");
  assert.equal(decideSetup(shortSetup({ stochK: 10 }), t).side, null);
  assert.equal(decideSetup(shortSetup({ stochK: 30 }), t).side, "short");
});

test("decideSetup: VWAP, LC, value area and sweep gates each block their own case", () => {
  assert.equal(decideSetup(longSetup({ vwapDevPct: -0.01 }), withFilters({ requireVwapSide: true })).side, null);
  assert.equal(decideSetup(longSetup({ vwapDevPct: 0.01 }), withFilters({ requireVwapSide: true })).side, "long");

  const lcAgainst = { prediction: -2, signal: -1, kernelBullish: false, kernelBearish: true } as const;
  assert.equal(decideSetup(longSetup({ lc: lcAgainst }), withFilters({ requireLc: true })).side, null);
  assert.equal(decideSetup(longSetup(), withFilters({ requireLc: true })).side, "long");

  assert.equal(decideSetup(longSetup({ vpPos: 1 }), withFilters({ requireValueArea: true })).side, null);
  assert.equal(decideSetup(longSetup({ vpPos: 0 }), withFilters({ requireValueArea: true })).side, "long");

  assert.equal(decideSetup(longSetup({ sweep: null }), withFilters({ requireSweep: true })).side, null);
  assert.equal(decideSetup(longSetup({ sweep: "short" }), withFilters({ requireSweep: true })).side, null);
  assert.equal(decideSetup(longSetup({ sweep: "long" }), withFilters({ requireSweep: true })).side, "long");
});

test("decideSetup: a filter whose indicator is missing abstains instead of blocking", () => {
  // Otherwise a short-history symbol is filtered out of every backtest and the
  // sweep reads that as "the filter improved things" — it only removed data.
  const blind = longSetup({ bbPercentB: null, bbWidth: null, stochK: null, vwapDevPct: null, vpPos: null, lc: null });
  const t = withFilters({ bbExtreme: 0.85, bbWidthMin: 0.03, stochExtreme: 80, requireVwapSide: true, requireLc: true, requireValueArea: true });
  assert.equal(decideSetup(blind, t).side, "long");
});

test("decideSetup: filters run after the base gates, never instead of them", () => {
  // A weak trend must still report the trend reason, not a filter reason —
  // otherwise the "no setup" diagnostics stop meaning anything.
  const weak = longSetup({ adx: 10, bbPercentB: 0.99 });
  assert.match(decideSetup(weak, withFilters({ bbExtreme: 0.85 })).note, /weak trend/);
});

// ---- structureFields ----
/** A quiet, strictly range-bound series: it repeats the same five prices, so no
 *  bar ever pierces the prior 20-bar extreme and nothing reads as a sweep by
 *  accident — any sweep in a test below is one the test put there. */
function candles(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const base = 100 + (i % 5) * 0.1;
    return { t: 1_750_000_000 + i * 3600, o: base, h: base + 0.5, l: base - 0.5, c: base, v: 1_000_000 };
  });
}

test("structureFields: reports where price sits against the value area", () => {
  const c = candles(60);
  const mid = structureFields(c, c.length - 1, 100);
  assert.equal(mid.vpPos, 0);
  assert.equal(structureFields(c, c.length - 1, 500).vpPos, 1);
  assert.equal(structureFields(c, c.length - 1, 1).vpPos, -1);
});

test("structureFields: only the last few bars count as a sweep", () => {
  const base = candles(60);
  // A textbook stop hunt: wick under the prior 20-bar low, close back inside.
  const sweepBar = (c: Candle): Candle => ({ ...c, l: 90, c: c.o + 0.2, h: c.o + 0.4 });

  const fresh = base.map((c, i) => (i === base.length - 1 ? sweepBar(c) : c));
  assert.equal(structureFields(fresh, fresh.length - 1, 100).sweep, "long");

  const stale = base.map((c, i) => (i === base.length - 10 ? sweepBar(c) : c));
  assert.equal(structureFields(stale, stale.length - 1, 100).sweep, null);
});

test("structureFields: too little history yields nulls, not a fabricated read", () => {
  // A five-bar "value area" would be two candles wide — a filter acting on it is
  // acting on noise, so the fields abstain until there is history behind them.
  const c = candles(10);
  assert.deepEqual(structureFields(c, 9, 100), { vpPos: null, sweep: null });
});
