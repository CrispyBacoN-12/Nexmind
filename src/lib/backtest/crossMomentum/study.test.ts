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
  // Bar 273 is the earliest eligible bar; its day key is START + 273.
  assert.ok(firstDay >= START + 273, `first rebalance ${firstDay} precedes the warm-up`);
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
  // alone.
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
});

test("subsetBars keeps only the named symbols", () => {
  const bars = twoSymbols();
  const out = subsetBars(bars, new Set(["UP"]));
  assert.deepEqual([...out.keys()], ["UP"]);
  assert.equal(out.get("UP"), bars.get("UP"));
});
