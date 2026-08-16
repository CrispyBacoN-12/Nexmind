// Shapes for the cross-sectional momentum decile study. No logic here.

/** Which pre-registered score definition a computation is running against. */
export type ScoreLeg = "raw" | "volAdj";

export interface MomentumConfig {
  /** Trading days in the momentum window. */
  lookback: number;
  /** Trading days between the end of the window and the ranking bar. */
  skip: number;
  /** How many buckets the eligible cross-section is split into. */
  buckets: number;
  /** A rebalance date is skipped entirely below this many eligible symbols. */
  minEligible: number;
  /** One-way execution cost in basis points. Reported, never gated. */
  costBps: number;
  /** Seed for the permutation null. The module has no other randomness. */
  seed: number;
  /** Permutation iterations. */
  iterations: number;
  /** Contiguous sub-period blocks for the consistency gate. */
  blocks: number;
}

/**
 * One monthly rebalance, with every bar-level computation already done. Both
 * score legs live here because they share eligibility and realized returns;
 * computing them together means the bar work happens once.
 *
 * `symbols`, `scores.raw`, `scores.volAdj`, and `returns` are index-aligned.
 */
export interface Snapshot {
  /** Day key of the ranking date (the last union trading day of the month). */
  day: number;
  symbols: string[];
  scores: { raw: number[]; volAdj: number[] };
  /** Realized open-to-open return over the following month. */
  returns: number[];
}

/** One rebalance, summarised for a single leg. */
export interface BucketMonth {
  day: number;
  /** Index 0 is the lowest score (losers); the last index the highest (winners). */
  bucketReturns: number[];
  bucketSymbols: string[][];
  /** Equal-weight mean return of every eligible symbol that month. */
  universeReturn: number;
  eligible: number;
}

export interface GateReport {
  leg: ScoreLeg;
  months: number;
  monotonicity: { rho: number; pass: boolean };
  permutation: { p: number; pass: boolean };
  crossDefinition: { otherMeanSpread: number; pass: boolean };
  notTopOnly: { meanShortLegExcess: number; pass: boolean };
  megaCap: { meanSpread: number; months: number; pass: boolean };
  subPeriods: { positive: number; of: number; blockMeans: number[]; pass: boolean };
  /** Every gate passed. An AND, never a score to total up. */
  passed: boolean;
  // Reported, not gated.
  meanSpread: number;
  tStat: number;
  netMeanSpread: number;
  meanTurnover: number;
  bucketMeans: number[];
}
