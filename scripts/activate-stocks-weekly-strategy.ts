// Replaces research-28 (ADX-Ignition Breakout, daily - failed at scale) with
// research-29 (RSI-50 Momentum Cross, weekly - stable at scale) on the US
// Stocks Desk. Also switches scanInterval/scanRange to 1wk/5y so live scans
// evaluate the signal on the same bar resolution it was designed and
// backtested on - leaving it on 1d/2y would silently mismatch the signal's
// weekly-tuned ADX/RSI/SMA thresholds against daily noise.
import { prisma } from "../src/lib/db";

const PORTFOLIO_ID = 11; // US Stocks Desk

async function main() {
  const before = await prisma.portfolio.findUnique({ where: { id: PORTFOLIO_ID } });
  const after = await prisma.portfolio.update({
    where: { id: PORTFOLIO_ID },
    data: { strategy: "research-29", scanInterval: "1wk", scanRange: "5y" },
  });
  console.log(
    `Updated portfolio ${PORTFOLIO_ID}: strategy ${before?.strategy} -> ${after.strategy}, ` +
    `scan ${before?.scanInterval}/${before?.scanRange} -> ${after.scanInterval}/${after.scanRange}`
  );
}
main().then(() => process.exit(0));
