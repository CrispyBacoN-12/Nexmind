// Activates the approved RSI-50 Momentum Cross research strategy (id 27, run
// #10) on Bitcoin Desk (portfolio 9, BTC-USD/BNB-USD), replacing "combo-vote",
// mirroring exactly what activate-research-strategy.ts did for Gold Desk.
// Validates via getResearchStrategy() the same way the PATCH route does.
// Usage: npx tsx scripts/activate-btc-research-strategy.ts

import { prisma } from "../src/lib/db";
import { getResearchStrategy } from "../src/lib/research/adapter";

const PORTFOLIO_ID = 9; // Bitcoin Desk
const STRATEGY_KEY = "research-27"; // RSI-50 Momentum Cross, run #10

async function main() {
  const portfolio = await prisma.portfolio.findUnique({ where: { id: PORTFOLIO_ID } });
  if (!portfolio) throw new Error(`portfolio ${PORTFOLIO_ID} not found`);
  console.log(`Portfolio: ${portfolio.name} (scanInterval=${portfolio.scanInterval}, scanRange=${portfolio.scanRange}, current strategy=${portfolio.strategy})`);

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
