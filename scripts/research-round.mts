// Scheduled AI research round runner (CLI wrapper). Standalone so it can be
// driven without the dev server, mirroring scripts/scan.mts. The actual logic
// lives in src/lib/research/scheduledResearch.ts, shared with
// /api/cron/research (used on Vercel/GitHub Actions).
//
//   node --env-file=.env --import tsx scripts/research-round.mts                 # rotation pick
//   node --env-file=.env --import tsx scripts/research-round.mts "<brief>"       # override the brief
//
// Symbol/interval/range arguments are gone: since 2026-08-25 every round runs
// the whole S&P 500 panel on daily bars over the FIT fold, so there is no
// per-round instrument left to name. Anything passed is read as the brief.
import { prisma } from "@/lib/db";
import { runScheduledResearchRound } from "@/lib/research/scheduledResearch";

const brief = process.argv.slice(2).join(" ").trim();
const override = brief ? { brief } : undefined;

runScheduledResearchRound(override)
  .then((lines) => lines.forEach((l) => console.log(l)))
  .catch((e) => { console.error(`FATAL ${String(e)}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
