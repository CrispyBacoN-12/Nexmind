// Pearson correlation of daily returns — used to dampen position size when a
// new trade would stack exposure that already moves with open positions.
// Pure — operates on candle arrays already fetched by the caller.

import type { Candle } from "@/lib/indicators";

/** Daily % returns from a candle series (close-to-close). */
export function dailyReturns(candles: Candle[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].c;
    const curr = candles[i].c;
    if (prev !== 0) out.push((curr - prev) / prev);
  }
  return out;
}

/**
 * Pearson correlation of two return series, trimmed to the same trailing
 * length (most recent N points of each — an approximation, not date-aligned).
 * Returns null if either series has fewer than 5 points after trimming, or
 * if either series has zero variance.
 */
export function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 5) return null;

  const x = xs.slice(xs.length - n);
  const y = ys.slice(ys.length - n);

  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0 || varY === 0) return null;

  return cov / Math.sqrt(varX * varY);
}
