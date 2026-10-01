// Cron-triggered Risk Sentry: an unattended daily risk-monitoring check against
// whatever the owner actually holds. Read-only — no entry, exit, size, or fill
// path; see docs/superpowers/specs/2026-09-16-risk-sentry-design.md §0 for why
// this is not a resumption of the paused autonomous desk.
// Auth: requires `Authorization: Bearer $CRON_SECRET`, same as every other
// /api/cron/* route (mirrors src/app/api/cron/scan/route.ts's shape).

import { runRiskSentry } from "@/lib/riskSentry/runRiskSentry";
import { getJournalOpenPositions, getRiskSentryHoldings, setRiskSentryHoldings } from "@/lib/riskSentry/holdings";
import { fetchCandles, fetchCandlesBatch } from "@/lib/marketData";
import { fetchNextEarnings } from "@/lib/market/earnings";
import { getSetting, setSetting } from "@/lib/settings";
import { assertCronAuth } from "@/lib/cronAuth";
import { sendDiscordNotification } from "@/lib/notify/discord";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const unauthorized = assertCronAuth(req);
  if (unauthorized) return unauthorized;

  try {
    const summary = await runRiskSentry({
      getRiskSentryHoldings,
      getJournalOpenPositions,
      setRiskSentryHoldings,
      fetchCandlesBatch,
      fetchCandles,
      fetchNextEarnings,
      getSetting,
      setSetting,
    });
    if (summary.message) await sendDiscordNotification(summary.message, "warning");
    return Response.json({ ok: true, ...summary });
  } catch (e) {
    await sendDiscordNotification(`/api/cron/risk-sentry failed: ${String(e)}`, "critical");
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
