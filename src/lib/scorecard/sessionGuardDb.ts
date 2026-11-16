// The prisma wiring of claim.ts, shared by scripts/scorecard-capture.mts (cloud) and
// scripts/scorecard-run.mts (local fallback). Thin by design: the logic and its tests live in
// claim.ts. No $transaction (Neon's WebSocket times out on the owner's network): the claim
// relies on Setting.key being the @id, so a second create fails.

import { prisma } from "@/lib/db";
import { claimSession, makeAlreadyRan } from "./claim";
import { SCORECARD_SOURCE } from "./types";

/** `owner` names the runner in the claim ("cloud" or "local"); `log` gets lines with no error text. */
export function dbAlreadyRan(owner: string, log: (message: string) => void): (sessionDate: string) => Promise<boolean> {
  return makeAlreadyRan({
    countDoneRuns: (sessionDate) => prisma.scorecardRun.count({ where: { sessionDate, status: { in: ["ran", "no_session"] } } }),
    countScheduledRows: (startMs, endMs) =>
      prisma.chartSetup.count({ where: { source: SCORECARD_SOURCE, createdAt: { gte: new Date(startMs), lt: new Date(endMs) } } }),
    claim: (sessionDate) =>
      claimSession(
        {
          create: async (key, value) => {
            await prisma.setting.create({ data: { key, value } });
          },
          read: (key) => prisma.setting.findUnique({ where: { key }, select: { value: true } }),
          overwrite: async (key, value) => {
            await prisma.setting.update({ where: { key }, data: { value } });
          },
          now: () => Date.now(),
        },
        sessionDate,
        owner,
      ),
    log,
  });
}
