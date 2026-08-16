import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateGates, RHO_MIN, P_MAX, BLOCKS_POSITIVE_MIN } from "./gates";
import { mulberry32 } from "./rng";
import type { MomentumConfig, Snapshot } from "./types";

const cfg: MomentumConfig = {
  lookback: 252, skip: 21, buckets: 10, minEligible: 10,
  costBps: 5, seed: 4, iterations: 200, blocks: 6,
};

/**
 * `months` snapshots of 100 symbols. `strength` scales how much of a symbol's
 * return its score explains; 0 is pure noise.
 */
function synth(months: number, strength: number, seed: number): Snapshot[] {
  const rand = mulberry32(seed);
  return Array.from({ length: months }, (_, m) => {
    const scores = Array.from({ length: 100 }, () => rand() - 0.5);
    return {
      day: 1_000 + m,
      symbols: scores.map((_, i) => `S${i}`),
      scores: { raw: scores, volAdj: scores.map((s) => s * 0.5) },
      returns: scores.map((s) => s * strength + (rand() - 0.5) * 0.02),
    };
  });
}

test("a strong, monotone signal passes every gate", () => {
  const snaps = synth(59, 0.05, 21);
  const r = evaluateGates({ leg: "raw", snapshots: snaps, megaCapSnapshots: snaps, cfg });
  assert.ok(r.monotonicity.pass, `rho ${r.monotonicity.rho}`);
  assert.ok(r.permutation.pass, `p ${r.permutation.p}`);
  assert.ok(r.crossDefinition.pass);
  assert.ok(r.notTopOnly.pass);
  assert.ok(r.megaCap.pass);
  assert.ok(r.subPeriods.pass);
  assert.ok(r.passed);
  assert.equal(r.months, 59);
});

test("pure noise fails", () => {
  const snaps = synth(59, 0, 22);
  assert.equal(evaluateGates({ leg: "raw", snapshots: snaps, megaCapSnapshots: snaps, cfg }).passed, false);
});

test("passed is an AND — one failing gate sinks the report", () => {
  const snaps = synth(59, 0.05, 23);
  // Break only the mega-cap gate by handing it a reversed cross-section.
  const reversed = snaps.map((s) => ({ ...s, returns: s.returns.map((r) => -r) }));
  const r = evaluateGates({ leg: "raw", snapshots: snaps, megaCapSnapshots: reversed, cfg });
  assert.equal(r.megaCap.pass, false);
  assert.equal(r.monotonicity.pass, true, "the other gates must still pass, or this proves nothing");
  assert.equal(r.passed, false);
});

test("an edge living only in the top bucket fails the survivorship gate", () => {
  // Every bucket flat except the top one: the shape survivorship fabricates.
  // Buckets 0-8 are EXACTLY flat, with no noise at all. That is deliberate. Once
  // the top decile is excluded from the comparison mean the true excess here is
  // exactly zero, so any residual noise decides the sign of a `> 0` test by coin
  // flip: an earlier draft of this fixture carried +-0.001 of noise, and the
  // corrected gate returned +1.13e-5 and PASSED on it. Exactly flat makes the
  // excess exactly 0, and `0 > 0` is false deterministically, for every seed.
  const snaps: Snapshot[] = Array.from({ length: 59 }, (_, m) => {
    const scores = Array.from({ length: 100 }, (_, i) => i);
    return {
      day: 1_000 + m,
      symbols: scores.map((_, i) => `S${i}`),
      scores: { raw: scores, volAdj: scores },
      returns: scores.map((s) => (s >= 90 ? 0.05 : 0)),
    };
  });
  const r = evaluateGates({ leg: "raw", snapshots: snaps, megaCapSnapshots: snaps, cfg });
  assert.equal(r.notTopOnly.pass, false, "the bottom bucket does not underperform the non-top universe");
  // The equality is the load-bearing assertion, not the boolean above it. The
  // original full-universe statistic returns 0.005000000000000003 on this exact
  // fixture, so only an exact-zero check distinguishes the two.
  assert.equal(r.notTopOnly.meanShortLegExcess, 0);
  // NB: `passed` is also false here because monotonicity fails (rho = 0.522 with
  // nine tied buckets, under RHO_MIN). It is corroboration, not evidence — the
  // two assertions above are what pin gate 4.
  assert.equal(r.passed, false);
});

test("the cross-definition gate reads the OTHER leg", () => {
  const snaps = synth(59, 0.05, 25);
  // volAdj scaled negative: same information, opposite sign, so the other leg's
  // mean spread turns negative while this leg's stays positive.
  const opposed = snaps.map((s) => ({ ...s, scores: { raw: s.scores.raw, volAdj: s.scores.raw.map((x) => -x) } }));
  const r = evaluateGates({ leg: "raw", snapshots: opposed, megaCapSnapshots: opposed, cfg });
  assert.ok(r.crossDefinition.otherMeanSpread < 0);
  assert.equal(r.crossDefinition.pass, false);
});

test("sub-period consistency counts blocks, not months", () => {
  const snaps = synth(59, 0.05, 26);
  const r = evaluateGates({ leg: "raw", snapshots: snaps, megaCapSnapshots: snaps, cfg });
  assert.equal(r.subPeriods.of, 6);
  assert.equal(r.subPeriods.blockMeans.length, 6);
  assert.ok(r.subPeriods.positive >= BLOCKS_POSITIVE_MIN);
});

test("net returns sit below gross, and turnover is reported", () => {
  const snaps = synth(59, 0.05, 27);
  const r = evaluateGates({ leg: "raw", snapshots: snaps, megaCapSnapshots: snaps, cfg });
  assert.ok(r.netMeanSpread < r.meanSpread, "costs must reduce the spread");
  assert.ok(r.meanTurnover > 0 && r.meanTurnover <= 1);
});

test("the reported figures are present and finite", () => {
  const snaps = synth(59, 0.05, 28);
  const r = evaluateGates({ leg: "raw", snapshots: snaps, megaCapSnapshots: snaps, cfg });
  assert.equal(r.bucketMeans.length, 10);
  assert.ok(Number.isFinite(r.tStat));
  assert.ok(Number.isFinite(r.meanSpread));
});

test("the thresholds are the values the spec pins", () => {
  assert.equal(RHO_MIN, 0.6);
  assert.equal(P_MAX, 0.05);
  assert.equal(BLOCKS_POSITIVE_MIN, 4);
});
