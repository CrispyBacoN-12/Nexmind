// Scheduled options runner (CLI wrapper). Standalone so Task Scheduler can
// drive it without the dev server running. The actual logic lives in
// src/lib/options/runScheduled.ts, shared with the /api/cron/* route used on
// Vercel.
//
//   node --import tsx scripts/options.mts 4   # run options portfolio 4
//   node --import tsx scripts/options.mts     # run all active options portfolios
import { prisma } from "@/lib/db";
import { runScheduledOptions } from "@/lib/options/runScheduled";

const argIds = process.argv.slice(2).map(Number).filter(Number.isInteger);

runScheduledOptions(argIds)
  .then((lines) => lines.forEach((l) => console.log(l)))
  .catch((e) => { console.error(`FATAL ${String(e)}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
