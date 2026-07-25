import "dotenv/config";
import { prisma } from "../src/lib/db";

async function main() {
  const runId = Number(process.argv[2]);
  const rows = await prisma.researchStrategy.findMany({ where: { runId }, orderBy: { id: "asc" } });
  for (const r of rows) {
    console.log(`\n=== research-${r.id} [${r.status}] ${r.label} ===`);
    console.log(JSON.stringify(r.backtestSummary, null, 2));
  }
  await prisma.$disconnect();
}

main();
