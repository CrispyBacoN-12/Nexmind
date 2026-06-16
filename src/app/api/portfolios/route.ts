import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { computePortfolioStats } from "@/lib/trading/portfolioStats";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const includeArchived = new URL(req.url).searchParams.get("includeArchived") === "1";
  const portfolios = await prisma.portfolio.findMany({
    where: includeArchived ? {} : { status: "active" },
    orderBy: { sort: "asc" },
  });
  const withStats = await Promise.all(
    portfolios.map(async (p) => {
      const trades = await prisma.trade.findMany({
        where: { portfolioId: p.id },
        select: { status: true, pnl: true, rMultiple: true, outcome: true, closedAt: true },
      });
      const stats = computePortfolioStats(trades, p.startingBalance);
      return { ...p, ...stats };
    }),
  );
  return NextResponse.json(withStats);
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as {
    name?: string; kind?: string; startingBalance?: number;
    riskPctPerTrade?: number; maxOpenPositions?: number; drawdownHaltPct?: number;
  };
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (b.startingBalance != null && !(b.startingBalance > 0)) return NextResponse.json({ error: "startingBalance must be > 0" }, { status: 400 });
  if (b.riskPctPerTrade != null && !(b.riskPctPerTrade > 0)) return NextResponse.json({ error: "riskPctPerTrade must be > 0" }, { status: 400 });
  if (b.maxOpenPositions != null && !(b.maxOpenPositions > 0)) return NextResponse.json({ error: "maxOpenPositions must be > 0" }, { status: 400 });
  if (b.drawdownHaltPct != null && !(b.drawdownHaltPct > 0)) return NextResponse.json({ error: "drawdownHaltPct must be > 0" }, { status: 400 });

  const maxSort = await prisma.portfolio.aggregate({ _max: { sort: true } });
  const kind = typeof b.kind === "string" && b.kind.trim() ? b.kind.trim() : "swing";
  const startingBalance = b.startingBalance ?? 10000;
  const created = await prisma.portfolio.create({
    data: {
      name,
      kind,
      startingBalance,
      cash: kind === "invest" ? startingBalance : 0,
      riskPctPerTrade: b.riskPctPerTrade ?? 1,
      maxOpenPositions: b.maxOpenPositions ? Math.floor(b.maxOpenPositions) : 5,
      drawdownHaltPct: b.drawdownHaltPct ?? 10,
      sort: (maxSort._max.sort ?? 0) + 1,
    },
  });
  return NextResponse.json(created, { status: 201 });
}
