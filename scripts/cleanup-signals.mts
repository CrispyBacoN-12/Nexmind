// Prunes old proposed/discarded/vetoed Signal rows (no linked trade). CLI
// wrapper mirroring scripts/research-round.mts, shared logic with
// /api/cron/cleanup (used on GitHub Actions).
//
//   node --env-file=.env --import tsx scripts/cleanup-signals.mts        # default retention (60 days)
//   node --env-file=.env --import tsx scripts/cleanup-signals.mts 30     # override retention days
import { prisma } from "@/lib/db";
import { deleteOldSignals } from "@/lib/maintenance/cleanupSignals";

const [daysArg] = process.argv.slice(2);
const days = daysArg ? Number(daysArg) : undefined;

deleteOldSignals(days)
  .then((r) => console.log(`Deleted ${r.deletedCount} signals older than ${r.cutoff.toISOString()}`))
  .catch((e) => { console.error(`FATAL ${String(e)}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
