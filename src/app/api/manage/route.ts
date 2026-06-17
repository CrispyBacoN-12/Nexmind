import { manageOpenTrades } from "@/lib/trading/manage";
import { prisma } from "@/lib/db";
import { isSwingKind } from "@/lib/portfolioGuards";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const portfolioId = Number(body.portfolioId);
  if (!Number.isInteger(portfolioId)) return Response.json({ error: "portfolioId is required" }, { status: 400 });

  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) return Response.json({ error: "portfolio not found" }, { status: 404 });
  if (!isSwingKind(portfolio.kind)) return Response.json({ error: "not a swing portfolio" }, { status: 409 });

  const summary = await manageOpenTrades(portfolioId);
  return Response.json(summary);
}
