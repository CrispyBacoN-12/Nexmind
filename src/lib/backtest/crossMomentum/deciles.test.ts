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
