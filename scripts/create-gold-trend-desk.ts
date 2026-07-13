// Creates "Gold Trend Desk" (#new) as a second, parallel Gold portfolio
// running research-30 ("DI-Dominance Widening") alongside the existing Gold
// Desk (#8, research-25 "DI-Cross"). Kept as a separate desk rather than
// merged into #8 so the already-approved DI-Cross strategy stays untouched -
// same precedent as "BTC Rip-Sell Test" (#10) running alongside Bitcoin
// Desk (#9). Structure copied from #10: swing, $10,000 starting balance,
// GC=F watchlist, 1h/3mo scan (matches the backtest interval).
import { prisma } from "../src/lib/db";

async function main() {
  const p = await prisma.portfolio.create({
    data: {
      name: "Gold Trend Desk",
      kind: "swing",
      status: "active",
      startingBalance: 10000,
      riskPctPerTrade: 1,
      maxOpenPositions: 6,
      drawdownHaltPct: 10,
      scanInterval: "1h",
      scanRange: "3mo",
      strategy: "research-30",
      universe: "",
      sort: 12,
    },
  });
  await prisma.watchlist.create({
    data: { portfolioId: p.id, symbol: "GC=F", label: "Gold", enabled: true, sort: 0 },
  });
  console.log(`Created portfolio #${p.id} "${p.name}" strategy=${p.strategy}`);
}

main().then(() => process.exit(0));
