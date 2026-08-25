// Held-out validation for a ResearchStrategy candidate: the same code, the
// same swept exit ladder, run across three later stretches of market it has
// never been shown.
//
// Rewritten 2026-08-25 (docs/PROPOSAL-panel-validation.md §1c). The previous
// version cut its "held-out" set at `last − 365d` of a 5y fetch and compared it
// against a stored summary from a 2y fetch. On AAPL those two windows overlapped
// by 1.92 years — **66% of the in-sample data was inside the held-out set**. So
// MIN_HOLDOUT_RETENTION, the gate that exists to catch a collapse between fitted
// and unfitted data, was comparing a sample against a superset of itself.
// Retention could hardly do anything but read high. That whole path is gone; it
// was not patchable, because the fault was the window policy and not the code.
//
// What replaces it, per fold, is deliberately a higher bar than "positive":
//   - everything evaluateHoldout already asked (trade floor, positive
//     expectancy, not an inverted split, PF >= 1.1, >= 50% retention), now with
//     a genuinely disjoint comparison,
//   - a participation floor, so 200 trades cannot come from eight names,
//   - the matched random-entry control, because on a universe where 69-87% of
//     names rose in every window measured, beating ZERO is beating nothing,
//   - a monthly block bootstrap, because 491 names correlated at rho 0.24-0.47
//     are nowhere near 491 independent observations.
//
// And all three folds must pass. Not their average — research-29 is why: one
// strong regime carrying two dead ones is exactly the result that reached the
// desk and lost -3.46R.
import { prisma } from "@/lib/db";
import type { BacktestSummary } from "@/lib/backtest/engine";
import {
  loadPanel, TEST_FOLDS, PANEL_SURVIVORSHIP_CAVEAT, PANEL_VALIDATION, LEGACY_VALIDATION,
  type FoldName,
} from "./panel";
import {
  evaluatePanelFold, MIN_PANEL_TRADES, MIN_PANEL_SYMBOLS, CONTROL_RUNS, BOOTSTRAP_RUNS,
  type PanelExit,
} from "./panelRun";
import { panelSignalsForCode } from "./adapter";
import type { BootstrapResult, ControlDistribution } from "./control";

// Re-exported so importers that predate the holdout.ts split keep working, and
// so "the held-out contract" stays one name to import rather than two.
export { evaluateHoldout, MIN_HOLDOUT_RETENTION } from "./holdout";
export type { HoldoutVerdict } from "./holdout";

// Same eval contract runOneCandidate() uses for every research candidate's
// panel backtest, so held-out numbers are directly comparable to the stored
// backtestSummary: lot 0.1, the candidate's own swept exit ladder (single tight
// target), the live desk's disclosed cost model.
const RESEARCH_LOT = 0.1;
// Pre-Feature-3 rows (approved before per-candidate ladders existed) have no
// exitLadder yet — fall back to the ladder every candidate used to be
// uniformly validated against.
const LEGACY_TP1_MULT = 1.2;
const LEGACY_SL_MULT = 1.5;

export interface PanelFoldReport {
  fold: FoldName;
  from: string;
  to: string;
  regime: string;
  symbolsInFold: number;
  symbolsTraded: number;
  summary: BacktestSummary;
  control: ControlDistribution | null;
  bootstrap: BootstrapResult | null;
  passed: boolean;
  reasons: string[];
}

/** The success branch of BlindTestResult, named so callers and tests can build/annotate one. */
export interface PanelBlindTestReport {
  strategy: { id: number; label: string };
  validation: typeof PANEL_VALIDATION;
  panel: { cachePath: string; fetchedAt: string; symbols: number };
  /** restated on every result, because a number that is biased is biased wherever it is read */
  caveat: string;
  bar: { minTrades: number; minSymbols: number; controlRuns: number; bootstrapRuns: number };
  /** the FIT-fold summary this was fitted to; retention is measured against it */
  fit: BacktestSummary;
  folds: PanelFoldReport[];
  passed: boolean;
  reasons: string[];
}

export type BlindTestResult = { error: string } | PanelBlindTestReport;

