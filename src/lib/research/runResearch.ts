// QUANT's orchestrator: brief → 3 candidate strategies → safety scan → free
// backtest → up to 2 refinement rounds each → persisted for human review.
// Structural mirror of runPipeline() in src/lib/pipeline/secretary.ts.

import { prisma } from "@/lib/db";
import { fetchCandles } from "@/lib/marketData";
import { backtestCandles, summarizeBacktest, DEFAULT_COST_MODEL, type BacktestSummary, type CostModel } from "@/lib/backtest/engine";
import { type Interval, type Range } from "@/lib/yahoo";
import { compileStrategy, SandboxSafetyError } from "./sandbox";
import { computeSnapshots } from "./adapter";
import { proposeCandidates, refineCandidate, fixUnsafeCode, type Candidate } from "./propose";
import { exportStrategyNote } from "@/lib/obsidian/export";
import { autoReviewStatus } from "./autoReview";
import { runBlindTest, applyBlindTestVerdict } from "./blindTest";
import type { Candle } from "@/lib/indicators";
import type { ScanSnapshot } from "@/lib/trading/scanner";

export const MAX_CANDIDATES = 3;
export const MAX_REFINEMENT_ROUNDS = 2;
export const MAX_RETRIES_PER_SAFETY_FAIL = 1;
export const COST_CIRCUIT_BREAKER_USD = 2;

// Same disclosed cost assumption used by the live paper desk (DEFAULT_COST_MODEL)
// so a candidate's research-time numbers and its post-approval live numbers are
// judged against identical friction — see that constant's comment for the
// rationale.
export const RESEARCH_COST_MODEL: CostModel = DEFAULT_COST_MODEL;

// Every research candidate's own validated exit ladder, swept once after
// refinement finishes (not per refinement round — refinement rounds compare
// candidates against each other under the SAME fixed 1.2 ladder above, so a
// round's improvement is judged independent of ladder choice; only once the
// code is locked in does each candidate get its own ratio). Fixed SL, varying
// TP: matches this codebase's existing sweep convention (scripts/sweep-rr.ts).
export const LADDER_TP_MULTS = [1.0, 1.2, 1.5, 2.0, 2.5, 3.0];
export const LADDER_SL_MULT = 1.5;

/** Sweep LADDER_TP_MULTS against a fixed SL, picking the best by profit factor
 *  (ties broken by expectancy). Pure with respect to its inputs — no DB/network. */
export function sweepLadder(
  code: string,
  bars: Candle[],
  snaps: ScanSnapshot[],
): { ladder: { tp1Mult: number; slMult: number; singleTarget: true }; summary: BacktestSummary } {
  const compiled = compileStrategy(code);
  const entry = (i: number) => compiled.invoke(bars, snaps, i)?.side ?? null;

  let best: { ladder: { tp1Mult: number; slMult: number; singleTarget: true }; summary: BacktestSummary } | null = null;
  for (const tp1Mult of LADDER_TP_MULTS) {
    const bt = backtestCandles("sweep", bars, 0.1, undefined, entry, true, tp1Mult, RESEARCH_COST_MODEL, LADDER_SL_MULT);
    const summary = summarizeBacktest(bt.trades);
    const pf = summary.profitFactor ?? -Infinity;
    const bestPf = best ? best.summary.profitFactor ?? -Infinity : -Infinity;
    const better =
      !best ||
      pf > bestPf ||
      (pf === bestPf && (summary.expectancy ?? -Infinity) > (best.summary.expectancy ?? -Infinity));
    if (better) best = { ladder: { tp1Mult, slMult: LADDER_SL_MULT, singleTarget: true }, summary };
  }
  return best!; // LADDER_TP_MULTS is non-empty, so a candidate is always assigned
}

interface Iteration { code: string; note: string; backtestSummary?: BacktestSummary }

