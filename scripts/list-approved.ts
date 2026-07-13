// One-off: list all currently-approved ResearchStrategy rows.
// Usage: npx tsx scripts/list-approved.ts
import { prisma } from "../src/lib/db";

async function main() {
  const rows = await prisma.researchStrategy.findMany({
    where: { status: "approved" },
    include: { run: true },
    orderBy: { id: "asc" },
  });
  for (const r of rows) {
    console.log(`research-${r.id} | ${r.label} | ${r.run.symbol} ${r.run.interval}`);
  }
  console.log("total approved:", rows.length);
}

main().then(() => process.exit(0));
