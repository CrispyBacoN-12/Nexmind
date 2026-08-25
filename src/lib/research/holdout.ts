// The pure overfit tells, applied to an in-sample summary and a held-out one.
//
// Split out of blindTest.ts so the panel gate (research/panelRun.ts) can reuse
// these checks verbatim rather than restating them — a restated copy is a copy
// that drifts, and the one thing this gate must never do is quietly become
// weaker than the single-symbol gate it replaces. blindTest.ts re-exports
// everything here, so existing importers are unaffected.
//
// Pure: no prisma, no network, no I/O.

import type { BacktestSummary } from "@/lib/backtest/engine";
import { MIN_TRADES, MIN_PROFIT_FACTOR } from "./autoReview";

export interface HoldoutVerdict {
  passed: boolean;
  reasons: string[];
}

/**
 * Minimum fraction of the in-sample edge the held-out half must keep.
 *
 * Pre-registered on 2026-08-25 *before* looking at any further candidate, which
 * is the only way this number means anything — pick it after and it is fitted to
 * whatever was on screen. 0.5 is the conventional walk-forward bar (out-of-sample
 * at least half of in-sample), chosen for being conventional rather than derived
 * from this project's data.
 *
 * Some decay is expected and fine: the in-sample half is the fitted one. What the
 * bar is aimed at is the case that motivated it — a candidate that went from
 * in-sample avgR 0.63 to held-out 0.063, a 10x collapse, and still passed a gate
 * that asked only "is held-out expectancy above zero?".
 */
export const MIN_HOLDOUT_RETENTION = 0.5;

type RetentionInput = Pick<BacktestSummary, "expectancy" | "avgR">;

/**
 * Which metric the degradation test compares, and its two values.
 *
 * avgR is preferred because dollar expectancy scales with the ATR level of the
 * period it was measured over: a quieter held-out year produces a smaller dollar
 * expectancy for an identical edge, which would read as decay that is not there.
 * That is the same argument that led to risk-normalising `score()` in the
 * exit-geometry sweep. Rows persisted before avgR existed fall back to
 * expectancy, so this is a fallback rather than a second opinion.
 */
function retentionMetric(
  inSample: RetentionInput,
  holdout: RetentionInput,
): { name: "avgR" | "expectancy"; before: number; after: number } | null {
  if (inSample.avgR != null && holdout.avgR != null) {
    return { name: "avgR", before: inSample.avgR, after: holdout.avgR };
  }
  if (inSample.expectancy != null && holdout.expectancy != null) {
    return { name: "expectancy", before: inSample.expectancy, after: holdout.expectancy };
  }
  return null;
}

/** Pure — the overfit tells, applied to an in-sample summary + a held-out summary. */
export function evaluateHoldout(
  inSample: Pick<BacktestSummary, "expectancy" | "avgR">,
  holdout: BacktestSummary,
  minTrades: number = MIN_TRADES,
): HoldoutVerdict {
  const reasons: string[] = [];

  if (holdout.trades < minTrades) {
    reasons.push(`too few held-out trades (${holdout.trades} < ${minTrades}) — result is statistical noise, not a validated edge`);
  }

  const holdoutPositive = holdout.expectancy != null && holdout.expectancy > 0;
  if (!holdoutPositive) {
    reasons.push(`held-out expectancy is not positive (${holdout.expectancy ?? "n/a"})`);
  }

  const inSamplePositive = inSample.expectancy != null && inSample.expectancy > 0;
  if (holdoutPositive && !inSamplePositive) {
    reasons.push(
      `inverted train/test split — in-sample was net-negative while held-out looks positive; this pattern has been a fluke every time it's shown up (e.g. combo-gold), not a real edge`,
    );
  }

  // The same profit-factor bar autoReview already applies in-sample. A gate that
  // demands PF >= 1.1 of the fitted half and nothing of the held-out half is
  // asking the easy question twice. null means zero losing trades — strictly
  // better than any finite ratio — so only a finite-and-low ratio disqualifies,
  // the same reading autoReviewStatus uses.
  if (holdout.profitFactor != null && holdout.profitFactor < MIN_PROFIT_FACTOR) {
    reasons.push(
      `held-out profit factor ${holdout.profitFactor.toFixed(2)} is below the ${MIN_PROFIT_FACTOR} bar autoReview already requires in-sample`,
    );
  }

  // Degradation ceiling. Only meaningful when in-sample was positive (the
  // inverted-split branch above covers the other case) and held-out is positive
  // (otherwise it is already rejected and a retention figure would just be a
  // second reason for the same fact).
  const metric = retentionMetric(inSample, holdout);
  if (metric && metric.before > 0 && holdoutPositive) {
    const retention = metric.after / metric.before;
    if (retention < MIN_HOLDOUT_RETENTION) {
      const fmt = (v: number) => (metric.name === "avgR" ? v.toFixed(3) : v.toFixed(2));
      reasons.push(
        `held-out ${metric.name} kept only ${Math.round(retention * 100)}% of in-sample ` +
          `(${fmt(metric.before)} → ${fmt(metric.after)}); the floor is ${Math.round(MIN_HOLDOUT_RETENTION * 100)}% — ` +
          `a collapse this size is the overfit signature, not decay`,
      );
    }
  }

  return { passed: reasons.length === 0, reasons };
}
