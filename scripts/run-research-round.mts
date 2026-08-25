// Driver for one round of the self-directed research loop: calls runResearch()
// with a fresh brief, then prints the resulting researchStrategy rows (label,
// status, backtest summary) so the caller can decide what to blind-test.
//
// The run itself is always the S&P 500 panel over the FIT fold — there is no
// symbol argument any more, because there is no single symbol being fitted.
// Usage: npx tsx scripts/run-research-round.mts "<brief>"

import "dotenv/config";
import { runResearch } from "../src/lib/research/runResearch";
import { prisma } from "../src/lib/db";

async function main() {
  const brief = process.argv.slice(2).join(" ").trim();
  if (!brief) {
    console.log('usage: npx tsx scripts/run-research-round.mts "<brief>"');
    return;
  }
  console.log(`Running research on the S&P 500 panel, FIT fold\nBrief: ${brief}\n`);
  const { runId } = await runResearch(brief);
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
