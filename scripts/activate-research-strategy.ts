// Activates the approved DI-Cross research strategy (id 25, run #9) on the
// Gold Desk portfolio (id 8, GC=F) so it appears/trades live in the War Room.
// Validates the same way the PATCH /api/portfolios/[id] route does before
// writing, so this can't activate something the route would've rejected.
// Usage: npx tsx scripts/activate-research-strategy.ts

import { prisma } from "../src/lib/db";
import { getResearchStrategy } from "../src/lib/research/adapter";

const PORTFOLIO_ID = 8; // Gold Desk
const STRATEGY_KEY = "research-25"; // DI-Cross (no ADX filter), run #9

async function main() {
  const portfolio = await prisma.portfolio.findUnique({ where: { id: PORTFOLIO_ID } });
  if (!portfolio) throw new Error(`portfolio ${PORTFOLIO_ID} not found`);
  console.log(`Portfolio: ${portfolio.name} (symbol=${portfolio.symbol ?? "n/a"}, current strategy=${portfolio.strategy})`);

  const strat = await getResearchStrategy(STRATEGY_KEY);
  if (!strat) throw new Error(`${STRATEGY_KEY} did not resolve via getResearchStrategy — is it approved?`);
  console.log(`Resolved ${STRATEGY_KEY} ok.`);

  const updated = await prisma.portfolio.update({
    where: { id: PORTFOLIO_ID },
    data: { strategy: STRATEGY_KEY },
  });
  console.log(`Updated portfolio ${PORTFOLIO_ID} strategy: ${portfolio.strategy} -> ${updated.strategy}`);
}

main().then(() => process.exit(0));
