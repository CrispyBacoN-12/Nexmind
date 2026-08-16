// The null hypothesis, made concrete: what spread would this cross-section have
// produced if the ranking carried no information at all? Shuffling the scores
// against fixed returns destroys the score-return link and nothing else — the
// eligible set, the realized returns, and the time-series structure survive
// untouched, which is what makes the comparison fair.
import { bucketize, meanAt } from "./deciles";
import { mulberry32, shuffle } from "./rng";
import { mean } from "./stats";
import type { ScoreLeg, Snapshot } from "./types";

function spreadFrom(scores: number[], returns: number[], buckets: number): number {
  const groups = bucketize(scores, buckets);
  return meanAt(returns, groups[buckets - 1]) - meanAt(returns, groups[0]);
}

/** Top-minus-bottom spread, one observation per rebalance. */
export function spreadSeries(snapshots: Snapshot[], leg: ScoreLeg, buckets: number): number[] {
  return snapshots.map((s) => spreadFrom(s.scores[leg], s.returns, buckets));
}

export interface PermutationResult {
  /** (1 + #{null >= observed}) / (iterations + 1). Never exactly zero. */
  p: number;
  observed: number;
  /** Mean of the null distribution — should sit near zero. */
  nullMean: number;
}

export function permutationPValue(
  snapshots: Snapshot[],
  leg: ScoreLeg,
  buckets: number,
  iterations: number,
  seed: number,
): PermutationResult {
  const observed = mean(spreadSeries(snapshots, leg, buckets));
  const rand = mulberry32(seed);
  const nullMeans: number[] = [];
  let atLeast = 0;

  for (let b = 0; b < iterations; b++) {
    let sum = 0;
    for (const snap of snapshots) {
      // Copy before shuffling: the caller's snapshots are shared across legs,
      // the mega-cap run, and every later iteration.
      sum += spreadFrom(shuffle([...snap.scores[leg]], rand), snap.returns, buckets);
    }
    const m = sum / snapshots.length;
    nullMeans.push(m);
    if (m >= observed) atLeast++;
  }

  return { p: (1 + atLeast) / (iterations + 1), observed, nullMean: mean(nullMeans) };
}
