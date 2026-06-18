import { runTradeTick } from "@/lib/trading/engine";
import { manageOpenTrades } from "@/lib/trading/manage";
import { getWatchlist } from "@/lib/trading/watchlist";
import { prisma } from "@/lib/db";
import { canPortfolioTrade, isSwingKind } from "@/lib/portfolioGuards";
import { isGlobalTradingHalt, getScanTimeframe } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const portfolioId = Number(body.portfolioId);
  if (!Number.isInteger(portfolioId)) return Response.json({ error: "portfolioId is required" }, { status: 400 });
  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) return Response.json({ error: "portfolio not found" }, { status: 404 });
  if (!canPortfolioTrade(portfolio.status)) return Response.json({ error: "portfolio is archived" }, { status: 409 });
  if (!isSwingKind(portfolio.kind)) return Response.json({ error: "not a swing portfolio" }, { status: 409 });
  if (await isGlobalTradingHalt()) return Response.json({ error: "global trading halt is on" }, { status: 409 });

  await manageOpenTrades(portfolioId);
  const tf = await getScanTimeframe(portfolioId);
  const list = (await getWatchlist(portfolioId)).filter((w) => w.enabled);
  const results: { symbol: string; outcome: string; steps: number; costUsd: number; tradeId?: number; error?: string }[] = [];
  let totalCost = 0;

  for (const w of list) {
    try {
      const r = await runTradeTick(w.symbol, portfolioId, { range: tf.range, interval: tf.interval });
      totalCost += r.costUsd;
      results.push({ symbol: w.symbol, outcome: r.outcome, steps: r.steps.length, costUsd: r.costUsd, tradeId: r.tradeId });
    } catch (e) {
      results.push({ symbol: w.symbol, outcome: "error", steps: 0, costUsd: 0, error: String(e) });
    }
  }

  const executed = results.filter((r) => r.outcome === "executed").length;
  return Response.json({ scanned: results.length, executed, totalCostUsd: totalCost, results });
}
