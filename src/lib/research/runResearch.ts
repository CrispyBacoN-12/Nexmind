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
import { autoReviewStatus, MIN_TRADES } from "./autoReview";
import { runBlindTest, applyBlindTestVerdict, blindTestOrchestrationFailure } from "./blindTest";
import type { AiBackend } from "@/lib/anthropic";
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

/** Sweep LADDER_OPTIONS, picking the best by avgR among options that cleared
 *  MIN_TRADES. Pure with respect to its inputs — no DB/network. */
export function sweepLadder(
  code: string,
  bars: Candle[],
  snaps: ScanSnapshot[],
): { ladder: ExitLadder; summary: BacktestSummary } {
  const compiled = compileStrategy(code);
  const entry = (i: number) => compiled.invoke(bars, snaps, i)?.side ?? null;

  const scored = LADDER_OPTIONS.map((ladder) => {
    const bt = backtestCandles(
      "sweep", bars, 0.1, undefined, entry, true, ladder.tp1Mult,
      RESEARCH_COST_MODEL, ladder.slMult, ladder.trail,
    );
    return { ladder, summary: summarizeBacktest(bt.trades) };
  });

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
  const eligible = scored.filter((s) => s.summary.trades >= MIN_TRADES);
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
  bars: Awaited<ReturnType<typeof fetchCandles>>["candles"],
  budget: { spent: number },
  refinementRounds: number = MAX_REFINEMENT_ROUNDS,
): Promise<{
  label: string;
  code: string;
  status: "approved" | "rejected";
  iterations: Iteration[];
  backtestSummary: BacktestSummary;
  exitLadder: ExitLadder;
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
      // Never traded — this candidate is rejected on the safety scan and never
      // reaches a backtest. It still carries a ladder from the current menu
      // rather than the retired 0.8:1 one, so no path in this file can write
      // that geometry to the database.
      exitLadder: LADDER_OPTIONS[0],
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
): Promise<{ runId: number; skipped?: "no-ai-backend" }> {
  const run = await prisma.researchRun.create({ data: { brief, symbol, interval, range, status: "running" } });

  try {
    const isManual = !!manualCandidates?.length;
    const proposed = isManual ? null : await proposeCandidates(brief, symbol, interval);

    // See isBankableRound above for why a mock-proposed round is refused.
    if (!isBankableRound(isManual, proposed?.backend ?? null)) {
      console.warn(`research run ${run.id}: no AI backend — skipping instead of banking mock candidates (${symbol} ${interval}/${range})`);
      await prisma.researchRun.update({
        where: { id: run.id },
        data: { status: "skipped", finishedAt: new Date() },
      });
      return { runId: run.id, skipped: "no-ai-backend" };
    }

    const candidates = proposed?.candidates ?? manualCandidates!;
    const proposeCost = proposed?.costUsd ?? 0;
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