async function runOneCandidate(
  candidate: Candidate,
  bars: Awaited<ReturnType<typeof fetchCandles>>["candles"],
  budget: { spent: number },
  refinementRounds: number = MAX_REFINEMENT_ROUNDS,
): Promise<{
  label: string;
  code: string;
  status: "approved" | "rejected";
  iterations: Iteration[];
  backtestSummary: BacktestSummary;
  exitLadder: { tp1Mult: number; slMult: number; singleTarget: true };
  safetyFlag: boolean;
  costUsd: number;
}> {
  const snaps = computeSnapshots(bars);
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
      exitLadder: { tp1Mult: 1.2, slMult: 1.5, singleTarget: true },
      safetyFlag,
      costUsd,
    };
  }

  // Research candidates use a tight single target (TP1 = 1.2x ATR, no farther
  // TP2 leg) instead of the live desk's stretched 2.5x/4x ladder. Swept
  // empirically (scripts/sweep-rr.ts, scripts/sweep-candidates.ts): the wide
  // ladder structurally caps "win" classification near 25-33% regardless of
  // entry quality, since it requires price to run all the way to the far
  // target. Tightening the target to be near the SL distance lifts win rate
  // past 50% on real signals while keeping expectancy positive. This only
  // affects research-strategy backtests — the live desk, Backtest Lab presets,
  // and existing tests keep the original ladder via backtestCandles' defaults.
  const runBacktest = (src: string): BacktestSummary => {
    const compiled = compileStrategy(src);
    const entry = (i: number) => compiled.invoke(bars, snaps, i)?.side ?? null;
    const bt = backtestCandles(candidate.label, bars, 0.1, undefined, entry, true, 1.2, RESEARCH_COST_MODEL);
    return summarizeBacktest(bt.trades);
  };

  let summary = runBacktest(code);
  iterations.push({ code, note: candidate.rationale, backtestSummary: summary });

  for (let round = 0; round < refinementRounds; round++) {
    if (budget.spent >= COST_CIRCUIT_BREAKER_USD) break;
    const refined = await refineCandidate(code, summary);
    costUsd += refined.costUsd;
    budget.spent += refined.costUsd;

    try {
      compileStrategy(refined.code); // re-scan the revision before trusting it
    } catch {
      safetyFlag = true;
      break; // keep the last known-safe version
    }
    code = refined.code;
    summary = runBacktest(code);
    iterations.push({ code, note: refined.note, backtestSummary: summary });
  }

  // Final ladder sweep on the finalized code only — see sweepLadder's comment
  // for why this runs once, after refinement, rather than per round.
  const swept = sweepLadder(code, bars, snaps);
  summary = swept.summary;
  iterations.push({ code, note: "final exit-ladder sweep", backtestSummary: summary });

  return {
    label: candidate.label,
    code,
    status: autoReviewStatus(summary, safetyFlag),
    iterations,
    backtestSummary: summary,
    exitLadder: swept.ladder,
    safetyFlag,
    costUsd,
  };
}

export async function runResearch(
  brief: string,
  symbol: string,
  interval: Interval = "1h",
  range: Range = "3mo",
  // Hand-authored candidates (e.g. written by Claude in conversation instead
  // of via the Anthropic API) skip proposeCandidates() entirely — no AI call,
  // no cost. They also skip auto-refinement, since that's an AI call too; to
  // refine a manual candidate, ask for a revision and dispatch it as a new run.
  manualCandidates?: Candidate[],
): Promise<{ runId: number }> {
  const run = await prisma.researchRun.create({ data: { brief, symbol, interval, range, status: "running" } });

  try {
    const isManual = !!manualCandidates?.length;
    const { candidates, costUsd: proposeCost } = isManual
      ? { candidates: manualCandidates!, costUsd: 0 }
      : await proposeCandidates(brief, symbol, interval);
    const budget = { spent: proposeCost };
    const resp = await fetchCandles(symbol, range, interval);

    const refinementRounds = isManual ? 0 : MAX_REFINEMENT_ROUNDS;
    const results = await Promise.all(
      candidates.slice(0, MAX_CANDIDATES).map((c) => runOneCandidate(c, resp.candles, budget, refinementRounds)),
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
        },
      });
      // Held-out validation only runs for in-sample approvals — a candidate
      // rejected on its own in-sample numbers gains nothing from a blind test
      // and it would just be a wasted deep-history fetch.
      let finalRow = created;
      if (created.status === "approved") {
        const verdict = await runBlindTest(created.id);
        const applied = applyBlindTestVerdict(created.status as "approved" | "rejected", verdict);
        finalRow = await prisma.researchStrategy.update({
          where: { id: created.id },
          data: { status: applied.status, blindTest: applied.blindTestJson },
        });
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
