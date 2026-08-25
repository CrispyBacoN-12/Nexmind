import "dotenv/config"; // @/lib/backtest/engine reaches prisma through scanner.ts, which constructs a client at module scope — same reason blindTest.test.ts does this
// control.ts is pure and seeded — no prisma, no network, no Date.now().
import { test } from "node:test";
import assert from "node:assert/strict";
import { WARMUP, type EntrySignals, type SimTrade } from "@/lib/backtest/engine";
import { mulberry32, percentile, matchedRandomSignals, summarizeControl, monthlyBlockBootstrap } from "./control";

/** Signals of length `n` with `sides` placed at the given indices. */
function signals(n: number, placed: Record<number, "long" | "short">): EntrySignals {
  const sides: ("long" | "short" | null)[] = new Array(n).fill(null);
  for (const [i, s] of Object.entries(placed)) sides[Number(i)] = s;
  return { sides, atrs: new Array(n).fill(1.5) };
}

const countSides = (s: EntrySignals) => s.sides.filter(Boolean).length;
const sideMultiset = (s: EntrySignals) => {
  const m = { long: 0, short: 0 };
  for (const x of s.sides) if (x) m[x]++;
  return m;
};

// ---- mulberry32 ----

test("mulberry32 is deterministic per seed and different across seeds", () => {
  // The whole gate is only pre-registrable because a verdict reproduces from the
  // cache alone. If this drifts, an old blindTest JSON stops being checkable.
  const draw = (seed: number) => Array.from({ length: 8 }, mulberry32(seed));
  assert.deepEqual(draw(1), draw(1));
  assert.notDeepEqual(draw(1), draw(2));
  assert.ok(draw(20260825).every((v) => v >= 0 && v < 1));
});

// ---- percentile ----

test("percentile interpolates between neighbours and clamps p", () => {
  const s = [0, 1, 2, 3, 4];
  assert.equal(percentile(s, 0), 0);
  assert.equal(percentile(s, 1), 4);
  assert.equal(percentile(s, 0.5), 2);
  assert.equal(percentile(s, 0.25), 1);
  // pos = 4 * 0.95 = 3.8 → 3 + 0.8*(4-3)
  assert.ok(Math.abs(percentile(s, 0.95) - 3.8) < 1e-12);
  assert.equal(percentile(s, -5), 0, "p below 0 clamps rather than reading off the end");
  assert.equal(percentile(s, 5), 4);
});

test("percentile handles the degenerate lengths without producing a number that looks real", () => {
  assert.ok(Number.isNaN(percentile([], 0.5)), "an empty distribution has no p95 — NaN, not 0");
  assert.equal(percentile([7], 0.95), 7);
});

// ---- matchedRandomSignals ----

test("matchedRandomSignals preserves the entry count and the exact long/short multiset", () => {
  // This is what makes the control a control. Resampling sides instead of
  // permuting them would put directional exposure — the very thing being
  // controlled for — back into the estimate.
  const real = signals(300, { 80: "long", 95: "long", 140: "short", 210: "long", 260: "short" });
  const rng = mulberry32(7);
  for (let i = 0; i < 20; i++) {
    const ctrl = matchedRandomSignals(real, 0, rng);
    assert.equal(countSides(ctrl), countSides(real));
    assert.deepEqual(sideMultiset(ctrl), sideMultiset(real));
  }
});

test("matchedRandomSignals never places an entry before max(WARMUP, entryFrom)", () => {
  // A control that can trade the fold's warm-up prefix would be trading bars the
  // strategy was forbidden from — and, worse, bars from BEFORE the held-out fold.
  const real = signals(400, { 200: "long", 250: "long", 300: "short" });
  const entryFrom = 180;
  const rng = mulberry32(11);
  for (let i = 0; i < 30; i++) {
    const ctrl = matchedRandomSignals(real, entryFrom, rng);
    const first = ctrl.sides.findIndex(Boolean);
    assert.ok(first >= Math.max(WARMUP, entryFrom), `entry at ${first} is before the floor ${entryFrom}`);
  }
});

test("matchedRandomSignals counts only the entries the strategy was itself allowed to take", () => {
  // Signals sitting inside the warm-up prefix are not trades for the strategy
  // either — simulateExits' entryFrom skips them. Counting them would hand the
  // control more entries than the rule got.
  const real = signals(300, { 20: "long", 40: "short", 150: "long", 220: "short" });
  const ctrl = matchedRandomSignals(real, 100, mulberry32(3));
  assert.equal(countSides(ctrl), 2, "the two pre-entryFrom signals must not be re-placed as tradable");
});

test("matchedRandomSignals passes the real ATR series through untouched", () => {
  // The control gets the true volatility of whatever bar it lands on, so its
  // stop/target widths match what the strategy would have used there. Anything
  // else makes it a control for two variables at once.
  const real = signals(200, { 100: "long" });
  const ctrl = matchedRandomSignals(real, 0, mulberry32(5));
  assert.equal(ctrl.atrs, real.atrs);
});

