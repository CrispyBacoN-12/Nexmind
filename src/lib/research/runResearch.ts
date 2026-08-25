// QUANT's orchestrator: brief → 3 candidate strategies → safety scan → panel
// backtest on FIT → up to 2 refinement rounds each → ladder sweep on FIT →
// approve/reject on SELECT → held-out panel test → persisted for human review.
// Structural mirror of runPipeline() in src/lib/pipeline/secretary.ts.
//
// Rewired to the panel on 2026-08-25 (docs/PROPOSAL-panel-validation.md). What
// changed and why, because the shape of this file only makes sense with it:
//
//   Before: every candidate was fitted, swept, and approved on ONE symbol's
//   bars, fetched live. Measured result across 128 non-mock candidates: a
//   median of 4 trades on daily bars, of which exactly one ever cleared
//   MIN_TRADES = 20. The loop was not producing weak verdicts, it was producing
//   no verdict at all — and then a "held-out" test that overlapped its own
//   training window by 66% signed off on whatever survived.
//
//   Now: 491 cached symbols, and the three jobs a research loop conflates are
//   given three disjoint stretches of time. FIT (2016-2018) is where code is
//   written and the exit ladder is chosen. SELECT (2019) is where approve/reject
//   is decided. The three TEST folds (2020-2026) are touched exactly once, by
//   blindTest.ts, and nothing in this file may look at them. Fitting on FIT and
//   deciding on SELECT is not a formality: the ladder sweep tries 8 geometries
//   and keeps the best, which is 8 chances to fit noise, and the fold that
//   catches that has to be one the sweep never saw.
//
// The provider API is no longer touched at research time. Bars come from
// .cache/bars/sp500-1d.json, whose fetchedAt is stamped into every verdict, so
// a round is reproducible from the cache alone rather than from whatever the
// provider happened to return that morning.

import { prisma } from "@/lib/db";
import { summarizeBacktest, DEFAULT_COST_MODEL, type BacktestSummary, type CostModel } from "@/lib/backtest/engine";
import { compileStrategy, SandboxSafetyError } from "./sandbox";
import { panelSignalsForCode } from "./adapter";
import { proposeCandidates, refineCandidate, fixUnsafeCode, type Candidate } from "./propose";
import { exportStrategyNote } from "@/lib/obsidian/export";
import { autoReviewStatus, MIN_TRADES } from "./autoReview";
import { runBlindTest, applyBlindTestVerdict, blindTestOrchestrationFailure } from "./blindTest";
import { loadPanel, FIT_FOLD, SELECT_FOLD, PANEL_VALIDATION, type Fold } from "./panel";
import {
  sliceFold, withSignals, simulateFold, MIN_PANEL_TRADES,
  type FoldSliceRow, type PreparedSymbol,
} from "./panelRun";
import type { AiBackend } from "@/lib/anthropic";

export const MAX_CANDIDATES = 3;
export const MAX_REFINEMENT_ROUNDS = 2;
export const MAX_RETRIES_PER_SAFETY_FAIL = 1;
export const COST_CIRCUIT_BREAKER_USD = 2;

// Same disclosed cost assumption used by the live paper desk (DEFAULT_COST_MODEL)
// so a candidate's research-time numbers and its post-approval live numbers are
// judged against identical friction — see that constant's comment for the
// rationale.
export const RESEARCH_COST_MODEL: CostModel = DEFAULT_COST_MODEL;

// What a panel round records on its ResearchRun row. The columns predate the
// panel and still describe one symbol over one range; filling them with the
// caller's old "AAPL 1d/2y" would make every row claim a per-symbol backtest
// that no longer happens. These three values say what actually ran.
export const PANEL_RUN_SYMBOL = "SP500-PANEL";
export const PANEL_RUN_INTERVAL = "1d";
export const PANEL_RUN_RANGE = "fit:2016-2018";

