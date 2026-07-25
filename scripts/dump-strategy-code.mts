import "dotenv/config";
import { prisma } from "../src/lib/db";

async function main() {
  const id = Number(process.argv[2]);
  const s = await prisma.researchStrategy.findUnique({ where: { id } });
  console.log(s?.code);
  await prisma.$disconnect();
}

main();