test("matchedRandomSignals returns an empty control when there is nothing to place", () => {
  assert.equal(countSides(matchedRandomSignals(signals(200, {}), 0, mulberry32(1))), 0);
  // entryFrom past the end: no eligible bar at all, and it must not loop or throw.
  assert.equal(countSides(matchedRandomSignals(signals(200, { 100: "long" }), 500, mulberry32(1))), 0);
});

test("matchedRandomSignals still matches the count when entries nearly fill the eligible window", () => {
  // Rejection sampling stalls here; the fill-forward fallback is what keeps the
  // count matched. If it silently under-filled, the control would trade less
  // than the strategy and lose for the wrong reason.
  const dense: Record<number, "long" | "short"> = {};
  for (let i = 61; i < 100; i++) dense[i] = i % 3 === 0 ? "short" : "long";
  const real = signals(101, dense);
  const ctrl = matchedRandomSignals(real, 0, mulberry32(13));
  assert.equal(countSides(ctrl), countSides(real));
  assert.deepEqual(sideMultiset(ctrl), sideMultiset(real));
});

test("matchedRandomSignals reproduces exactly under the same seed", () => {
  const real = signals(300, { 80: "long", 140: "short", 210: "long" });
  assert.deepEqual(
    matchedRandomSignals(real, 0, mulberry32(20260825)).sides,
    matchedRandomSignals(real, 0, mulberry32(20260825)).sides,
  );
});

// ---- summarizeControl ----

test("summarizeControl sorts, drops non-finite runs, and returns null when nothing usable survives", () => {
  const d = summarizeControl([0.3, 0.1, NaN, 0.2, Infinity]);
  assert.ok(d);
  assert.equal(d.runs, 3);
  assert.deepEqual(d.avgRs, [0.1, 0.2, 0.3]);
  assert.equal(d.median, 0.2);
  // null, not a zero distribution — panelFoldVerdict must read "unverified" and fail.
  assert.equal(summarizeControl([]), null);
  assert.equal(summarizeControl([NaN, Infinity]), null);
});

// ---- monthlyBlockBootstrap ----

function trade(iso: string, r: number | null): Pick<SimTrade, "openedAt" | "rMultiple"> {
  return { openedAt: new Date(`${iso}T00:00:00Z`), rMultiple: r };
}

test("monthlyBlockBootstrap blocks by the month the trade OPENED in", () => {
  // The month the bet was placed is the market state it is a draw from. Keying
  // on the close would scatter one month's correlated entries across blocks and
  // reinstate exactly the independence the block bootstrap exists to deny.
  const trades = [
    trade("2020-01-05", 1), trade("2020-01-20", 1),
    trade("2020-02-05", -1), trade("2020-03-11", 2), trade("2020-04-02", 0.5),
  ];
  const b = monthlyBlockBootstrap(trades, 200, mulberry32(1));
  assert.ok(b);
  assert.equal(b.blocks, 4, "four calendar months, not five trades");
  assert.equal(b.runs, 200);
  assert.ok(b.p5 <= b.p50 && b.p50 <= b.p95);
});

test("monthlyBlockBootstrap returns null when there is nothing to resample", () => {
  // Both nulls have to read as "unverified" at the verdict layer. A single month
  // resampled with replacement would return its own mean 1000 times and report a
  // p5 identical to the point estimate — a confidence interval of width zero,
  // which is the most confident-looking thing this could possibly print.
  assert.equal(monthlyBlockBootstrap([], 100, mulberry32(1)), null);
  assert.equal(monthlyBlockBootstrap([trade("2020-01-05", 1), trade("2020-01-20", 2)], 100, mulberry32(1)), null);
  // Trades exist across months but none carries an R-multiple (all still open / no risk basis).
  assert.equal(
    monthlyBlockBootstrap([trade("2020-01-05", null), trade("2020-02-05", null)], 100, mulberry32(1)),
    null,
  );
  assert.equal(monthlyBlockBootstrap([trade("2020-01-05", 1), trade("2020-02-05", 2)], 0, mulberry32(1)), null);
});

test("monthlyBlockBootstrap weights a resampled month by its trade count, not equally", () => {
  // A month with 100 trades and a month with 1 are not equally-weighted draws
  // within a run — the estimator is total R over total trades, matching how avgR
  // is computed everywhere else. Here the heavy month is -1 and the light one is
  // +9, so an equal-weight estimator would centre near +4 while a
  // count-weighted one stays negative on nearly every draw.
  const trades = [
    ...Array.from({ length: 100 }, (_, i) => trade(`2020-01-${String((i % 28) + 1).padStart(2, "0")}`, -1)),
    trade("2020-02-05", 9),
  ];
  const b = monthlyBlockBootstrap(trades, 500, mulberry32(2));
  assert.ok(b);
  assert.ok(b.p50 < 0, `count-weighted median should stay negative, got ${b.p50}`);
});

test("monthlyBlockBootstrap reproduces exactly under the same seed", () => {
  const trades = [trade("2020-01-05", 1), trade("2020-02-05", -0.5), trade("2020-03-05", 2)];
  assert.deepEqual(
    monthlyBlockBootstrap(trades, 100, mulberry32(42)),
    monthlyBlockBootstrap(trades, 100, mulberry32(42)),
  );
});
