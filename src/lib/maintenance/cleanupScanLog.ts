// ScanLog is the Activity page's data source (see src/app/activity/page.tsx) —
// one row per scan/manage line, every 15 min across every active swing
// portfolio. Only the most recent ~150 rows are ever displayed, so there's no
// reason to keep weeks of history around.
import { prisma } from "@/lib/db";

export const DEFAULT_RETENTION_DAYS = 14;

export interface CleanupResult {
  cutoff: Date;
  deletedCount: number;
}

export async function deleteOldScanLogs(retentionDays: number = DEFAULT_RETENTION_DAYS): Promise<CleanupResult> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const { count } = await prisma.scanLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return { cutoff, deletedCount: count };
}