// Every research candidate's own validated exit ladder, swept once after
// refinement finishes (not per refinement round — refinement rounds compare
// candidates against each other under the SAME fixed ladder below, so a
// round's improvement is judged independent of ladder choice; only once the
// code is locked in does each candidate get its own ratio). Fixed SL, varying
// TP: matches this codebase's existing sweep convention (scripts/sweep-rr.ts).
//
// 1.0 and 1.2 were REMOVED from this list on 2026-08-24. Against a 1.5 ATR
// stop they are 0.67:1 and 0.8:1 reward-to-risk, needing a 60% / 55.6% win
// rate merely to break even, and the exit-geometry sweep measured
// `single 1.2 ATR` as the WORST of its 20 variants on the desk's own entry
// rule — worst while carrying the highest win rate of all of them, which is
// exactly how a sub-1:1 ladder fails. A candidate whose in-sample optimum is a
// sub-1:1 target has bought its expectancy with a win rate that has to hold to
// the decimal; there is no reason to leave that in the menu.
// See docs/quant/2026-08-24-exit-geometry-sweep-results.md §5.
export const LADDER_TP_MULTS = [1.5, 2.0, 2.5, 3.0];
export const LADDER_SL_MULT = 1.5;

// The two ATR trailing geometries that passed the full pre-registered protocol
// in that same study — out-of-sample confirmed, held at 3x sample and on a
// second timeframe, positive in 10 of 10 weekly calendar years, against a
// pre-registered control that failed everywhere. Both are here, and neither is
// presented as the optimum: 1.0/1.5 performs nearly as well as 1.5/1.5, which
// is what says the cell is not a tuned spike. Before this they were unreachable
// to a research candidate — the only exit geometry in this repo with a real
// out-of-sample pedigree was the one geometry the loop could not choose.
export const LADDER_TRAILS = [
  { activateMult: 1.0, offsetMult: 1.5 },
  { activateMult: 1.5, offsetMult: 1.5 },
] as const;

// A trail REPLACES tp1/tp2 targeting outright (positionRules.decideAction
// short-circuits to decideTrailingAction), so tp1Mult on a trailing option is
// never an exit level. It survives only as the nominal R:R the Iron Rules gate
// reads, and 2.5/1.5 = 1.67 clears the 1.5 floor — correct for an exit whose
// upside is unbounded and which therefore has no fixed target to quote.
const TRAIL_NOMINAL_TP_MULT = 2.5;

export type ExitLadder = {
  tp1Mult: number;
  slMult: number;
  singleTarget: true;
  trail?: { activateMult: number; offsetMult: number };
};

export const LADDER_OPTIONS: ExitLadder[] = [
  ...LADDER_TP_MULTS.map((tp1Mult) => ({ tp1Mult, slMult: LADDER_SL_MULT, singleTarget: true as const })),
  ...LADDER_TRAILS.map((trail) => ({
    tp1Mult: TRAIL_NOMINAL_TP_MULT,
    slMult: LADDER_SL_MULT,
    singleTarget: true as const,
    trail: { ...trail },
  })),
];

/**
 * The fixed geometry refinement rounds are compared under, before each
 * candidate gets its own swept ladder.
 *
 * Any constant works here as long as it is the SAME one for every round and
 * every candidate — the point is to isolate "did the entry logic improve?" from
 * "did we find a friendlier target?". It used to be a hardcoded 1.2, which was
 * 0.8:1 against the 1.5 ATR stop and had been retired from LADDER_OPTIONS on
 * 2026-08-24 as measurably bad; leaving it as the yardstick meant every
 * refinement round was judged on the one geometry the project had concluded it
 * should never trade. It is now the first entry of the live menu (1.5/1.5, an
 * even 1:1), so the comparison runs on a geometry the loop could actually pick.
 */
export const REFINEMENT_LADDER: ExitLadder = LADDER_OPTIONS[0];

/** Sweep LADDER_OPTIONS over an already-prepared fold, picking the best by avgR
 *  among options that cleared `minTrades`. Pure with respect to its inputs — no
 *  DB/network, and no re-derivation of entry signals (that is what makes eight
 *  ladders cost roughly one backtest instead of eight). */
