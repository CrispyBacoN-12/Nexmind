import { NextResponse } from "next/server";
import { getSetting, setSetting, getFearGreed } from "@/lib/settings";

export const dynamic = "force-dynamic";

async function snapshot() {
  return NextResponse.json({
    globalTradingHalt: (await getSetting("globalTradingHalt", "false")) === "true",
    fearGreed: await getFearGreed(),
  });
}

export async function GET() {
  return snapshot();
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { globalTradingHalt?: boolean };
  if (typeof body.globalTradingHalt === "boolean") {
    await setSetting("globalTradingHalt", String(body.globalTradingHalt));
  }
  return snapshot();
}
