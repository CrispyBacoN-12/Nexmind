// Cron-triggered scan endpoint. Replaces the local Windows Task Scheduler
// "NEXMIND ... scan" tasks now that the app runs on Vercel:
//   - vercel.json's native daily crons hit this with ?ids=8 (Gold Desk) and
//     ?ids=11 (US Stocks Desk) — Vercel Hobby only allows once-daily schedules.
//   - the GitHub Actions workflow hits this hourly with ?ids=9,10 (Bitcoin
//     Desk + BTC Rip-Sell Test), since that cadence exceeds Hobby's daily cap.
// Auth: requires `Authorization: Bearer $CRON_SECRET` (Vercel's own cron sends
// this automatically; the GitHub Actions workflow sends it manually).
import { runScheduledScan } from "@/lib/trading/runScan";
import { assertCronAuth } from "@/lib/cronAuth";
import { sendDiscordNotification } from "@/lib/notify/discord";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const unauthorized = assertCronAuth(req);
  if (unauthorized) return unauthorized;

  const idsParam = new URL(req.url).searchParams.get("ids");
  const ids = idsParam
    ? idsParam.split(",").map(Number).filter(Number.isInteger)
    : undefined;

  try {
    const lines = await runScheduledScan(ids);
    return Response.json({ ok: true, ids: ids ?? "all-active-swing", lines });
  } catch (e) {
    await sendDiscordNotification(`/api/cron/scan failed: ${String(e)}`, "critical");
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
