import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ALLOWED_RANGES, ALLOWED_INTERVALS } from "@/lib/yahoo";
import { getStrategy } from "@/lib/trading/strategies";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const portfolioId = Number(id);
  if (!Number.isInteger(portfolioId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const b = (await req.json().catch(() => ({}))) as {
    killSwitch?: boolean; riskPctPerTrade?: number; maxOpenPositions?: number;
    startingBalance?: number; drawdownHaltPct?: number; status?: string; name?: string;
    scanInterval?: string; scanRange?: string; strategy?: string;
  };
  const data: Record<string, unknown> = {};
  if (typeof b.killSwitch === "boolean") {
    data.killSwitch = b.killSwitch;
    if (!b.killSwitch) data.killSwitchReason = "";
  }
  if (typeof b.riskPctPerTrade === "number" && b.riskPctPerTrade > 0) data.riskPctPerTrade = b.riskPctPerTrade;
  if (typeof b.maxOpenPositions === "number" && b.maxOpenPositions > 0) data.maxOpenPositions = Math.floor(b.maxOpenPositions);
  if (typeof b.startingBalance === "number" && b.startingBalance > 0) data.startingBalance = b.startingBalance;
  if (typeof b.drawdownHaltPct === "number" && b.drawdownHaltPct > 0) data.drawdownHaltPct = b.drawdownHaltPct;
  if (b.status === "active" || b.status === "archived") data.status = b.status;
  if (typeof b.name === "string" && b.name.trim()) data.name = b.name.trim();
  if (typeof b.scanInterval === "string" && (ALLOWED_INTERVALS as readonly string[]).includes(b.scanInterval)) data.scanInterval = b.scanInterval;
  if (typeof b.scanRange === "string" && (ALLOWED_RANGES as readonly string[]).includes(b.scanRange)) data.scanRange = b.scanRange;
  if (typeof b.strategy === "string" && getStrategy(b.strategy)) data.strategy = b.strategy;

  const updated = await prisma.portfolio.update({ where: { id: portfolioId }, data });
  return NextResponse.json(updated);
}
