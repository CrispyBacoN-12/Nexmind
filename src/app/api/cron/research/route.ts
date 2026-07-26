// Cron-triggered AI research round endpoint — the automated counterpart to
// manually running scripts/run-research-round.mts. Rotates through
// src/lib/research/scheduledResearch.ts's fixed (symbol, mechanism angle)
// list so repeated rounds explore different ground instead of re-proposing
// the same idea. Query params (?symbol=&interval=&range=&brief=) override
// the rotation pick for an on-demand run against a specific target.
//
// This only creates + in-sample-vets candidates (same as the manual path) —
// it does NOT auto-approve or auto-port into strategies.ts. That still goes
// through scripts/approve-strategy.ts's blind test gate by hand.
// Auth: requires `Authorization: Bearer $CRON_SECRET`, same as /api/cron/scan.
import { runScheduledResearchRound } from "@/lib/research/scheduledResearch";
import { assertCronAuth } from "@/lib/cronAuth";
import type { Interval, Range } from "@/lib/yahoo";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const unauthorized = assertCronAuth(req);
  if (unauthorized) return unauthorized;

  const params = new URL(req.url).searchParams;
  const symbol = params.get("symbol") ?? undefined;
  const interval = (params.get("interval") as Interval | null) ?? undefined;
  const range = (params.get("range") as Range | null) ?? undefined;
  const brief = params.get("brief") ?? undefined;
  const override = symbol || interval || range || brief ? { symbol, interval, range, brief } : undefined;

  try {
    const lines = await runScheduledResearchRound(override);
    return Response.json({ ok: true, lines });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
