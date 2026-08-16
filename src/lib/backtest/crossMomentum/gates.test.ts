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

test("pure noise fails, specifically on the gates that ask about signal", () => {
  // At seed 22, crossDefinition, megaCap, and subPeriods happen to land positive
  // by chance (with strength 0 their sign is a coin flip carrying no real
  // information), so asserting those would make the test fragile to a future
  // seed change for no real coverage gain. Monotonicity, permutation, and
  // notTopOnly are the three gates that directly ask "is there a real
  // ranking-return relationship" — and with strength 0 there structurally isn't
  // one, so all three reject it. Confirmed by direct computation at this seed.
  const snaps = synth(59, 0, 22);
  const r = evaluateGates({ leg: "raw", snapshots: snaps, megaCapSnapshots: snaps, cfg });
  assert.equal(r.monotonicity.pass, false, `rho ${r.monotonicity.rho}`);
  assert.equal(r.permutation.pass, false, `p ${r.permutation.p}`);
  assert.equal(r.notTopOnly.pass, false, `excess ${r.notTopOnly.meanShortLegExcess}`);
  assert.equal(r.passed, false);
});

test("a non-monotone bucket order fails the monotonicity gate even with a real edge", () => {
  // Buckets 0-9 get deterministic returns that keep the top clearly above the
  // bottom but scramble the middle order: [0.00, 0.05, 0.02, 0.045, 0.01, 0.04,
  // 0.015, 0.035, 0.005, 0.06]. Spearman rho between bucket index (1..10) and
  // these values is 0.176 — well under RHO_MIN — even though the spread (both
  // legs, since raw and volAdj share the same ranking here), the survivorship
  // excess, the mega-cap spread, and all six sub-period blocks stay positive.
  // Confirmed by direct computation, not tuned against gates.ts internals.
  const b = [0.0, 0.05, 0.02, 0.045, 0.01, 0.04, 0.015, 0.035, 0.005, 0.06];
  const snaps: Snapshot[] = Array.from({ length: 59 }, (_, m) => {
    const scores = Array.from({ length: 100 }, (_, i) => i);
    return {
      day: 1_000 + m,
      symbols: scores.map((_, i) => `M${i}`),
      scores: { raw: scores, volAdj: scores },
      returns: scores.map((i) => b[Math.floor(i / 10)]),
    };
  });
  const r = evaluateGates({ leg: "raw", snapshots: snaps, megaCapSnapshots: snaps, cfg });
  assert.equal(r.monotonicity.pass, false, `rho ${r.monotonicity.rho}`);
  assert.equal(r.permutation.pass, true, "the other gates must still pass, or this proves nothing");
  assert.equal(r.crossDefinition.pass, true);
  assert.equal(r.notTopOnly.pass, true);
  assert.equal(r.megaCap.pass, true);
  assert.equal(r.subPeriods.pass, true);
  assert.equal(r.passed, false);
});

test("an edge too weak to beat the permutation null fails that gate alone", () => {
  // synth's usual strength (0.05) is comfortably significant. Strength 0.0006 at
  // seed 29 sits in a narrow band where the bucket order is still monotonic
  // enough to pass (rho ~0.78), both legs' spread stays positive, the
  // survivorship excess and mega-cap spread hold, and 4 of 6 sub-period blocks
  // are still positive — but the true edge is too weak relative to the
  // month-to-month noise for the permutation null to be beaten (p ~0.075 >
  // P_MAX). Found by sweeping strength/seed and confirmed by direct computation,
  // not tuned against gates.ts internals.
  const snaps = synth(59, 0.0006, 29);
  const r = evaluateGates({ leg: "raw", snapshots: snaps, megaCapSnapshots: snaps, cfg });
  assert.equal(r.permutation.pass, false, `p ${r.permutation.p}`);
  assert.equal(r.monotonicity.pass, true, "the other gates must still pass, or this proves nothing");
  assert.equal(r.crossDefinition.pass, true);
  assert.equal(r.notTopOnly.pass, true);
  assert.equal(r.megaCap.pass, true);
  assert.equal(r.subPeriods.pass, true);
  assert.equal(r.passed, false);
});