export function sweepLadder(
  prepared: PreparedSymbol[],
  fold: Fold,
  minTrades: number = MIN_TRADES,
): { ladder: ExitLadder; summary: BacktestSummary } {
  const scored = LADDER_OPTIONS.map((ladder) => ({
    ladder,
    summary: simulateFold(prepared, fold, {
      tp1Mult: ladder.tp1Mult,
      slMult: ladder.slMult,
      trail: ladder.trail,
      singleTarget: true,
      costs: RESEARCH_COST_MODEL,
    }).summary,
  }));

  // Selection is on avgR, not on the dollar profit factor this used to rank by.
  // Every backtest here runs a fixed lot, so a dollar ratio silently weights
  // each trade by its own stop width — trades opened while ATR was wide count
  // for more than trades opened while it was tight, for no reason the desk
  // cares about. The live desk sizes to constant dollar risk (computeLot:
  // riskUsd / slDistance), under which a trade's dollar P&L is its R times one
  // fixed constant. avgR is therefore the quantity that actually compounds,
  // and it is the only one comparable across options with different stop
  // widths. (The exit-geometry sweep hit the same contradiction head-on: on
  // daily in-sample it reported PF 0.97 against totalR +399.)
  //
  // Prefer options that cleared the same trade floor approval is gated on:
  // maximising avgR over a handful of trades is how a 3-trade ladder wins a
  // sweep. If nothing clears it the best of a thin field is still returned —
  // autoReviewStatus rejects the candidate on trade count immediately after.
  const eligible = scored.filter((s) => s.summary.trades >= minTrades);
  const field = eligible.length ? eligible : scored;

  return field.reduce((best, s) => {
    const a = s.summary.avgR ?? -Infinity;
    const b = best.summary.avgR ?? -Infinity;
    // More trades breaks a tie: same expectancy per unit risk, more chances to
    // collect it, and a tighter standard error on the estimate.
    if (a > b || (a === b && s.summary.trades > best.summary.trades)) return s;
    return best;
  });
}

interface Iteration { code: string; note: string; backtestSummary?: BacktestSummary }

async function runOneCandidate(
  candidate: Candidate,
  fitSlices: FoldSliceRow[],
  selectSlices: FoldSliceRow[],
  budget: { spent: number },
  refinementRounds: number = MAX_REFINEMENT_ROUNDS,
): Promise<{
  label: string;
  code: string;
  status: "approved" | "rejected";
  iterations: Iteration[];
  /** the FIT fold — the fitted baseline every later fold's retention is measured against */
  backtestSummary: BacktestSummary;
  /** the SELECT fold — what approve/reject was actually decided on */
  selectSummary: BacktestSummary;
  exitLadder: ExitLadder;
  safetyFlag: boolean;
  costUsd: number;
}> {
  let costUsd = 0;
  let code = candidate.code;
  let safetyFlag = false;
  const iterations: Iteration[] = [];

  // Safety scan, with one AI-assisted repair attempt on failure.
  let safe = false;
  for (let attempt = 0; attempt <= MAX_RETRIES_PER_SAFETY_FAIL; attempt++) {
    try {
      compileStrategy(code);
      safe = true;
      break;
    } catch (e) {
      safetyFlag = true;
      if (!(e instanceof SandboxSafetyError) || attempt === MAX_RETRIES_PER_SAFETY_FAIL) break;
      if (budget.spent >= COST_CIRCUIT_BREAKER_USD) break;
      const fixed = await fixUnsafeCode(code, e.matched);
      costUsd += fixed.costUsd;
      budget.spent += fixed.costUsd;
      code = fixed.code;
    }
  }

  if (!safe) {
    return {
      label: candidate.label,
      code,
      status: "rejected",
      iterations,
      backtestSummary: summarizeBacktest([]),
      selectSummary: summarizeBacktest([]),
      // Never traded — this candidate is rejected on the safety scan and never
      // reaches a backtest. It still carries a ladder from the current menu
      // rather than the retired 0.8:1 one, so no path in this file can write
      // that geometry to the database.
      exitLadder: LADDER_OPTIONS[0],
      safetyFlag,
      costUsd,
    };
  }

  // One pass over the FIT fold: compile once, compute each symbol's signals,
  // simulate the shared refinement geometry. The signals are the expensive part
  // and they are discarded between rounds because the CODE changes between
  // rounds — there is nothing to reuse until the code is final.
  const fitOnce = (src: string): { prepared: PreparedSymbol[]; summary: BacktestSummary } => {
    const prepared = withSignals(fitSlices, panelSignalsForCode(src));
    return {
      prepared,
      summary: simulateFold(prepared, FIT_FOLD, {
        tp1Mult: REFINEMENT_LADDER.tp1Mult,
        slMult: REFINEMENT_LADDER.slMult,
        trail: REFINEMENT_LADDER.trail,
        singleTarget: true,
        costs: RESEARCH_COST_MODEL,
      }).summary,
    };
  };

  let fit = fitOnce(code);
  iterations.push({ code, note: candidate.rationale, backtestSummary: fit.summary });

  for (let round = 0; round < refinementRounds; round++) {
    if (budget.spent >= COST_CIRCUIT_BREAKER_USD) break;
    const refined = await refineCandidate(code, fit.summary);
    costUsd += refined.costUsd;
    budget.spent += refined.costUsd;

    try {
      compileStrategy(refined.code); // re-scan the revision before trusting it
    } catch {
      safetyFlag = true;
      break; // keep the last known-safe version
    }
    code = refined.code;
    fit = fitOnce(code);
    iterations.push({ code, note: refined.note, backtestSummary: fit.summary });
  }

  // Final ladder sweep on the finalized code, still on FIT — see sweepLadder's
  // comment for why this runs once, after refinement, rather than per round.
  // Reuses the signals the last fitOnce() already computed: eight geometries,
  // zero extra sandbox passes.
  const swept = sweepLadder(fit.prepared, FIT_FOLD, MIN_PANEL_TRADES);
  iterations.push({ code, note: `final exit-ladder sweep on ${FIT_FOLD.name} (${FIT_FOLD.from}..${FIT_FOLD.to})`, backtestSummary: swept.summary });

  // SELECT. A different year, never touched by the refinement loop or the
  // sweep, running the ladder the sweep chose. This is the number approve/reject
  // is decided on — deciding on FIT would be grading eight geometries and two
  // rewrites against the data all three were chosen with.
  const selectRun = simulateFold(withSignals(selectSlices, panelSignalsForCode(code)), SELECT_FOLD, {
    tp1Mult: swept.ladder.tp1Mult,
    slMult: swept.ladder.slMult,
    trail: swept.ladder.trail,
    singleTarget: true,
    costs: RESEARCH_COST_MODEL,
  });
  iterations.push({
    code,
    note: `select fold ${SELECT_FOLD.name} (${SELECT_FOLD.from}..${SELECT_FOLD.to}, ${SELECT_FOLD.regime}) — ` +
      `${selectRun.symbolsTraded}/${selectRun.symbolsInFold} symbols traded`,
    backtestSummary: selectRun.summary,
  });

  return {
    label: candidate.label,
    code,
    status: autoReviewStatus(selectRun.summary, safetyFlag, MIN_PANEL_TRADES),
    iterations,
    backtestSummary: swept.summary,
    selectSummary: selectRun.summary,
    exitLadder: swept.ladder,
    safetyFlag,
    costUsd,
  };
}

