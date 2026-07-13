import { prisma } from "../src/lib/db";

async function main() {
  const strat = await prisma.researchStrategy.update({
    where: { id: 32 },
    data: { status: "approved" },
  });
  console.log(`Approved research strategy #${strat.id} (${strat.label})`);

  const portfolio = await prisma.portfolio.update({
    where: { id: 9 },
    data: { strategy: "research-32" },
  });
  console.log(`Portfolio #${portfolio.id} "${portfolio.name}" strategy updated: ${portfolio.strategy}`);
}

main().then(() => process.exit(0));
