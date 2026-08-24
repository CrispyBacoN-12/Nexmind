// Deep-data held-out validation for a ResearchStrategy candidate. Folds the
// AI research loop into the same rigor the quant sweep harness sessions
// established for manually-explored mechanisms (see the project's quant
// sweep memory / docs/superpowers): a hard floor on held-out trade count,
// and a check that the in-sample half was also positive — a result that's
// only positive on the held-out side (an inverted train/test split) has
// been a fluke every time it's shown up (e.g. the combo-gold "PF 3.25"
// headline that rested on ~18 total trades), not a real edge.
//
// Replaces hand-writing a fresh blind-test-*.mts script per candidate: any
// ResearchStrategy id can now be validated with runBlindTest(id).
import { prisma } from "@/lib/db";
import { fetchCandles } from "@/lib/marketData";
import { backtestCandles, summarizeBacktest, DEFAULT_COST_MODEL, type BacktestSummary, type EntryRule } from "@/lib/backtest/engine";
import type { Interval } from "@/lib/yahoo";
import { computeSnapshots } from "./adapter";
import { compileStrategy } from "./sandbox";
import { MIN_TRADES, MIN_PROFIT_FACTOR } from "./autoReview";

// Deep-history ranges to try, in order, until one yields enough bars to
// leave a meaningful held-out segment after the 365-day cutoff.
const DEEP_RANGES = ["5y", "2y"] as const;
const MIN_TOTAL_DAYS = 400; // must meaningfully exceed the 365-day holdout cutoff
const MIN_HOLDOUT_BARS = 100;
const HOLDOUT_CUTOFF_DAYS = 365;

// Same eval contract runOneCandidate() uses for every research candidate's
// in-sample backtest, so held-out numbers are directly comparable to the
// stored backtestSummary: lot 0.1, the candidate's own swept exit ladder
// (single tight target), the live desk's disclosed cost model.
const RESEARCH_LOT = 0.1;
// Pre-Feature-3 rows (approved before per-candidate ladders existed) have no
// exitLadder yet — fall back to the ladder every candidate used to be
// uniformly validated against.
const LEGACY_TP1_MULT = 1.2;
const LEGACY_SL_MULT = 1.5;

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

export type BlindTestResult =
  | { error: string }
  | {
      strategy: { id: number; label: string };
      symbol: string;
      range: (typeof DEEP_RANGES)[number];
      totalBars: number;
      holdoutBars: number;
      holdoutDays: number;
      inSample: BacktestSummary;
      holdout: BacktestSummary;
      passed: boolean;
      reasons: string[];
    };

