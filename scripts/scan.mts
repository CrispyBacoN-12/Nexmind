// Scheduled scan runner (CLI wrapper). Standalone so Task Scheduler can drive
// it without the dev server running. The actual logic lives in
// src/lib/trading/runScan.ts, shared with the /api/cron/* routes used on
// Vercel.
//
//   node --import tsx scripts/scan.mts 9      # scan portfolio 9 only
//   node --import tsx scripts/scan.mts        # scan all active swing portfolios
import { prisma } from "@/lib/db";
import { runScheduledScan } from "@/lib/trading/runScan";

const argIds = process.argv.slice(2).map(Number).filter(Number.isInteger);

runScheduledScan(argIds)
  .then((lines) => lines.forEach((l) => console.log(l)))
  .catch((e) => { console.error(`FATAL ${String(e)}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
