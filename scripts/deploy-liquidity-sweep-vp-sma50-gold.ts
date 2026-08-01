// Deploy the TradingView-validated "Liquidity Sweep + Volume Profile + SMA50"
// strategy to Portfolio #8 (Gold Desk), replacing combo-gold. Validated on 1h
// bars (see obsidian-vault/Strategies/Liquidity Sweep + Volume Profile + SMA50...md),
// but the desk was still set to scanInterval="1d" scanRange="5y" from its prior
// strategy - same live/backtest timeframe mismatch fixed once before for this
// exact portfolio (see fix-gold-scan-timeframe.ts). Aligning to 1h/3mo, the
// same window already used for this portfolio's other 1h-validated strategy.
// Usage: npx tsx scripts/deploy-liquidity-sweep-vp-sma50-gold.ts

import { prisma } from "../src/lib/db";

async function main() {
  const before = await prisma.portfolio.findUnique({ where: { id: 8 } });
  console.log(`before: strategy=${before?.strategy} scanInterval=${before?.scanInterval} scanRange=${before?.scanRange}`);

  const after = await prisma.portfolio.update({
    where: { id: 8 },
    data: { strategy: "liquidity-sweep-volume-profile-sma50", scanInterval: "1h", scanRange: "3mo" },
  });
  console.log(`after: strategy=${after.strategy} scanInterval=${after.scanInterval} scanRange=${after.scanRange}`);
}

main().then(() => process.exit(0));