/** Fetch+backtest a ResearchStrategy's own code against deep held-out history and judge it. */
export async function runBlindTest(strategyId: number): Promise<BlindTestResult> {
  const strategy = await prisma.researchStrategy.findUnique({ where: { id: strategyId }, include: { run: true } });
  if (!strategy) return { error: `research-${strategyId}: not found` };
  if (strategy.safetyFlag) return { error: `research-${strategyId}: failed safety scan — cannot blind-test` };

  let inSample: BacktestSummary;
  try {
    inSample = JSON.parse(strategy.backtestSummary || "{}");
  } catch {
    return { error: `research-${strategyId}: stored backtestSummary is not valid JSON` };
  }

  const symbol = strategy.run.symbol;
  const interval = strategy.run.interval as Interval;

  let bars: Awaited<ReturnType<typeof fetchCandles>>["candles"] | null = null;
  let usedRange: (typeof DEEP_RANGES)[number] | null = null;
  // Why each range was rejected. The old code swallowed this: a provider
  // outage, a Yahoo 422 (it refuses 5y at an intraday granularity), a
  // newly-listed symbol and a silently-truncated response all produced the
  // same "could not fetch enough deep history" string. Since the verdict for
  // all four is a fail-closed *rejection* of the candidate, the message has to
  // say which one happened or the gate is unfalsifiable from the outside.
  const attempts: string[] = [];
  for (const range of DEEP_RANGES) {
    try {
      // minDays: a provider that caps its response (Webull truncates every
      // request to 1200 bars) must count as a miss here, not as data — at 1h
      // that cap is ~256 calendar days, which can never clear MIN_TOTAL_DAYS
      // no matter which range is asked for, so without this the gate rejects
      // every intraday candidate forever and looks like rigor while doing it.
      const resp = await fetchCandles(symbol, range, interval, MIN_TOTAL_DAYS);
      if (!resp.candles.length) {
        attempts.push(`${range}: no candles returned`);
        continue;
      }
      const totalDays = (resp.candles[resp.candles.length - 1].t - resp.candles[0].t) / 86400;
      if (totalDays >= MIN_TOTAL_DAYS) {
        bars = resp.candles;
        usedRange = range;
        break;
      }
      attempts.push(`${range}: only ${Math.round(totalDays)}d of history (${resp.candles.length} bars)`);
    } catch (e) {
      attempts.push(`${range}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!bars || !usedRange) {
    return {
      error: `${symbol} @ ${interval}: could not fetch enough deep history (need >=${MIN_TOTAL_DAYS} days) for a held-out test — ${attempts.join("; ")}`,
    };
  }

  const cutoffTs = bars[bars.length - 1].t - HOLDOUT_CUTOFF_DAYS * 86400;
  const holdoutBars = bars.filter((b) => b.t < cutoffTs);
  if (holdoutBars.length < MIN_HOLDOUT_BARS) {
    return { error: `${symbol}: held-out segment too small (${holdoutBars.length} bars)` };
  }

  const snaps = computeSnapshots(holdoutBars);
  const compiled = compileStrategy(strategy.code);
  const entry: EntryRule = (i) => compiled.invoke(holdoutBars, snaps, i)?.side ?? null;

  let ladderTp1Mult = LEGACY_TP1_MULT;
  let ladderSlMult = LEGACY_SL_MULT;
  // A trailing ladder must be honoured here too, or the held-out test validates
  // a geometry the desk will not trade — the candidate would be measured on a
  // fixed 2.5 ATR target and then run with a trailing stop.
  let ladderTrail: { activateMult: number; offsetMult: number } | undefined;
  try {
    const parsed = JSON.parse(strategy.exitLadder || "{}");
    if (typeof parsed.tp1Mult === "number") {
      ladderTp1Mult = parsed.tp1Mult;
      ladderSlMult = typeof parsed.slMult === "number" ? parsed.slMult : LEGACY_SL_MULT;
      const trail = parsed.trail;
      if (trail && typeof trail.activateMult === "number" && typeof trail.offsetMult === "number") {
        ladderTrail = { activateMult: trail.activateMult, offsetMult: trail.offsetMult };
      }
    }
  } catch {
    // malformed JSON — fall back to the legacy ladder
  }

  const bt = backtestCandles(symbol, holdoutBars, RESEARCH_LOT, undefined, entry, true, ladderTp1Mult, DEFAULT_COST_MODEL, ladderSlMult, ladderTrail);
  const holdout = summarizeBacktest(bt.trades);
  const holdoutDays = (holdoutBars[holdoutBars.length - 1].t - holdoutBars[0].t) / 86400;

  const { passed, reasons } = evaluateHoldout(inSample, holdout);

  return {
    strategy: { id: strategy.id, label: strategy.label },
    symbol,
    range: usedRange,
    totalBars: bars.length,
    holdoutBars: holdoutBars.length,
    holdoutDays,
    inSample,
    holdout,
    passed,
    reasons,
  };
}

/**
 * Pure decision layer between a blind-test run and the persisted status.
 * Lean conservative: a candidate whose held-out data could not be fetched or
 * validated (the `{ error }` branch of BlindTestResult) does not get to trade
 * live on an unverified in-sample claim — it is rejected, not left approved.
 * A candidate that was already rejected in-sample never reaches this path in
 * practice (runResearch only calls runBlindTest for in-sample approvals), but
 * this stays a total function over both inputs rather than assuming that.
 */
export function applyBlindTestVerdict(
  inSampleStatus: "approved" | "rejected",
  verdict: BlindTestResult,
): { status: "approved" | "rejected"; blindTestJson: string } {
  if (inSampleStatus !== "approved") {
    return { status: inSampleStatus, blindTestJson: JSON.stringify(verdict) };
  }
  if ("error" in verdict) {
    return {
      status: "rejected",
      blindTestJson: JSON.stringify({
        error: verdict.error,
        reasons: [
          `Lean conservative: a candidate whose held-out data we could not fetch/validate does not get to trade live on an unverified claim. (${verdict.error})`,
        ],
      }),
    };
  }
  return { status: verdict.passed ? "approved" : "rejected", blindTestJson: JSON.stringify(verdict) };
}

/**
 * What to persist when the runBlindTest()/update() sequence around an
 * in-sample approval throws instead of producing a BlindTestResult (e.g. a
 * Neon connection hiccup on the shared serverless DB) — as opposed to
 * runBlindTest() returning its normal `{ error }` result. Fails closed the
 * same way applyBlindTestVerdict's `{ error }` branch does: a candidate whose
 * blind test could not be completed does not get to stay "approved" with an
 * empty blindTest column indistinguishable from a real pass.
 */
export function blindTestOrchestrationFailure(err: unknown): { status: "approved" | "rejected"; blindTestJson: string } {
  const message = err instanceof Error ? err.message : String(err);
  return applyBlindTestVerdict("approved", { error: `blind-test orchestration threw: ${message}` });
}
