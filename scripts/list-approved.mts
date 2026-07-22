import "dotenv/config";
import { prisma } from "../src/lib/db";

async function main() {
  const rows = await prisma.researchStrategy.findMany({
    where: { status: "approved" },
    orderBy: { id: "asc" },
    select: { id: true, label: true },
  });
  for (const r of rows) console.log(`research-${r.id}\t${r.label}`);
  console.log(`\n${rows.length} approved`);
  await prisma.$disconnect();
}
main();
