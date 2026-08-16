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
