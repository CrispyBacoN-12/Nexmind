import { NextResponse } from "next/server";
import { getSetting, setSetting, getFearGreed, getMaxOpenPositions } from "@/lib/settings";

export const dynamic = "force-dynamic";

async function snapshot() {
  return NextResponse.json({
    killSwitch: (await getSetting("killSwitch", "false")) === "true",
    maxOpenPositions: await getMaxOpenPositions(),
    fearGreed: await getFearGreed(),
  });
}

export async function GET() {
  return snapshot();
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { killSwitch?: boolean; maxOpenPositions?: number };
  if (typeof body.killSwitch === "boolean") await setSetting("killSwitch", String(body.killSwitch));
  if (typeof body.maxOpenPositions === "number" && body.maxOpenPositions > 0) {
    await setSetting("maxOpenPositions", String(Math.floor(body.maxOpenPositions)));
  }
  return snapshot();
}