/**
 * Pure: may this round's candidates be persisted as research?
 *
 * Fails closed on the mock proposer, the same way applyBlindTestVerdict fails
 * closed on unverifiable held-out data.
 *
 * When no AI backend is configured, proposeCandidates() returns three
 * hardcoded candidates ("Mock Momentum" / "Mock Mean-Reversion" / "Mock
 * Breakout") and runResearch used to persist them as ordinary
 * ResearchStrategy rows: real sandbox, real backtest, real autoReview, real
 * approved/rejected status — and nothing anywhere recording that no AI
 * proposed them. Scheduled rounds run on Vercel, which has no AI credential,
 * so 109 rounds at $0 cost produced 34 `Mock *` rows sitting at `approved`,
 * i.e. activatable on the live desk. Re-backtesting the same three RSI and
 * breakout snippets is not research; banking it as research is what made the
 * pool look like it held 40 validated strategies.
 *
 * `backend` is null for a manual round, which is exempt: those candidates are
 * hand-authored by a human (or by Claude in conversation) and deliberately
 * skip the proposer entirely.
 */
export function isBankableRound(isManual: boolean, backend: AiBackend | null): boolean {
  if (isManual) return true;
  return backend !== null && backend !== "mock";
}

/**
 * One research round over the panel.
 *
 * The symbol/interval/range parameters this used to take are gone rather than
 * ignored: a round no longer runs on a symbol, and a parameter that is accepted
 * and silently dropped is worse than one that fails to compile. Callers that
 * used to name a symbol are now naming a universe they do not get to choose.
 */
