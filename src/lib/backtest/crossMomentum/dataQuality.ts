// Data-quality screen for the cached bar series.
//
// The first study run was voided because the cache held unadjusted splits. Two
// provider fixes later (adjustment=all, and the SIP tape in place of IEX) the
// bulk of that is gone, but a residue survives that no provider flag removes:
//
//   - KLAC split 10:1 on 2026-06-12 and Alpaca did NOT back-adjust it. Alpaca
//     reports 2411.64 -> 254.54; Yahoo's adjclose reports 241.16 -> 254.54, and
//     the two agree exactly on every post-split bar. So `adjustment=all` is
//     incomplete for recent splits.
//   - PARA and FI carry long runs of zero-volume bars at a frozen price (FI sits
//     at 3.15 with v=0 for years, then prints 115.78 on 3M shares when Fiserv
//     took the ticker in 2023). Those are placeholder or reused-ticker series,
//     not prices.
//
// A contaminated bar does not spoil one month; it spoils every lookback window
// that crosses it, which for a 252-day lookback is a year of rebalances. So the
// screen excludes the whole symbol rather than the offending month, and the
// caller reports what it dropped.
//
// Pure: no fs, no env, no clock, no randomness.

import type { Candle } from "@/lib/indicators";

/**
 * Adjacent-session close ratio bounds. A properly adjusted equity does not halve
 * or double in one session; a split that escaped adjustment always does. This
 * also catches genuine one-day collapses and takeovers, which is a real cost --
 * but an excluded symbol leaves both the winner and the loser bucket, so the
 * exclusion does not push the decile spread in a known direction the way split
 * contamination did (splits load genuine winners into the loser bucket, because
 * companies split after the price runs up).
 */
export const MIN_DAILY_RATIO = 0.5;
export const MAX_DAILY_RATIO = 2.0;

/** A series more than a tenth dead is a placeholder, not a price history. */
export const MAX_ZERO_VOLUME_SHARE = 0.1;

/**
 * Typical calendar days between consecutive bars. A daily series sits at 1 (a
 * weekend pushes Friday->Monday to 3, but the median stays 1); a weekly series
 * sits at 7. DOW came back from the provider as 388 weekly bars — every one a
 * Monday — which is how bars appeared on 37 market holidays (MLK, Presidents',
 * Memorial, Labor, and the Mondays that Christmas and New Year roll onto). Those
 * phantom days entered the study's union calendar, and one of them, 2021-05-31,
 * became a month-end rebalance date on which the market was shut.
 */
export const MAX_MEDIAN_SPACING_DAYS = 4;

export type ExclusionReason =
  | "nonPositiveClose"
  | "discontinuity"
  | "staleSeries"
  | "wrongInterval";

export interface Exclusion {
  symbol: string;
  reason: ExclusionReason;
  /** Human-readable evidence: the worst offending bar, or the dead-bar share. */
  detail: string;
}

export interface ScreenResult {
  kept: Map<string, Candle[]>;
  excluded: Exclusion[];
}

const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

/**
 * Partition symbols into those safe to study and those whose bars are provably
 * broken. Order of `kept` follows the input; `excluded` is sorted by symbol so
 * the report is stable across runs.
 */
export function screenBars(bars: Map<string, Candle[]>): ScreenResult {
  const kept = new Map<string, Candle[]>();
  const excluded: Exclusion[] = [];

  for (const [symbol, series] of bars) {
    const bad = firstDefect(series);
    if (bad) excluded.push({ symbol, ...bad });
    else kept.set(symbol, series);
  }

  excluded.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return { kept, excluded };
}

function firstDefect(series: Candle[]): Omit<Exclusion, "symbol"> | null {
  if (series.length === 0) return { reason: "staleSeries", detail: "no bars" };

  const spacing = medianSpacingDays(series);
  if (spacing > MAX_MEDIAN_SPACING_DAYS) {
    return {
      reason: "wrongInterval",
      detail: `${series.length} bars spaced ${spacing.toFixed(1)} days apart — not a daily series`,
    };
  }

  let zeros = 0;
  for (const c of series) {
    if (c.c <= 0) {
      return { reason: "nonPositiveClose", detail: `close ${c.c} on ${iso(c.t)}` };
    }
    if (c.v === 0) zeros++;
  }

  // Worst discontinuity, not merely the first, so the report names the bar a
  // reader would check by hand.
  let worst: { ratio: number; i: number } | null = null;
  for (let i = 1; i < series.length; i++) {
    const ratio = series[i].c / series[i - 1].c;
    if (ratio < MIN_DAILY_RATIO || ratio > MAX_DAILY_RATIO) {
      const distance = Math.abs(Math.log(ratio));
      if (!worst || distance > Math.abs(Math.log(worst.ratio))) worst = { ratio, i };
    }
  }
  if (worst) {
    const { ratio, i } = worst;
    return {
      reason: "discontinuity",
      detail:
        `${series[i - 1].c.toFixed(2)} -> ${series[i].c.toFixed(2)} on ${iso(series[i].t)} ` +
        `(x${ratio.toFixed(4)}, ${((ratio - 1) * 100).toFixed(1)}%)`,
    };
  }

  const share = zeros / series.length;
  if (share >= MAX_ZERO_VOLUME_SHARE) {
    return {
      reason: "staleSeries",
      detail: `${zeros}/${series.length} bars (${(share * 100).toFixed(1)}%) have zero volume`,
    };
  }

  return null;
}

/** Median calendar-day gap between consecutive bars. Zero for a single bar. */
function medianSpacingDays(series: Candle[]): number {
  if (series.length < 2) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < series.length; i++) gaps.push((series[i].t - series[i - 1].t) / 86_400);
  gaps.sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  return gaps.length % 2 === 1 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}
