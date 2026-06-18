import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isOptionsKind } from "@/lib/portfolioGuards";
import { computeOptionStats } from "@/lib/options/optionStats";
import { fetchOptionChain } from "@/lib/options/chain";
import { greeks, RISK_FREE_RATE, type OptionType } from "@/lib/options/blackScholes";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const YEAR_S = 365.25 * 24 * 3600;
const mid = (q: { bid: number; ask: number; lastPrice: number }) =>
  q.bid > 0 && q.ask > 0 ? (q.bid + q.ask) / 2 : q.lastPrice;

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("portfolioId");
  const portfolioId = Number(raw);
  if (raw == null || raw === "" || !Number.isInteger(portfolioId)) return NextResponse.json({ error: "portfolioId is required" }, { status: 400 });
  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) return NextResponse.json({ error: "portfolio not found" }, { status: 404 });
  if (!isOptionsKind(portfolio.kind)) return NextResponse.json({ error: "not an options portfolio" }, { status: 409 });

  const positions = await prisma.optionHolding.findMany({ where: { portfolioId, status: "open" }, orderBy: { underlying: "asc" } });
  const nowSec = Math.floor(Date.now() / 1000);
  const premiumById = new Map<number, number | null>();
  const rows: Record<string, unknown>[] = [];

  for (const pos of positions) {
    let premium: number | null = null;
    let delta: number | null = null;
    let theta: number | null = null;
    try {
      const chain = await fetchOptionChain(pos.underlying, Math.floor(pos.expiry.getTime() / 1000));
      const q = (pos.type === "call" ? chain.calls : chain.puts).find((x) => x.strike === pos.strike);
      if (q) {
        premium = mid(q);
        const T = (q.expiry - nowSec) / YEAR_S;
        if (T > 0 && q.impliedVolatility > 0) {
          const g = greeks(pos.type as OptionType, chain.underlyingPrice, pos.strike, T, RISK_FREE_RATE, q.impliedVolatility);
          delta = g.delta; theta = g.theta;
        }
      }
    } catch { /* leave premium null */ }
    premiumById.set(pos.id, premium);
    rows.push({
      id: pos.id, underlying: pos.underlying, type: pos.type, strike: pos.strike, expiry: pos.expiry,
      contracts: pos.contracts, premiumPaid: pos.premiumPaid, premium,
      marketValue: pos.contracts * 100 * (premium ?? pos.premiumPaid), delta, theta,
    });
  }

  const stats = computeOptionStats(
    positions.map((p) => ({ id: p.id, underlying: p.underlying, type: p.type as OptionType, strike: p.strike, status: p.status, contracts: p.contracts, premiumPaid: p.premiumPaid, realizedPnl: p.realizedPnl })),
    (p) => premiumById.get(p.id) ?? null,
    portfolio.cash,
  );
  return NextResponse.json({ stats, holdings: rows, maxPositions: portfolio.maxOpenPositions });
}
