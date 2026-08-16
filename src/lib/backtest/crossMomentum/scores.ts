// Both pre-registered score definitions, computed together because they share a
// window and a data-availability check. Everything reads bar indices <= i - skip,
// which is what makes the ranking causal.
import type { Candle } from "@/lib/indicators";

export interface MomentumScores {
  /** Classic 12-1: the return over the window, skipping the most recent month. */
  raw: number;
  /** The same return divided by the window's daily-return sigma. */
  volAdj: number;
}

/**
 * Momentum at bar `i`, or `null` when the bar cannot support it. `null` IS the
 * eligibility answer — there is no separate predicate to fall out of step with
 * this one.
 *
 * The window runs from `i - skip - lookback` to `i - skip` inclusive, so the
 * bar needs `lookback + skip` bars behind it (273 at the pinned values).
 */
export function momentumScores(
  candles: Candle[],
  i: number,
  lookback: number,
  skip: number,
): MomentumScores | null {
  const end = i - skip;
  const start = end - lookback;
  if (start < 0 || i >= candles.length) return null;

  const from = candles[start].c;
  const to = candles[end].c;
  if (!(from > 0) || !(to > 0)) return null;
  const raw = to / from - 1;

  // `lookback` daily returns across the same window. The loop starts at
  // start + 1 because each return needs its own previous close, which is why
  // the window is anchored at `start` rather than `start + 1`.
  const rets: number[] = [];
  let sum = 0;
  for (let k = start + 1; k <= end; k++) {
    const prev = candles[k - 1].c;
    if (!(prev > 0) || !(candles[k].c > 0)) return null;
    const r = candles[k].c / prev - 1;
    rets.push(r);
    sum += r;
  }
  if (rets.length < 2) return null;

  const m = sum / rets.length;
  let sq = 0;
  for (const r of rets) sq += (r - m) ** 2;
  const sigma = Math.sqrt(sq / (rets.length - 1));
  // A zero-variance window would divide to Infinity and sort to the top of every
  // ranking. Ineligible is the honest answer.
  if (!(sigma > 0)) return null;

  return { raw, volAdj: raw / sigma };
}
