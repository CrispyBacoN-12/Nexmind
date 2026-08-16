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