export async function runResearch(
  brief: string,
  // Hand-authored candidates (e.g. written by Claude in conversation instead
  // of via the Anthropic API) skip proposeCandidates() entirely — no AI call,
  // no cost. They also skip auto-refinement, since that's an AI call too; to
  // refine a manual candidate, ask for a revision and dispatch it as a new run.
  manualCandidates?: Candidate[],
): Promise<{ runId: number; skipped?: "no-ai-backend" }> {
  const run = await prisma.researchRun.create({
    data: { brief, symbol: PANEL_RUN_SYMBOL, interval: PANEL_RUN_INTERVAL, range: PANEL_RUN_RANGE, status: "running" },
  });

  try {
    const isManual = !!manualCandidates?.length;
    const proposed = isManual ? null : await proposeCandidates(brief, PANEL_RUN_SYMBOL, PANEL_RUN_INTERVAL);

    // See isBankableRound above for why a mock-proposed round is refused.
    if (!isBankableRound(isManual, proposed?.backend ?? null)) {
      console.warn(`research run ${run.id}: no AI backend — skipping instead of banking mock candidates (panel round)`);
      await prisma.researchRun.update({
        where: { id: run.id },
        data: { status: "skipped", finishedAt: new Date() },
      });
      return { runId: run.id, skipped: "no-ai-backend" };
    }

    const candidates = proposed?.candidates ?? manualCandidates!;
    const proposeCost = proposed?.costUsd ?? 0;
    const budget = { spent: proposeCost };

    // Cut both fitting folds once and share them across all three candidates.
    // Slicing is per-fold; only the signals are per-code-version.
    const panel = loadPanel();
    const fitSlices = sliceFold(panel, FIT_FOLD);
    const selectSlices = sliceFold(panel, SELECT_FOLD);
    console.log(
      `research run ${run.id}: panel ${panel.symbols.length} symbols (cache fetched ${panel.fetchedAt}) — ` +
        `fit ${fitSlices.length} symbols, select ${selectSlices.length} symbols`,
    );

    const refinementRounds = isManual ? 0 : MAX_REFINEMENT_ROUNDS;
    const results = await Promise.all(
      candidates.slice(0, MAX_CANDIDATES).map((c) => runOneCandidate(c, fitSlices, selectSlices, budget, refinementRounds)),
    );

    let totalCost = proposeCost;
    for (const r of results) {
      totalCost += r.costUsd;
      const created = await prisma.researchStrategy.create({
        data: {
          runId: run.id,
          label: r.label,
          code: r.code,
          status: r.status,
          iterations: JSON.stringify(r.iterations),
          backtestSummary: JSON.stringify(r.backtestSummary),
          exitLadder: JSON.stringify(r.exitLadder),
          safetyFlag: r.safetyFlag,
          validation: PANEL_VALIDATION,
        },
      });
      // Held-out validation only runs for in-sample approvals — a candidate
      // rejected on its own SELECT numbers gains nothing from a blind test and
      // it would just burn three TEST folds' worth of compute.
      let finalRow = created;
      if (created.status === "approved") {
        try {
          const verdict = await runBlindTest(created.id);
          const applied = applyBlindTestVerdict(created.status, verdict);
          finalRow = await prisma.researchStrategy.update({
            where: { id: created.id },
            data: { status: applied.status, blindTest: applied.blindTestJson },
          });
        } catch (e) {
          // runBlindTest()/update() threw instead of returning normally (e.g.
          // a Neon connection hiccup on a shared serverless instance hit every
          // 2h) — fail closed exactly like the `{error: ...}` BlindTestResult
          // branch: an unverifiable candidate does not get to stay "approved".
          // This update-on-catch must not itself be able to abort the loop —
          // same reasoning as the Obsidian export below — so it's defensive too.
          const failed = blindTestOrchestrationFailure(e);
          try {
            finalRow = await prisma.researchStrategy.update({
              where: { id: created.id },
              data: { status: failed.status, blindTest: failed.blindTestJson },
            });
          } catch (e2) {
            console.error(`failed to persist blind-test-orchestration-failure status for strategy ${created.id}:`, e2);
          }
        }
      }

      // Vault export is a best-effort side note for browsing in Obsidian, never
      // load-bearing - a filesystem hiccup here must not fail the research run.
      try {
        exportStrategyNote(finalRow, run);
      } catch (e) {
        console.error(`obsidian export failed for strategy ${finalRow.id}:`, e);
      }
    }

    await prisma.researchRun.update({
      where: { id: run.id },
      data: { status: "done", costUsd: totalCost, finishedAt: new Date() },
    });
  } catch (e) {
    await prisma.researchRun.update({
      where: { id: run.id },
      data: { status: "failed", finishedAt: new Date() },
    });
    throw e;
  }

  return { runId: run.id };
}
