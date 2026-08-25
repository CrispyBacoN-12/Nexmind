// The two statistical instruments the panel gate rests on: a matched
// random-entry control, and a monthly block bootstrap.
//
// Both exist because of one measurement (docs/PROPOSAL-panel-validation.md §1b):
// across every window in the bar cache, between 69% and 87% of S&P 500 names
// finished up, and their daily returns are correlated at rho 0.24-0.47. Those
// two numbers between them break the naive reading of a panel backtest:
//
//   - Because most names rise, a long-biased rule earns a positive avgR from
//     beta alone. "Expectancy > 0" measures the market, not the strategy. Hence
//     the CONTROL: the same number of entries, on the same symbols, in the same
//     fold, with the same exit geometry and the same long/short mix — placed at
//     random. The strategy has to beat the distribution of that.
//
//   - Because names move together, trades are not independent draws. A
//     per-trade bootstrap would treat 8,000 correlated trades as 8,000
//     observations and report a standard error roughly sqrt(N_eff/N) too small.
//     Hence the BLOCK bootstrap over calendar months, resampling every symbol's
//     trades in a sampled month together, which keeps the cross-sectional
//     correlation intact instead of shuffling it away.
//
// Pure and deterministic: seeded RNG, no I/O, no Date.now(). Same seed and same
// inputs give the same verdict, which is what makes a pre-registered bar
// enforceable rather than decorative.

import { WARMUP, type EntrySignals, type SimTrade } from "@/lib/backtest/engine";

/** mulberry32 — small, fast, and good enough for resampling. Seeded, so runs reproduce. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Linear-interpolated percentile of an ASCENDING-sorted array. p in [0,1]. */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * Math.min(Math.max(p, 0), 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Replace a symbol's entry signals with the same NUMBER of entries, carrying the
 * same long/short mix, placed uniformly at random over the bars the real rule
 * was allowed to fire on.
 *
 * `atrs` is passed through untouched: the control gets the real volatility of
 * the bar it lands on, so its stops and targets are the same width the strategy
 * would have used there. Anything else would make it a control for two
 * variables at once.
 *
 * The side multiset is permuted rather than resampled, so a rule that took 30
 * longs and 2 shorts is compared against controls that take exactly 30 longs
 * and 2 shorts. Directional exposure is the thing being controlled for; leaving
 * it to chance would put it back in the estimate.
 *
 * Matched on signals, not on filled trades: one-position-per-symbol means some
 * signals land inside an open position and never become trades. That is true of
 * the strategy and of the control alike, and it is a property of the exit
 * geometry both are running, so the counts stay comparable.
 */
export function matchedRandomSignals(signals: EntrySignals, entryFrom: number, rng: () => number): EntrySignals {
  const n = signals.sides.length;
  const start = Math.max(WARMUP, entryFrom);

  const sides: ("long" | "short" | null)[] = [];
  for (let i = start; i < n; i++) {
    const s = signals.sides[i];
    if (s) sides.push(s);
  }

  const out: ("long" | "short" | null)[] = new Array(n).fill(null);
  const eligible = n - start;
  if (!sides.length || eligible <= 0) return { sides: out, atrs: signals.atrs };

  // Fisher-Yates on the side multiset, then rejection-sample distinct slots.
  // k is a few dozen against a few hundred eligible bars, so collisions are rare
  // and rejection sampling beats materialising and shuffling the index array.
  for (let i = sides.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [sides[i], sides[j]] = [sides[j], sides[i]];
  }

  const k = Math.min(sides.length, eligible);
  const taken = new Set<number>();
  let guard = 0;
  const maxAttempts = k * 50 + 1000;
  while (taken.size < k && guard++ < maxAttempts) {
    const idx = start + Math.floor(rng() * eligible);
    if (taken.has(idx)) continue;
    taken.add(idx);
    out[idx] = sides[taken.size - 1];
  }
  // Degenerate fallback: k is a large fraction of eligible and rejection sampling
  // stalled. Fill forward from the first free slot so the count still matches.
  if (taken.size < k) {
    for (let i = start; i < n && taken.size < k; i++) {
      if (taken.has(i)) continue;
      taken.add(i);
      out[i] = sides[taken.size - 1];
    }
  }

  return { sides: out, atrs: signals.atrs };
}

export interface ControlDistribution {
  runs: number;
  /** avgR of each control run, ascending */
  avgRs: number[];
  median: number;
  p95: number;
}

export function summarizeControl(avgRs: number[]): ControlDistribution | null {
  const clean = avgRs.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!clean.length) return null;
  return { runs: clean.length, avgRs: clean, median: percentile(clean, 0.5), p95: percentile(clean, 0.95) };
}

export interface BootstrapResult {
  runs: number;
  /** distinct calendar months the trades span — this, not the trade count, is the real sample size */
  blocks: number;
  p5: number;
  p50: number;
  p95: number;
}

type BootstrapTrade = Pick<SimTrade, "openedAt" | "rMultiple">;

/**
 * Resample calendar months with replacement and report the spread of avgR.
 *
 * The month a trade was OPENED in is the block key — that is when the bet was
 * placed, and it is the market state the trade is a draw from. Every symbol's
 * trades in a sampled month come along together, which is the whole point: it
 * preserves the fact that in March 2020 essentially everything moved as one.
 *
 * Returns null when there is nothing to resample — fewer than two distinct
 * months, or no trades carrying an R-multiple. A caller must treat null as
 * "unverified", never as "passed".
 */
export function monthlyBlockBootstrap(
  trades: BootstrapTrade[],
  runs: number,
  rng: () => number,
): BootstrapResult | null {
  const sums = new Map<string, { sum: number; count: number }>();
  for (const t of trades) {
    if (t.rMultiple == null || !Number.isFinite(t.rMultiple)) continue;
    const d = t.openedAt instanceof Date ? t.openedAt : new Date(t.openedAt);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const cur = sums.get(key);
    if (cur) {
      cur.sum += t.rMultiple;
      cur.count += 1;
    } else {
      sums.set(key, { sum: t.rMultiple, count: 1 });
    }
  }

  const blocks = [...sums.values()];
  if (blocks.length < 2) return null;

  const means: number[] = [];
  for (let r = 0; r < runs; r++) {
    let sum = 0;
    let count = 0;
    for (let b = 0; b < blocks.length; b++) {
      const pick = blocks[Math.floor(rng() * blocks.length)];
      sum += pick.sum;
      count += pick.count;
    }
    if (count > 0) means.push(sum / count);
  }
  if (!means.length) return null;

  means.sort((a, b) => a - b);
  return {
    runs: means.length,
    blocks: blocks.length,
    p5: percentile(means, 0.05),
    p50: percentile(means, 0.5),
    p95: percentile(means, 0.95),
  };
}
