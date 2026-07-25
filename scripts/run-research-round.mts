// Driver for one round of the self-directed research loop: calls runResearch()
// with a fresh brief/symbol, then prints the resulting researchStrategy rows
// (label, status, backtest summary) so the caller can decide what to blind-test.
// Usage: npx tsx scripts/run-research-round.mts "<brief>" <symbol> [interval] [range]

import "dotenv/config";
import { runResearch } from "../src/lib/research/runResearch";
import { prisma } from "../src/lib/db";

async function main() {
  const [brief, symbol, interval, range] = process.argv.slice(2);
  if (!brief || !symbol) {
    console.log('usage: npx tsx scripts/run-research-round.mts "<brief>" <symbol> [interval] [range]');
    return;
  }
  console.log(`Running research: ${symbol} ${interval ?? "1h"}/${range ?? "3mo"}\nBrief: ${brief}\n`);
  const { runId } = await runResearch(brief, symbol, (interval as any) ?? "1h", (range as any) ?? "3mo");
  const run = await prisma.researchRun.findUnique({ where: { id: runId } });
  console.log(`Run #${runId} status: ${run?.status}${run?.status === "failed" ? "" : ""}`);
  const strategies = await prisma.researchStrategy.findMany({ where: { runId }, orderBy: { id: "asc" } });
  for (const s of strategies) {
    const bt = s.backtestSummary as any;
    console.log(
      `\nresearch-${s.id} [${s.status}]${s.safetyFlag ? " SAFETY-FLAGGED" : ""} "${s.label}"` +
      (bt ? `\n  trades=${bt.trades} win%=${bt.winRate?.toFixed?.(1)} pnl=$${bt.totalPnl?.toFixed?.(0)} pf=${bt.profitFactor?.toFixed?.(2)}` : "")
    );
  }
  await prisma.$disconnect();
}

main();
