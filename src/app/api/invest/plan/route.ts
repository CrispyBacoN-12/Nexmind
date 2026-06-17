import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isInvestKind } from "@/lib/portfolioGuards";
import { getWatchlist } from "@/lib/trading/watchlist";
import { analyzeLongTerm } from "@/lib/invest/analyze";
import { computeInvestStats } from "@/lib/invest/investStats";
import { planRebalance, type CommitteeRead, type PlannerHolding, type Rating } from "@/lib/invest/rebalance";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const portfolioId = Number(body.portfolioId);
  if (!Number.isInteger(portfolioId)) return NextResponse.json({ error: "portfolioId is required" }, { status: 400 });
  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) return NextResponse.json({ error: "portfolio not found" }, { status: 404 });
  if (!isInvestKind(portfolio.kind)) return NextResponse.json({ error: "not an invest portfolio" }, { status: 409 });

  const holdings = await prisma.holding.findMany({ where: { portfolioId, status: "held" } });
  const watch = (await getWatchlist(portfolioId)).filter((w) => w.enabled).map((w) => w.symbol);
  const symbols = [...new Set([...watch, ...holdings.map((h) => h.symbol)])];

  const reads: CommitteeRead[] = [];
  const priceBySymbol = new Map<string, number>();
  for (const sym of symbols) {
    try {
      const r = await analyzeLongTerm(sym);
      reads.push({ symbol: r.symbol, rating: r.verdict.rating as Rating, entryHigh: r.verdict.entryHigh, price: r.price });
      priceBySymbol.set(r.symbol, r.price);
    } catch (e) {
      console.error(`invest/plan: skipping ${sym} —`, e);
    }
  }

  const priceOf = (s: string) => priceBySymbol.get(s) ?? null;
  const stats = computeInvestStats(holdings, priceOf, portfolio.cash);
  const plannerHoldings: PlannerHolding[] = holdings
    .filter((h) => priceBySymbol.has(h.symbol))
    .map((h) => ({ symbol: h.symbol, shares: h.shares, avgCost: h.avgCost, price: priceBySymbol.get(h.symbol)! }));

  const actions = planRebalance({
    holdings: plannerHoldings,
    reads,
    maxPositions: portfolio.maxOpenPositions,
    bandPct: portfolio.rebalanceBandPct,
    cash: portfolio.cash,
    equity: stats.equity,
  });

  return NextResponse.json({ stats, actions });
}
