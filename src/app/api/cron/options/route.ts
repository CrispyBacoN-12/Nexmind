// Cron-triggered options-desk endpoint. Replaces the local Windows Task
// Scheduler "NEXMIND Options scan" task now that the app runs on Vercel.
// vercel.json's native daily cron hits this with no query (defaults to every
// active options portfolio, i.e. Options Desk #4).
// Auth: requires `Authorization: Bearer $CRON_SECRET`.
import { runScheduledOptions } from "@/lib/options/runScheduled";
import { assertCronAuth } from "@/lib/cronAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const unauthorized = assertCronAuth(req);
  if (unauthorized) return unauthorized;

  const idsParam = new URL(req.url).searchParams.get("ids");
  const ids = idsParam
    ? idsParam.split(",").map(Number).filter(Number.isInteger)
    : undefined;

  const lines = await runScheduledOptions(ids);
  return Response.json({ ok: true, ids: ids ?? "all-active-options", lines });
}
