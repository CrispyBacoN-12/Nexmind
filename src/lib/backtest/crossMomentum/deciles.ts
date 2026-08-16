// Turning a scored cross-section into equal-weight buckets. Bucket 0 is always
// the LOWEST score; the last bucket the highest. Every sign downstream depends
// on that, so it is stated here and nowhere overridden.
import type { BucketMonth, ScoreLeg, Snapshot } from "./types";

/**
 * Half-open [lo, hi) index ranges tiling 0..n. Using floor on both edges means
 * consecutive bounds share an endpoint, so the ranges neither gap nor overlap
 * and any remainder is spread across buckets rather than dropped.
 */
export function bucketBounds(n: number, buckets: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let k = 0; k < buckets; k++) {
    out.push([Math.floor((k * n) / buckets), Math.floor(((k + 1) * n) / buckets)]);
  }
  return out;
}

/** Indices into `scores`, grouped into `buckets` groups by ascending score. */
export function bucketize(scores: number[], buckets: number): number[][] {
  const order = scores.map((_, i) => i).sort((a, b) => scores[a] - scores[b]);
  return bucketBounds(scores.length, buckets).map(([lo, hi]) => order.slice(lo, hi));
}

/** Equal-weight mean of `values` at `indices`; 0 for an empty selection. */
export function meanAt(values: number[], indices: number[]): number {
  if (indices.length === 0) return 0;
  let sum = 0;
  for (const i of indices) sum += values[i];
  return sum / indices.length;
}

export function bucketMonth(snap: Snapshot, leg: ScoreLeg, buckets: number): BucketMonth {
  const groups = bucketize(snap.scores[leg], buckets);
  const all = snap.returns.map((_, i) => i);
  return {
    day: snap.day,
    bucketReturns: groups.map((g) => meanAt(snap.returns, g)),
    bucketSymbols: groups.map((g) => g.map((i) => snap.symbols[i])),
    universeReturn: meanAt(snap.returns, all),
    eligible: snap.symbols.length,
  };
}

/** Top bucket minus bottom bucket — winners minus losers. */
export function spreadOf(month: BucketMonth): number {
  const r = month.bucketReturns;
  return r[r.length - 1] - r[0];
}
