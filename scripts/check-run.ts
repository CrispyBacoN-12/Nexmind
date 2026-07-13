// One-off: check a ResearchRun's status and its strategies' backtest results.
// Usage: npx tsx scripts/check-run.ts <runId>
import { prisma } from "../src/lib/db";

async function main() {
  const runId = Number(process.argv[2]);
  const run = await prisma.researchRun.findUnique({ where: { id: runId }, include: { strategies: true } });
  if (!run) { console.log("run not found"); return; }
  console.log("run status:", run.status);
  for (const s of run.strategies) {
    console.log(`research-${s.id} | ${s.label} | status=${s.status}`);
    console.log(s.backtestSummary);
  }
}

main().then(() => process.exit(0));
