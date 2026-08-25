// Automated driver for the AI research loop, shared by the cron API route
// (src/app/api/cron/research/route.ts) and the local CLI wrapper
// (scripts/research-round.mts) — same split as runScan.ts / scan.mts for the
// live trading engine.
//
// Scope: this only automates *proposing and in-sample-vetting* new
// candidates (runResearch()'s existing propose -> backtest -> autoReview
// flow, cost-capped at COST_CIRCUIT_BREAKER_USD per candidate). It does NOT
// auto-approve or auto-port anything into strategies.ts — a candidate still
// has to clear scripts/approve-strategy.ts's blind test (see blindTest.ts)
// and get manually ported, same human-in-the-loop gate as before. This just
// removes the "someone has to remember to kick off a round" step.
//
// Cadence changed daily -> WEEKLY on 2026-08-25 (docs/PROPOSAL-panel-validation.md §7).
// Not for cost — a panel round measures at 8-10 minutes, so daily would be
// affordable. For multiple testing. Every round proposes three candidates and
// each gets a pass/fail against a pre-registered bar, so the rate at which this
// loop draws from the hypothesis space is the rate at which it manufactures
// false positives. 3/day is ~1,100 tests a year; 3/week is ~156. With the pool
// already holding 84 rows and exactly one live result to show for them, the
// binding constraint on this project is not how many ideas get tried, it is how
// many survive contact with data they have never seen. Slowing the draw is the
// cheapest way to raise the share of survivors that are real.
import { runResearch } from "./runResearch";
import { prisma } from "@/lib/db";
import type { BacktestSummary } from "@/lib/backtest/engine";
import type { PanelBlindTestReport, PanelFoldReport } from "./blindTest";

/** What the blindTest column can hold: a full report, the error branch, or "{}" for a row that never reached the gate. */
type StoredVerdict = Partial<PanelBlindTestReport> & { error?: string };

interface RotationEntry {
  label: string;
  brief: string;
}

// One entry per mechanism angle so repeated rounds don't just ask the AI to
// re-propose the same idea.
//
// No symbol/interval/range any more: every round now runs the full S&P 500
// panel on daily bars over the FIT fold, so naming "AAPL 1d/2y" here would be
// describing a run that no longer happens. The old per-entry symbols (AAPL,
// AAPL, MSFT, NVDA) were also three names carrying four mechanisms — which is
// the single-symbol overfitting this whole change exists to end.
//
// Deliberately says nothing about the take-profit: sweepLadder picks each
// candidate's ladder from LADDER_OPTIONS on avgR and writes it to exitLadder, so
// naming a target here only biases the entry design toward a geometry the
// candidate may not end up with. It used to read "TP=1.2xATR", which since
// a70c1c4 is not even an option any more — 1.0 and 1.2 were removed from
// LADDER_TP_MULTS as sub-1:1 against the 1.5 ATR stop.
const MOMENTUM_LADDER =
  "risk 1% per trade, exit geometry swept separately, edge that holds across the whole cross-section (many names contributing, not one) and across both halves of the sample";

export const RESEARCH_ROTATION: RotationEntry[] = [
  {
    label: "stocks-momentum",
    brief: `Momentum/breakout entry signal for US equities swing trading, ${MOMENTUM_LADDER}.`,
  },
  {
    label: "stocks-meanrev",
    brief: `Mean-reversion entry signal for US equities swing trading, ${MOMENTUM_LADDER}.`,
  },
  {
    label: "stocks-trend-pullback",
    brief: `Pullback-within-uptrend entry signal for US equities swing trading, ${MOMENTUM_LADDER}.`,
  },
  {
    label: "stocks-volatility",
    brief: `Volatility-contraction / range-expansion entry signal for US equities swing trading, ${MOMENTUM_LADDER}.`,
  },
];

const MS_PER_WEEK = 7 * 86_400_000;

/**
 * Deterministic week-of-cycle pick, so a weekly cron works through all four
 * mechanisms before repeating (a full cycle is now ~28 days, not 4).
 *
 * Keyed on weeks rather than days because the cron fires weekly; keying on days
 * would advance the rotation seven steps between runs and, with four entries,
 * land on entries 0, 3, 2, 1, 0... — a cycle that still covers everything but
 * for no reason anyone reading it could predict.
 */
