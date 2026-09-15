import { NextResponse } from "next/server";
import { getSetting, setSetting, getFearGreed } from "@/lib/settings";
import { getRiskSentryHoldings, setRiskSentryHoldings } from "@/lib/riskSentry/holdings";

export const dynamic = "force-dynamic";

async function snapshot() {
  return NextResponse.json({
    globalTradingHalt: (await getSetting("globalTradingHalt", "false")) === "true",
    fearGreed: await getFearGreed(),
    riskSentryHoldings: await getRiskSentryHoldings(),
  });
}

export async function GET() {
  return snapshot();
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    globalTradingHalt?: boolean;
    riskSentryHoldings?: unknown;
  };
  if (typeof body.globalTradingHalt === "boolean") {
    await setSetting("globalTradingHalt", String(body.globalTradingHalt));
  }
  if (Array.isArray(body.riskSentryHoldings)) {
    await setRiskSentryHoldings(body.riskSentryHoldings);
  }
  return snapshot();
}
