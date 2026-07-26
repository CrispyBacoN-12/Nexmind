// Cron-triggered Signal table cleanup — prunes signals that never became a
// trade (proposed/discarded/vetoed) once they're older than the retention
// window. Weekly cadence via GitHub Actions (.github/workflows/cleanup-signals.yml)
// since this is maintenance, not time-sensitive like the scan/research crons.
// Auth: requires `Authorization: Bearer $CRON_SECRET`, same as the other cron routes.
import { deleteOldSignals } from "@/lib/maintenance/cleanupSignals";
import { assertCronAuth } from "@/lib/cronAuth";
import { sendDiscordNotification } from "@/lib/notify/discord";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const unauthorized = assertCronAuth(req);
  if (unauthorized) return unauthorized;

  const daysParam = new URL(req.url).searchParams.get("days");
  const days = daysParam ? Number(daysParam) : undefined;

  try {
    const result = await deleteOldSignals(days);
    await sendDiscordNotification(
      `Signal cleanup: deleted ${result.deletedCount} rows older than ${result.cutoff.toISOString().slice(0, 10)}`,
      "info",
    );
    return Response.json({ ok: true, ...result });
  } catch (e) {
    await sendDiscordNotification(`/api/cron/cleanup failed: ${String(e)}`, "critical");
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
