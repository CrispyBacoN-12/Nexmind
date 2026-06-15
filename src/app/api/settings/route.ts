import { NextResponse } from "next/server";
import { getSetting, setSetting, getFearGreed, getMaxOpenPositions, getStartingBalance, getRiskPctPerTrade } from "@/lib/settings";

export const dynamic = "force-dynamic";

async function snapshot() {
  return NextResponse.json({
    killSwitch: (await getSetting("killSwitch", "false")) === "true",
    maxOpenPositions: await getMaxOpenPositions(),
    startingBalance: await getStartingBalance(),
    riskPctPerTrade: await getRiskPctPerTrade(),
    fearGreed: await getFearGreed(),
  });
}

export async function GET() {
  return snapshot();
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    killSwitch?: boolean;
    maxOpenPositions?: number;
    startingBalance?: number;
    riskPctPerTrade?: number;
  };
  if (typeof body.killSwitch === "boolean") await setSetting("killSwitch", String(body.killSwitch));
  if (typeof body.maxOpenPositions === "number" && body.maxOpenPositions > 0) {
    await setSetting("maxOpenPositions", String(Math.floor(body.maxOpenPositions)));
  }
  if (typeof body.startingBalance === "number" && body.startingBalance > 0) {
    await setSetting("startingBalance", String(body.startingBalance));
  }
  if (typeof body.riskPctPerTrade === "number" && body.riskPctPerTrade > 0) {
    await setSetting("riskPctPerTrade", String(body.riskPctPerTrade));
  }
  return snapshot();
}