test("a spread concentrated in one sub-period fails consistency even with a positive mean", () => {
  // The first 10 months (block 0 of 6) carry a strong monotone edge; the
  // remaining 49 months are exactly flat — zero return for every symbol. Block
  // 0's edge alone is enough to keep the all-month mean positive: monotonicity
  // (averaged over all 59 months, still perfectly ordered since the flat months
  // contribute 0 to every bucket), both legs' spread, the survivorship excess,
  // and the mega-cap spread all pass on that averaged signal — but only block 0
  // has a positive block mean, so positive = 1, under BLOCKS_POSITIVE_MIN.
  const b = [0.0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.1];
  const snaps: Snapshot[] = Array.from({ length: 59 }, (_, m) => {
    const scores = Array.from({ length: 100 }, (_, i) => i);
    const inFirstBlock = m < 10;
    return {
      day: 1_000 + m,
      symbols: scores.map((_, i) => `B${i}`),
      scores: { raw: scores, volAdj: scores },
      returns: scores.map((i) => (inFirstBlock ? b[Math.floor(i / 10)] : 0)),
    };
  });
  const r = evaluateGates({ leg: "raw", snapshots: snaps, megaCapSnapshots: snaps, cfg });
  assert.equal(r.subPeriods.pass, false, `positive ${r.subPeriods.positive}`);
  assert.equal(r.monotonicity.pass, true, "the other gates must still pass, or this proves nothing");
  assert.equal(r.permutation.pass, true);
  assert.equal(r.crossDefinition.pass, true);
  assert.equal(r.notTopOnly.pass, true);
  assert.equal(r.megaCap.pass, true);
  assert.equal(r.passed, false);
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
  // The equality is the load-bearing assertion, checked first: the original
  // full-universe statistic returns 0.005000000000000003 on this exact fixture,
  // so only an exact-zero check distinguishes the corrected gate from the defect
  // it replaces. The boolean below is corroboration, checked second.
  assert.equal(r.notTopOnly.meanShortLegExcess, 0);
  assert.equal(r.notTopOnly.pass, false, "the bottom bucket does not underperform the non-top universe");
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

test("net spread is gross minus costBps applied to turnover, doubled, exactly", () => {
  // Static scores (0..99, unchanged every month) mean bucket membership never
  // changes after month 0: turnover(prev, next) returns 1 when prev is null (the
  // first month, nothing was held before) and 0 once the set stops changing
  // (every month after, since the ranking never moves). So turnoverSum accrues
  // only at month 0, where tTop = tBot = 1: turnoverSum = (1 + 1) / 2 = 1 across
  // all `months` snapshots, giving meanTurnover = 1 / months exactly. The cost
  // term ((tTop + tBot) * 2 * costBps / 10_000) is likewise nonzero only at
  // month 0, where it equals 4 * costBps / 10_000, subtracted once from an
  // N-month sum. So netMeanSpread = meanSpread - 4 * costBps / (10_000 *
  // months) — a relation derived from the turnover and cost formulas, not read
  // off a run, and independent of what the spread itself happens to be.
  const months = 5;
  const snaps: Snapshot[] = Array.from({ length: months }, (_, m) => {
    const scores = Array.from({ length: 100 }, (_, i) => i);
    return {
      day: 3_000 + m,
      symbols: scores.map((_, i) => `T${i}`),
      scores: { raw: scores, volAdj: scores },
      returns: scores.map((i) => i * 0.0001),
    };
  });
  const r = evaluateGates({ leg: "raw", snapshots: snaps, megaCapSnapshots: snaps, cfg });
  const expectedTurnover = 1 / months;
  const expectedNet = r.meanSpread - (4 * cfg.costBps) / (10_000 * months);
  assert.ok(Math.abs(r.meanTurnover - expectedTurnover) < 1e-9, `turnover ${r.meanTurnover}`);
  assert.ok(Math.abs(r.netMeanSpread - expectedNet) < 1e-9, `net ${r.netMeanSpread}, expected ${expectedNet}`);
});

test("gate 4 weights buckets by symbol count, not bucket count", () => {
  // 103 symbols into 10 buckets: bucketBounds floors k*103/10, giving sizes
  // [10,10,10,11,10,10,11,10,10,11] for buckets 0-9 (three buckets of 11, seven
  // of 10) — every existing fixture in this file uses 100 symbols, where all ten
  // buckets are size 10 and the weighting is invisible. Returns here are exactly
  // rank * 0.001, so each bucket's mean return is just the mean of its index
  // range. Buckets 0-8 together span indices 0..91 — everything except the top
  // bucket — so their SIZE-weighted mean is simply the mean of the integers
  // 0..91, i.e. 45.5 -> 0.0455, regardless of how those 92 indices are split
  // into buckets. Bucket 0 spans indices 0..9, mean 4.5 -> 0.0045. Hand-computed
  // excess: 0.0455 - 0.0045 = 0.041, worked out from the bucket sizes and the
  // return formula, not read off a run.
  const n = 103;
  const snaps: Snapshot[] = Array.from({ length: 3 }, (_, m) => {
    const scores = Array.from({ length: n }, (_, i) => i);
    return {
      day: 2_000 + m,
      symbols: scores.map((_, i) => `U${i}`),
      scores: { raw: scores, volAdj: scores },
      returns: scores.map((i) => i * 0.001),
    };
  });
  const r = evaluateGates({ leg: "raw", snapshots: snaps, megaCapSnapshots: snaps, cfg });
  assert.ok(
    Math.abs(r.notTopOnly.meanShortLegExcess - 0.041) < 1e-9,
    `expected 0.041, got ${r.notTopOnly.meanShortLegExcess}`,
  );
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
