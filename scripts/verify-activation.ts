// Confirms the War Room activation took effect for real: runs a live trade
// tick for Gold Desk (portfolio 8) with NO strategy override, so it must read
// "research-25" straight from the Portfolio row (just set via
// activate-research-strategy.ts) exactly the way the real scheduled scan loop
// would. Cleans up any Signal/Trade rows it creates - verification only.
// Usage: npx tsx scripts/verify-activation.ts

import { prisma } from "../src/lib/db";
import { runTradeTick } from "../src/lib/trading/engine";

async function main() {
  const portfolioId = 8;
  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  console.log(`Portfolio ${portfolioId} strategy field: ${portfolio?.strategy}`);

  const beforeTrade = await prisma.trade.findMany({ select: { id: true } });
  const beforeSignal = await prisma.signal.findMany({ select: { id: true } });

  const result = await runTradeTick("GC=F", portfolioId); // no override - must resolve from DB
  console.log("tick result:", JSON.stringify(result, null, 2));

  const afterTrades = await prisma.trade.findMany({ select: { id: true } });
  const newTradeIds = afterTrades.map((t) => t.id).filter((id) => !beforeTrade.some((b) => b.id === id));
  if (newTradeIds.length) await prisma.trade.deleteMany({ where: { id: { in: newTradeIds } } });

  const afterSignals = await prisma.signal.findMany({ select: { id: true } });
  const newSignalIds = afterSignals.map((s) => s.id).filter((id) => !beforeSignal.some((b) => b.id === id));
  if (newSignalIds.length) await prisma.signal.deleteMany({ where: { id: { in: newSignalIds } } });

  console.log(`cleaned up ${newTradeIds.length} test trade(s), ${newSignalIds.length} test signal(s)`);
}

main().then(() => process.exit(0));
