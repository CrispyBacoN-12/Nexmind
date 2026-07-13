import { prisma } from "../src/lib/db";

const PORTFOLIO_ID = 11; // US Stocks Desk

async function main() {
  const before = await prisma.portfolio.findUnique({ where: { id: PORTFOLIO_ID } });
  const after = await prisma.portfolio.update({
    where: { id: PORTFOLIO_ID },
    data: { strategy: "research-28" },
  });
  console.log(`Updated portfolio ${PORTFOLIO_ID} strategy: ${before?.strategy} -> ${after.strategy}`);
}
main().then(() => process.exit(0));
