import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isInvestKind } from "@/lib/portfolioGuards";
import { computeInvestStats } from "@/lib/invest/investStats";
import { fetchCandles } from "@/lib/marketData";

export const dynamic = "force-dynamic";

async function priceMap(symbols: string[]): Promise<(s: string) => number | null> {
  const entries = await Promise.all(symbols.map(async (sym) => {
    try { const r = await fetchCandles(sym, "1d", "5m"); return [sym, r.price ?? r.candles.at(-1)?.c ?? null] as const; }
    catch { return [sym, null] as const; }
  }));
  const m = new Map(entries);
  return (s: string) => m.get(s) ?? null;
}

export async function GET(req: Request) {
  const portfolioId = Number(new URL(req.url).searchParams.get("portfolioId"));
  if (!Number.isInteger(portfolioId)) return NextResponse.json({ error: "portfolioId is required" }, { status: 400 });
  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) return NextResponse.json({ error: "portfolio not found" }, { status: 404 });
  if (!isInvestKind(portfolio.kind)) return NextResponse.json({ error: "not an invest portfolio" }, { status: 409 });

  const holdings = await prisma.holding.findMany({ where: { portfolioId }, orderBy: { symbol: "asc" } });
  const heldSymbols = holdings.filter((h) => h.status === "held").map((h) => h.symbol);
  const priceOf = await priceMap(heldSymbols);
  const stats = computeInvestStats(holdings, priceOf, portfolio.cash);
  const held = holdings.filter((h) => h.status === "held").map((h) => ({
    ...h, price: priceOf(h.symbol), marketValue: h.shares * (priceOf(h.symbol) ?? h.avgCost),
  }));
  return NextResponse.json({ stats, holdings: held, maxPositions: portfolio.maxOpenPositions });
}
