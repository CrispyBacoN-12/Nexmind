// Scheduled AI research round runner (CLI wrapper). Standalone so it can be
// driven without the dev server, mirroring scripts/scan.mts. The actual logic
// lives in src/lib/research/scheduledResearch.ts, shared with
// /api/cron/research (used on Vercel/GitHub Actions).
//
//   node --env-file=.env --import tsx scripts/research-round.mts             # rotation pick
//   node --env-file=.env --import tsx scripts/research-round.mts BTC-USD 1h 3mo   # override symbol/interval/range
import { prisma } from "@/lib/db";
import { runScheduledResearchRound } from "@/lib/research/scheduledResearch";
import type { Interval, Range } from "@/lib/yahoo";

const [symbol, interval, range] = process.argv.slice(2);
const override = symbol ? { symbol, interval: interval as Interval, range: range as Range } : undefined;

runScheduledResearchRound(override)
  .then((lines) => lines.forEach((l) => console.log(l)))
  .catch((e) => { console.error(`FATAL ${String(e)}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
