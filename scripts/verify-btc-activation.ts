// Confirms the Bitcoin Desk activation took effect for real: runs a live
// trade tick for both symbols on the desk (BTC-USD, BNB-USD) with NO strategy
// override, so it must read "research-27" straight from the Portfolio row
// exactly the way the real scheduled scan loop would. Cleans up any
// Signal/Trade rows it creates - verification only.
// Usage: npx tsx scripts/verify-btc-activation.ts

import { prisma } from "../src/lib/db";
import { runTradeTick } from "../src/lib/trading/engine";

async function main() {
  const portfolioId = 9;
  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  console.log(`Portfolio ${portfolioId} strategy field: ${portfolio?.strategy}`);

  for (const symbol of ["BTC-USD", "BNB-USD"]) {
    const beforeTrade = await prisma.trade.findMany({ select: { id: true } });
    const beforeSignal = await prisma.signal.findMany({ select: { id: true } });

    const result = await runTradeTick(symbol, portfolioId); // no override - must resolve from DB
    console.log(`${symbol} tick result:`, JSON.stringify(result));

    const afterTrades = await prisma.trade.findMany({ select: { id: true } });
    const newTradeIds = afterTrades.map((t) => t.id).filter((id) => !beforeTrade.some((b) => b.id === id));
    if (newTradeIds.length) await prisma.trade.deleteMany({ where: { id: { in: newTradeIds } } });

    const afterSignals = await prisma.signal.findMany({ select: { id: true } });
    const newSignalIds = afterSignals.map((s) => s.id).filter((id) => !beforeSignal.some((b) => b.id === id));
    if (newSignalIds.length) await prisma.signal.deleteMany({ where: { id: { in: newSignalIds } } });
  }
}

main().then(() => process.exit(0));