export function pickRotationEntry(weeksSinceEpoch: number = Math.floor(Date.now() / MS_PER_WEEK)): RotationEntry {
  const n = RESEARCH_ROTATION.length;
  return RESEARCH_ROTATION[((weeksSinceEpoch % n) + n) % n];
}

export interface ScheduledResearchOverride {
  brief?: string;
}

/** Runs one research round (rotation pick, or an explicit brief override) and returns log lines. */
export async function runScheduledResearchRound(override?: ScheduledResearchOverride): Promise<string[]> {
  const pick = pickRotationEntry();
  const brief = override?.brief ?? pick.brief;
  const label = override?.brief ? "manual-override" : pick.label;

  const lines: string[] = [`research round [${label}] S&P 500 panel, FIT fold`];

  const { runId, skipped } = await runResearch(brief);
  const run = await prisma.researchRun.findUnique({ where: { id: runId } });
  lines.push(`run #${runId} status: ${run?.status}`);
  // The cron log is where this is noticed. A skipped round is silent otherwise:
  // status "skipped" plus zero strategy lines looks the same as a bad round.
  if (skipped === "no-ai-backend") {
    lines.push(`SKIPPED: no AI backend configured in this environment — QUANT proposed nothing rather than banking mock candidates. Set ANTHROPIC_API_KEY (or make the Claude Code CLI reachable) wherever this cron runs.`);
    return lines;
  }

  const strategies = await prisma.researchStrategy.findMany({ where: { runId }, orderBy: { id: "asc" } });
  for (const s of strategies) {
    const bt = safeParse<BacktestSummary>(s.backtestSummary);
    // Labelled `fit=` deliberately. These are FIT-fold numbers — the window the
    // candidate was tuned on. Printing them bare next to an [approved] status
    // reads as evidence for the approval, when the evidence is the fold lines
    // below and these are the thing those folds are checked against.
    lines.push(
      `research-${s.id} [${s.status}]${s.safetyFlag ? " SAFETY-FLAGGED" : ""} "${s.label}"` +
        (bt ? ` fit=[trades=${bt.trades} win%=${fx(bt.winRate, 1)} pnl=$${fx(bt.totalPnl, 0)} pf=${fx(bt.profitFactor, 2)}]` : ""),
    );
    for (const l of blindTestLines(s.blindTest)) lines.push(l);
  }
  return lines;
}

/** The blindTest / backtestSummary columns are free-text JSON; never let a malformed one abort a round's log. */
function safeParse<T>(json: string): T | null {
  try {
    const v = JSON.parse(json || "{}");
    return v && typeof v === "object" ? (v as T) : null;
  } catch {
    return null;
  }
}

const fx = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—");

/**
 * The held-out result, in the log, next to the status it produced.
 *
 * Without this the weekly log line for a survivor and for a candidate that lost
 * on every fold differ by one word, and both quote FIT numbers. The log file is
 * where a round is actually noticed — a verdict that only exists as JSON in a
 * database column is a verdict nobody reads.
 */
function blindTestLines(json: string): string[] {
  const v = safeParse<StoredVerdict>(json);
  if (!v) return [];
  // Fails closed on purpose (see applyBlindTestVerdict): a candidate whose gate
  // could not be run is rejected, but it is re-runnable and a real failure is
  // not. The log has to keep those apart or a Neon hiccup looks like a verdict.
  if (typeof v.error === "string") return [`    blind test DID NOT COMPLETE — ${v.error}`];
  const folds = v.folds ?? [];
  if (!folds.length) return [];
  const out = folds.map((f: PanelFoldReport) => {
    const ctrl = f.control ? `ctrl-p95 ${fx(f.control.p95, 2)}` : "ctrl UNVERIFIED";
    const boot = f.bootstrap ? `boot-p5 ${fx(f.bootstrap.p5, 2)}` : "boot UNVERIFIED";
    const why = f.passed ? "" : ` — ${f.reasons[0] ?? "no reason recorded"}`;
    return (
      `    ${f.passed ? "PASS" : "FAIL"} ${f.fold} ${f.from}..${f.to} ` +
      `trades=${f.summary.trades} symbols=${f.symbolsTraded}/${f.symbolsInFold} ` +
      `avgR=${fx(f.summary.avgR, 2)} ${ctrl} ${boot}${why}`
    );
  });
  if (v.passed) out.push(`    SURVIVOR — cleared all ${folds.length} TEST folds and is now desk-eligible`);
  return out;
}
