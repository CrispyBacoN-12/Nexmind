// The six gates, declared before any result was seen. They are an AND, not a
// scorecard: a report that passes five is a rejection.
import { bucketMonth, spreadOf } from "./deciles";
import { permutationPValue, spreadSeries } from "./permutation";
import { mean, spearman, splitBlocks, tStat, turnover } from "./stats";
import type { GateReport, MomentumConfig, ScoreLeg, Snapshot } from "./types";

/** Spearman rho across the buckets. One-sided p at 0.60 with n = 10 is ~0.07. */
export const RHO_MIN = 0.6;
export const P_MAX = 0.05;
export const BLOCKS_POSITIVE_MIN = 4;

const OTHER: Record<ScoreLeg, ScoreLeg> = { raw: "volAdj", volAdj: "raw" };

export function evaluateGates(args: {
  leg: ScoreLeg;
  snapshots: Snapshot[];
  megaCapSnapshots: Snapshot[];
  cfg: MomentumConfig;
}): GateReport {
  const { leg, snapshots, megaCapSnapshots, cfg } = args;
  const months = snapshots.map((s) => bucketMonth(s, leg, cfg.buckets));
  const spread = months.map(spreadOf);

  // Gate 1 — monotonicity across the buckets, not merely a gap at the ends.
  const bucketMeans = Array.from({ length: cfg.buckets }, (_, k) => mean(months.map((m) => m.bucketReturns[k])));
  const rho = spearman(
    Array.from({ length: cfg.buckets }, (_, k) => k + 1),
    bucketMeans,
  );

  // Gate 2 — could a ranking with no information have produced this?
  const perm = permutationPValue(snapshots, leg, cfg.buckets, cfg.iterations, cfg.seed);

  // Gate 3 — direction agreement only. Requiring the other leg to PASS would
  // collapse the two pre-registered legs into a single test.
  const otherMeanSpread = mean(spreadSeries(snapshots, OTHER[leg], cfg.buckets));

  // Gate 4 — survivorship inflates the top bucket and deflates the bottom, so an
  // edge that exists only at the top is the artifact, not the signal. The bottom
  // bucket has to underperform the universe EXCLUDING the top bucket.
  //
  // Excluding the top is not a refinement, it is the whole gate. Measured against
  // the full universe (`m.universeReturn`, which contains the top bucket), a
  // top-only edge lifts the benchmark above the flat bottom bucket, so the excess
  // is positive BY CONSTRUCTION and the gate passes precisely the shape it exists
  // to reject — the stronger the artifact, the more comfortably it passes. It
  // measured +0.005009 on the top-only fixture before this was corrected. See the
  // Gate 4 amendment note in the design spec.
  //
  // Buckets are weighted by their size because they are not equal: when the
  // eligible count is not divisible by `buckets` the low buckets hold one symbol
  // fewer, and this must remain an equal-weight mean over SYMBOLS, not over
  // buckets.
  const shortLegExcess = mean(
    months.map((m) => {
      let sum = 0;
      let count = 0;
      for (let k = 0; k < m.bucketReturns.length - 1; k++) {
        const size = m.bucketSymbols[k].length;
        sum += m.bucketReturns[k] * size;
        count += size;
      }
      return sum / count - m.bucketReturns[0];
    }),
  );

  // Gate 5 — the same question on names that were index members throughout.
  const megaMonths = megaCapSnapshots.map((s) => bucketMonth(s, leg, cfg.buckets));
  const megaSpread = mean(megaMonths.map(spreadOf));

  // Gate 6 — contiguous sub-periods.
  const blockMeans = splitBlocks(spread, cfg.blocks).map(mean);
  const positive = blockMeans.filter((x) => x > 0).length;

  // Reported, not gated: cost drag on both legs of the spread.
  const top = cfg.buckets - 1;
  let turnoverSum = 0;
  const netSpread = months.map((m, i) => {
    const prev = i === 0 ? null : months[i - 1];
    const tTop = turnover(prev?.bucketSymbols[top] ?? null, m.bucketSymbols[top]);
    const tBot = turnover(prev?.bucketSymbols[0] ?? null, m.bucketSymbols[0]);
    turnoverSum += (tTop + tBot) / 2;
    // Each changed name is bought and later sold, so the cost is charged twice.
    return spread[i] - ((tTop + tBot) * 2 * cfg.costBps) / 10_000;
  });

  const gates = {
    monotonicity: { rho, pass: rho >= RHO_MIN },
    permutation: { p: perm.p, pass: perm.p <= P_MAX },
    crossDefinition: { otherMeanSpread, pass: otherMeanSpread > 0 },
    notTopOnly: { meanShortLegExcess: shortLegExcess, pass: shortLegExcess > 0 },
    megaCap: { meanSpread: megaSpread, months: megaMonths.length, pass: megaSpread > 0 },
    subPeriods: { positive, of: cfg.blocks, blockMeans, pass: positive >= BLOCKS_POSITIVE_MIN },
  };

  return {
    leg,
    months: months.length,
    ...gates,
    passed: Object.values(gates).every((g) => g.pass),
    meanSpread: mean(spread),
    tStat: tStat(spread),
    netMeanSpread: mean(netSpread),
    meanTurnover: months.length === 0 ? 0 : turnoverSum / months.length,
    bucketMeans,
  };
}
