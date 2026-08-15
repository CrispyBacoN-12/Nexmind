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

// One entry per (asset, mechanism angle) so repeated rounds don't just ask
// the AI to re-propose the same idea. Symbols/cadence mirror the live desks'
// own scan interval/range (Gold Desk: 1h/3mo; Bitcoin: 1h/3mo; Stocks desk
// convention from past manual dispatches: 1d/2y, sp500-style single name).
const MOMENTUM_LADDER =
  "tight single-target ladder (SL=1.5xATR, TP=1.2xATR), risk 1% per trade, win rate >50% with profit stable across both halves of the sample (not just a good average)";

export const RESEARCH_ROTATION: RotationEntry[] = [
  {
    label: "gold-momentum",
    symbol: "XAUUSD",
    interval: "1h",
    range: "3mo",
    brief: `Momentum/breakout entry signal for gold (XAUUSD) swing trading, ${MOMENTUM_LADDER}.`,
  },
  {
    label: "gold-meanrev",
    symbol: "XAUUSD",
    interval: "1h",
    range: "3mo",
    brief: `Mean-reversion entry signal for gold (XAUUSD) swing trading, ${MOMENTUM_LADDER}.`,
  },
  {
    label: "btc-momentum",
    symbol: "BTC-USD",
    interval: "1h",
    range: "3mo",
    brief: `Momentum/breakout entry signal for BTC-USD swing trading, ${MOMENTUM_LADDER}.`,
  },
  {
    label: "btc-meanrev",
    symbol: "BTC-USD",
    interval: "1h",
    range: "3mo",
    brief: `Mean-reversion entry signal for BTC-USD swing trading, ${MOMENTUM_LADDER}.`,
  },
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

  const { runId } = await runResearch(brief, symbol, interval, range);
  const run = await prisma.researchRun.findUnique({ where: { id: runId } });
  lines.push(`run #${runId} status: ${run?.status}`);

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
