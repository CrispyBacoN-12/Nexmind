// Signal is the fastest-growing table (one row per scan tick, every 15 min on
// the BTC desks) and most rows are noise: a "proposed" signal that never even
// reached HAWK consensus, or one HAWK/SAGE/Iron Rules rejected. Only signals
// that became a trade carry lasting value (the trade keeps its own decision
// log), so this only ever deletes signals with no linked trade — an
// "executed" signal always has one, so it's never a deletion candidate here
// regardless of age.
import { prisma } from "@/lib/db";

export const DEFAULT_RETENTION_DAYS = 60;

const PRUNABLE_STATUSES = ["proposed", "discarded", "vetoed"] as const;

export interface CleanupResult {
  cutoff: Date;
  deletedCount: number;
}

export async function deleteOldSignals(retentionDays: number = DEFAULT_RETENTION_DAYS): Promise<CleanupResult> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const { count } = await prisma.signal.deleteMany({
    where: {
      createdAt: { lt: cutoff },
      status: { in: [...PRUNABLE_STATUSES] },
      trade: null,
    },
  });
  return { cutoff, deletedCount: count };
}
