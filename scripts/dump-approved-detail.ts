// One-off: dump code + backtestSummary for all approved ResearchStrategy rows,
// to analyze what market regimes/directions the current approved set covers.
// Usage: npx tsx scripts/dump-approved-detail.ts
import { prisma } from "../src/lib/db";

async function main() {
  const rows = await prisma.researchStrategy.findMany({
    where: { status: "approved" },
    include: { run: true },
    orderBy: { id: "asc" },
  });
  for (const r of rows) {
    console.log(`\n=== research-${r.id} | ${r.label} | ${r.run.symbol} ${r.run.interval} ===`);
    console.log(`backtestSummary: ${r.backtestSummary}`);
    console.log(`code:\n${r.code}`);
  }
}

main().then(() => process.exit(0));
