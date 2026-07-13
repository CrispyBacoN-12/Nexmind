// One-shot end-to-end check: runs the real runTradeTick() against the Gold Desk
// portfolio with strategy overridden to an approved research strategy (id 22,
// run #8's tight-target DI-Dominance Continuation), to prove the tight ladder +
// relaxed R:R floor + full-risk lot sizing are actually wired into the live path.
// Cleans up whatever Signal/Trade rows it creates afterward — this is a
// verification run, not a real activation of the strategy on the portfolio.
// Usage: npx tsx scripts/verify-tick-e2e.ts

import { prisma } from "../src/lib/db";
import { runTradeTick } from "../src/lib/trading/engine";

async function main() {
  const portfolioId = 8; // Gold Desk
  const before = await prisma.signal.findMany({ select: { id: true } });
  const beforeTrade = await prisma.trade.findMany({ select: { id: true } });

  const result = await runTradeTick("GC=F", portfolioId, { strategy: "research-22" });
  console.log("tick result:", JSON.stringify(result, null, 2));

  if (result.tradeId) {
    const trade = await prisma.trade.findUnique({ where: { id: result.tradeId } });
    console.log("\ncreated trade:", trade);
  }

  // Cleanup: delete any Signal/Trade rows this run created.
  const afterTrades = await prisma.trade.findMany({ select: { id: true } });
  const newTradeIds = afterTrades.map((t) => t.id).filter((id) => !beforeTrade.some((b) => b.id === id));
  if (newTradeIds.length) await prisma.trade.deleteMany({ where: { id: { in: newTradeIds } } });

  const afterSignals = await prisma.signal.findMany({ select: { id: true } });
  const newSignalIds = afterSignals.map((s) => s.id).filter((id) => !before.some((b) => b.id === id));
  if (newSignalIds.length) await prisma.signal.deleteMany({ where: { id: { in: newSignalIds } } });

  console.log(`\ncleaned up ${newTradeIds.length} test trade(s), ${newSignalIds.length} test signal(s)`);
}

main().then(() => process.exit(0));
