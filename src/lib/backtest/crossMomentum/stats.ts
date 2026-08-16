// Plain statistics, kept separate from the study so they can be tested against
// hand-computable values rather than against backtest output.

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

/** Sample standard deviation (n - 1). 0 for fewer than two observations. */
export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let sq = 0;
  for (const x of xs) sq += (x - m) ** 2;
  return Math.sqrt(sq / (xs.length - 1));
}

/**
 * mean / standard error. Reported for readers who look for it; deliberately not
 * a gate, because at N = 59 the t = 2 bar demands an annual Sharpe near 0.90
 * while published momentum spreads run 0.5-0.6.
 */
export function tStat(xs: number[]): number {
  const sd = stdev(xs);
  if (!(sd > 0)) return 0;
  return mean(xs) / (sd / Math.sqrt(xs.length));
}

/** 1-based ranks, ties sharing their average rank. */
function ranks(xs: number[]): number[] {
  const order = xs.map((_, i) => i).sort((p, q) => xs[p] - xs[q]);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && xs[order[j + 1]] === xs[order[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k]] = avg;
    i = j + 1;
  }
  return out;
}

/**
 * Spearman's rho: Pearson correlation of the ranks. Rank-based on purpose — the
 * monotonicity gate asks whether bucket returns climb in order, not whether they
 * climb linearly.
 */
export function spearman(a: number[], b: number[]): number {
  const ra = ranks(a);
  const rb = ranks(b);
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    const x = ra[i] - ma;
    const y = rb[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? 0 : num / den;
}

/**
 * Contiguous, non-overlapping blocks. Ceil boundaries push the remainder into
 * the final block, so 59 into 6 gives 10/10/10/10/10/9 rather than 9/10/10/10/10/10.
 */
export function splitBlocks<T>(xs: T[], blocks: number): T[][] {
  const out: T[][] = [];
  for (let k = 0; k < blocks; k++) {
    const lo = Math.ceil((k * xs.length) / blocks);
    const hi = Math.ceil(((k + 1) * xs.length) / blocks);
    out.push(xs.slice(lo, hi));
  }
  return out;
}

/** Fraction of `next` that was not already held. The first rebalance is all new. */
export function turnover(prev: string[] | null, next: string[]): number {
  if (next.length === 0) return 0;
  if (prev === null) return 1;
  const held = new Set(prev);
  let changed = 0;
  for (const s of next) if (!held.has(s)) changed++;
  return changed / next.length;
}