/** Read a candidate's swept ladder off its row, falling back to the legacy geometry for pre-ladder rows. */
function ladderFor(exitLadder: string | null): PanelExit {
  const exit: PanelExit = {
    tp1Mult: LEGACY_TP1_MULT,
    slMult: LEGACY_SL_MULT,
    singleTarget: true,
    lot: RESEARCH_LOT,
  };
  try {
    const parsed = JSON.parse(exitLadder || "{}");
    if (typeof parsed.tp1Mult === "number") {
      exit.tp1Mult = parsed.tp1Mult;
      exit.slMult = typeof parsed.slMult === "number" ? parsed.slMult : LEGACY_SL_MULT;
      // A trailing ladder must be honoured here too, or the held-out test
      // validates a geometry the desk will not trade — the candidate would be
      // measured on a fixed target and then run with a trailing stop.
      const trail = parsed.trail;
      if (trail && typeof trail.activateMult === "number" && typeof trail.offsetMult === "number") {
        exit.trail = { activateMult: trail.activateMult, offsetMult: trail.offsetMult };
      }
    }
  } catch {
    // malformed JSON — fall back to the legacy ladder
  }
  return exit;
}

/** Run a ResearchStrategy's own code across all three TEST folds and judge it. */
export async function runBlindTest(strategyId: number): Promise<BlindTestResult> {
  const strategy = await prisma.researchStrategy.findUnique({ where: { id: strategyId } });
  if (!strategy) return { error: `research-${strategyId}: not found` };
  if (strategy.safetyFlag) return { error: `research-${strategyId}: failed safety scan — cannot blind-test` };

  let fit: BacktestSummary;
  try {
    fit = JSON.parse(strategy.backtestSummary || "{}");
  } catch {
    return { error: `research-${strategyId}: stored backtestSummary is not valid JSON` };
  }
  // A legacy row's backtestSummary came from one symbol over a sliding window.
  // Running it through the panel gate would silently compare a panel fold
  // against a single-symbol baseline and call the ratio "retention". Such a row
  // has to be re-run through a panel round to be validated at all — refusing is
  // the honest answer, and applyBlindTestVerdict turns it into a rejection.
  if (strategy.validation !== PANEL_VALIDATION) {
    return {
      error:
        `research-${strategyId} carries validation="${strategy.validation ?? LEGACY_VALIDATION}" — its stored summary ` +
        `came from a single symbol on a self-overlapping window and is not comparable to a panel fold. ` +
        `Re-run it as a manual candidate through runResearch() to get a ${PANEL_VALIDATION} baseline.`,
    };
  }

  let panel: ReturnType<typeof loadPanel>;
  try {
    panel = loadPanel();
  } catch (e) {
    return { error: `research-${strategyId}: ${e instanceof Error ? e.message : String(e)}` };
  }

  let signalsFor: ReturnType<typeof panelSignalsForCode>;
  try {
    signalsFor = panelSignalsForCode(strategy.code);
  } catch (e) {
    return { error: `research-${strategyId}: code failed to compile for the held-out run — ${e instanceof Error ? e.message : String(e)}` };
  }

  const exit = ladderFor(strategy.exitLadder);
  const folds: PanelFoldReport[] = [];
  const reasons: string[] = [];

  for (const fold of TEST_FOLDS) {
    const result = evaluatePanelFold(panel, fold, signalsFor, exit, fit);
    folds.push({
      fold: fold.name,
      from: fold.from,
      to: fold.to,
      regime: fold.regime,
      symbolsInFold: result.run.symbolsInFold,
      symbolsTraded: result.run.symbolsTraded,
      summary: result.run.summary,
      control: result.control,
      bootstrap: result.bootstrap,
      passed: result.verdict.passed,
      reasons: result.verdict.reasons,
    });
    for (const r of result.verdict.reasons) reasons.push(`[${fold.name} ${fold.from}..${fold.to}] ${r}`);
  }

  // Every fold, not the average of them. See this file's header.
  const passed = folds.length === TEST_FOLDS.length && folds.every((f) => f.passed);

  return {
    strategy: { id: strategy.id, label: strategy.label },
    validation: PANEL_VALIDATION,
    panel: { cachePath: panel.cachePath, fetchedAt: panel.fetchedAt, symbols: panel.symbols.length },
    caveat: PANEL_SURVIVORSHIP_CAVEAT,
    bar: {
      minTrades: MIN_PANEL_TRADES,
      minSymbols: MIN_PANEL_SYMBOLS,
      controlRuns: CONTROL_RUNS,
      bootstrapRuns: BOOTSTRAP_RUNS,
    },
    fit,
    folds,
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
