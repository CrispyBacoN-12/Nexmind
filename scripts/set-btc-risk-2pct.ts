// User picked Option A at 2% risk/trade for Bitcoin Desk (research-27,
// RSI-50 Momentum Cross): ~22.8%/yr, historical max drawdown 22.8%. Raising
// riskPctPerTrade 1 -> 2 and drawdownHaltPct 10 -> 25 together, since the
// desk's kill switch is a hard, non-auto-resuming halt (manage.ts:127-141) -
// leaving it at 10% would trip on the very first drawdown even at the old 1%
// risk (historical max DD was already 11.4%), let alone at 2% (22.8%).
// Usage: npx tsx scripts/set-btc-risk-2pct.ts

import { prisma } from "../src/lib/db";

const PORTFOLIO_ID = 9; // Bitcoin Desk

async function main() {
  const before = await prisma.portfolio.findUnique({ where: { id: PORTFOLIO_ID } });
  console.log(`before: riskPctPerTrade=${before?.riskPctPerTrade} drawdownHaltPct=${before?.drawdownHaltPct} killSwitch=${before?.killSwitch}`);

  const after = await prisma.portfolio.update({
    where: { id: PORTFOLIO_ID },
    data: { riskPctPerTrade: 2, drawdownHaltPct: 25 },
  });
  console.log(`after: riskPctPerTrade=${after.riskPctPerTrade} drawdownHaltPct=${after.drawdownHaltPct} killSwitch=${after.killSwitch}`);
}

main().then(() => process.exit(0));
