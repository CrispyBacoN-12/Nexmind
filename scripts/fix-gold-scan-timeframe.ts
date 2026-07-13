// Every backtest/validation for DI-Cross (research-25) ran on 1h candles
// (3mo and 1y windows). Gold Desk was still set to scanInterval="1d",
// scanRange="1y" (its old daily "Position" timeframe from before the
// research strategy was activated) - a live/backtest timeframe mismatch that
// would make the desk evaluate DI crossovers on DAILY bars, a signal that was
// never tested. Aligning to "1h"/"3mo" - the exact params run #9's
// backtestSummary used - so live scanning matches what was validated.
// Usage: npx tsx scripts/fix-gold-scan-timeframe.ts

import { prisma } from "../src/lib/db";

async function main() {
  const before = await prisma.portfolio.findUnique({ where: { id: 8 } });
  console.log(`before: scanInterval=${before?.scanInterval} scanRange=${before?.scanRange}`);

  const after = await prisma.portfolio.update({
    where: { id: 8 },
    data: { scanInterval: "1h", scanRange: "3mo" },
  });
  console.log(`after: scanInterval=${after.scanInterval} scanRange=${after.scanRange}`);
}

main().then(() => process.exit(0));
