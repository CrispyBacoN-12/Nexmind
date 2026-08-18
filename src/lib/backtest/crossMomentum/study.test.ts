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

/** Three symbols: used for membership gating tests where excluding one symbol should still leave enough to meet minEligible. */
function threeSymbols(): Map<string, Candle[]> {
  return new Map([
    ["UP", series(trend(600, 0.002))],
    ["DOWN", series(trend(600, 0.0002))],
    ["FLAT", series(trend(600, 0.001))],
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

test("isMember excludes a non-member symbol from a rebalance", () => {
  const bars = threeSymbols();
  const { snapshots: baseline } = buildSnapshots(bars, cfg);
  const firstDay = baseline[0].day;

  // DOWN is a member only from the day AFTER the first rebalance's ranking
  // day; UP and FLAT are always members, so excluding DOWN still leaves 2
  // eligible (>= minEligible), and the rebalance still happens on firstDay.
  const isMember = (symbol: string, d: number) => symbol !== "DOWN" || d > firstDay;
  const { snapshots } = buildSnapshots(bars, cfg, isMember);
  assert.equal(snapshots[0].day, firstDay, "rebalance should still occur on the original day");
  assert.ok(!snapshots[0].symbols.includes("DOWN"), "DOWN should be excluded from the first rebalance");
});

test("isMember includes a symbol once it becomes a member", () => {
  const bars = twoSymbols();
  const { snapshots: baseline } = buildSnapshots(bars, cfg);
  const firstDay = baseline[0].day;

  const isMember = (symbol: string, d: number) => symbol === "UP" || d > firstDay;
  const { snapshots } = buildSnapshots(bars, cfg, isMember);
  const second = snapshots[1];
  assert.ok(second.symbols.includes("DOWN"), "DOWN should be a candidate again once it becomes a member");
});

test("omitting isMember reproduces today's behaviour bit-for-bit", () => {
  const bars = twoSymbols();
  const withUndefined = buildSnapshots(bars, cfg, undefined);
  const withoutParam = buildSnapshots(bars, cfg);
  assert.deepEqual(withUndefined, withoutParam);
});
