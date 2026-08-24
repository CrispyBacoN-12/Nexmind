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
import { runResearch } from "./runResearch";
import { prisma } from "@/lib/db";
import type { Interval, Range } from "@/lib/yahoo";

interface RotationEntry {
  label: string;
  symbol: string;
  interval: Interval;
  range: Range;
  brief: string;
}

// One entry per (name, mechanism angle) so repeated rounds don't just ask the AI
// to re-propose the same idea. All entries are US equities on 1d/2y, matching
// the US Stocks Desk's own cadence — the gold and BTC rotations were dropped
// when the app narrowed to stocks-only.
// Deliberately says nothing about the take-profit: sweepLadder picks each
// candidate's ladder from LADDER_OPTIONS on avgR and writes it to exitLadder, so
// naming a target here only biases the entry design toward a geometry the
// candidate may not end up with. It used to read "TP=1.2xATR", which since
// a70c1c4 is not even an option any more — 1.0 and 1.2 were removed from
// LADDER_TP_MULTS as sub-1:1 against the 1.5 ATR stop.
const MOMENTUM_LADDER =
  "risk 1% per trade, exit geometry swept separately, win rate >50% with profit stable across both halves of the sample (not just a good average)";

export const RESEARCH_ROTATION: RotationEntry[] = [
  {
    label: "stocks-momentum",
    symbol: "AAPL",
    interval: "1d",
    range: "2y",
    brief: `Momentum/breakout entry signal for US equities swing trading, ${MOMENTUM_LADDER}.`,
  },
  {
    label: "stocks-meanrev",
    symbol: "AAPL",
    interval: "1d",
    range: "2y",
    brief: `Mean-reversion entry signal for US equities swing trading, ${MOMENTUM_LADDER}.`,
  },
  {
    label: "stocks-trend-pullback",
    symbol: "MSFT",
    interval: "1d",
    range: "2y",
    brief: `Pullback-within-uptrend entry signal for US equities swing trading, ${MOMENTUM_LADDER}.`,
  },
  {
    label: "stocks-volatility",
    symbol: "NVDA",
    interval: "1d",
    range: "2y",
    brief: `Volatility-contraction / range-expansion entry signal for US equities swing trading, ${MOMENTUM_LADDER}.`,
  },
];

/** Deterministic day-of-cycle pick so a daily cron works through the whole rotation before repeating. */
export function pickRotationEntry(daysSinceEpoch: number = Math.floor(Date.now() / 86_400_000)): RotationEntry {
  return RESEARCH_ROTATION[daysSinceEpoch % RESEARCH_ROTATION.length];
}

export interface ScheduledResearchOverride {
  symbol?: string;
  interval?: Interval;
  range?: Range;
  brief?: string;
}

/** Runs one research round (rotation pick, or an explicit override) and returns log lines. */
export async function runScheduledResearchRound(override?: ScheduledResearchOverride): Promise<string[]> {
  const pick = pickRotationEntry();
  const symbol = override?.symbol ?? pick.symbol;
  const interval = override?.interval ?? pick.interval;
  const range = override?.range ?? pick.range;
  const brief = override?.brief ?? pick.brief;
  const label = override ? "manual-override" : pick.label;

  const lines: string[] = [`research round [${label}] ${symbol} ${interval}/${range}`];

  const { runId, skipped } = await runResearch(brief, symbol, interval, range);
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
    const bt = s.backtestSummary ? JSON.parse(s.backtestSummary) : null;
    lines.push(
      `research-${s.id} [${s.status}]${s.safetyFlag ? " SAFETY-FLAGGED" : ""} "${s.label}"` +
        (bt ? ` trades=${bt.trades} win%=${bt.winRate?.toFixed?.(1)} pnl=$${bt.totalPnl?.toFixed?.(0)} pf=${bt.profitFactor?.toFixed?.(2)}` : ""),
    );
  }
  return lines;
}
