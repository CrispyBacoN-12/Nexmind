// Risk Sentry's manual extras: names held outside the journal. Open journal
// positions are watched automatically and are not stored here.
// Moved out of /api/settings when the desk-era settings page was removed.

import { getRiskSentryHoldings, setRiskSentryHoldings } from "@/lib/riskSentry/holdings";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ holdings: await getRiskSentryHoldings() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { holdings?: unknown };
  if (!Array.isArray(body.holdings)) {
    return Response.json({ error: "holdings must be an array of tickers" }, { status: 400 });
  }
  await setRiskSentryHoldings(body.holdings.map((h) => String(h ?? "")));
  return Response.json({ holdings: await getRiskSentryHoldings() });
}
