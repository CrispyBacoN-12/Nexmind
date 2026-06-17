import { runTradeTick } from "@/lib/trading/engine";
import { prisma } from "@/lib/db";
import { canPortfolioTrade, isInvestKind } from "@/lib/portfolioGuards";
import { isGlobalTradingHalt } from "@/lib/settings";
import type { Interval, Range } from "@/lib/yahoo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const symbol = typeof body.symbol === "string" ? body.symbol.trim() : "";
  const portfolioId = Number(body.portfolioId);
  if (!symbol) return Response.json({ error: "symbol is required (e.g. GC=F, BTC-USD, EURUSD=X)" }, { status: 400 });
  if (!Number.isInteger(portfolioId)) return Response.json({ error: "portfolioId is required" }, { status: 400 });

  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) return Response.json({ error: "portfolio not found" }, { status: 404 });
  if (!canPortfolioTrade(portfolio.status)) return Response.json({ error: "portfolio is archived" }, { status: 409 });
  if (isInvestKind(portfolio.kind)) return Response.json({ error: "swing routes do not run on an invest portfolio" }, { status: 409 });
  if (await isGlobalTradingHalt()) return Response.json({ error: "global trading halt is on" }, { status: 409 });

  try {
    const result = await runTradeTick(symbol, portfolioId, {
      range: body.range as Range | undefined,
      interval: body.interval as Interval | undefined,
      lot: typeof body.lot === "number" ? body.lot : undefined,
    });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
