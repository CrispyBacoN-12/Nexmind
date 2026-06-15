import { NextResponse } from "next/server";
import { getSetting, setSetting, getFearGreed, getMaxOpenPositions, getStartingBalance, getRiskPctPerTrade, getDrawdownHaltPct, getKillSwitchReason } from "@/lib/settings";
import { prisma } from "@/lib/db";
import { currentDrawdownPct } from "@/lib/trading/circuitBreaker";

export const dynamic = "force-dynamic";

async function snapshot() {
  const [closed, startingBalance] = await Promise.all([
    prisma.trade.findMany({
      where: { status: "closed" },
      orderBy: { closedAt: "asc" },
      select: { pnl: true, rMultiple: true, outcome: true, closedAt: true },
    }),
    getStartingBalance(),
  ]);
  return NextResponse.json({
    killSwitch: (await getSetting("killSwitch", "false")) === "true",
    killSwitchReason: await getKillSwitchReason(),
    maxOpenPositions: await getMaxOpenPositions(),
    startingBalance,
    riskPctPerTrade: await getRiskPctPerTrade(),
    drawdownHaltPct: await getDrawdownHaltPct(),
    currentDrawdownPct: currentDrawdownPct(closed.map((t) => ({ ...t, pnl: t.pnl ?? 0 })), startingBalance),
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
    drawdownHaltPct?: number;
  };
  if (typeof body.killSwitch === "boolean") {
    await setSetting("killSwitch", String(body.killSwitch));
    if (!body.killSwitch) await setSetting("killSwitchReason", "");
  }
  if (typeof body.maxOpenPositions === "number" && body.maxOpenPositions > 0) {
    await setSetting("maxOpenPositions", String(Math.floor(body.maxOpenPositions)));
  }
  if (typeof body.startingBalance === "number" && body.startingBalance > 0) {
    await setSetting("startingBalance", String(body.startingBalance));
  }
  if (typeof body.riskPctPerTrade === "number" && body.riskPctPerTrade > 0) {
    await setSetting("riskPctPerTrade", String(body.riskPctPerTrade));
  }
  if (typeof body.drawdownHaltPct === "number" && body.drawdownHaltPct > 0) {
    await setSetting("drawdownHaltPct", String(body.drawdownHaltPct));
  }
  return snapshot();
}
