import "dotenv/config";
import { prisma } from "../src/lib/db";

async function main() {
  const runs = await prisma.researchRun.findMany({
    select: { id: true, brief: true, symbol: true, interval: true, range: true, status: true },
    orderBy: { id: "asc" },
  });
  const strategies = await prisma.researchStrategy.groupBy({
    by: ["status"],
    _count: true,
  });
  console.log("=== runs ===");
  for (const r of runs) console.log(`#${r.id} [${r.status}] ${r.symbol} ${r.interval}/${r.range}: ${r.brief}`);
  console.log("\n=== strategy status counts ===");
  console.log(strategies);
  await prisma.$disconnect();
}

main();
