// Applies one approved rebalance action to an invest portfolio's holdings + cash.
// Pure avg-cost helpers (buyInto/sellFrom) are unit-tested; executeAction wires
// them to the DB and re-prices at the live market price.

import { prisma } from "@/lib/db";
import { fetchCandles } from "@/lib/marketData";
import { isInvestKind } from "@/lib/portfolioGuards";
import type { ActionKind } from "./rebalance";

/** Weighted-average cost after buying `addShares` at `price`. */
export function buyInto(oldShares: number, oldAvg: number, addShares: number, price: number): { shares: number; avgCost: number } {
  const shares = oldShares + addShares;
  const avgCost = shares > 0 ? (oldShares * oldAvg + addShares * price) / shares : 0;
  return { shares, avgCost };
}

/** Result of selling `sellShares` (clamped to held) at `price`. avgCost is unchanged. */
export function sellFrom(oldShares: number, avgCost: number, sellShares: number, price: number): { shares: number; realizedPnlDelta: number; sold: boolean } {
  const qty = Math.min(sellShares, oldShares);
  const shares = oldShares - qty;
  return { shares, realizedPnlDelta: qty * (price - avgCost), sold: shares <= 0 };
}

export interface ExecuteAction { kind: ActionKind; symbol: string; shares: number }

/**
 * Apply one action at the live price. Returns a short result note.
 *
 * Error contract: THROWS for precondition errors (missing portfolio, non-invest
 * portfolio) and RETURNS `{ ok: false, note }` for business no-ops (no price,
 * insufficient cash, no holding) — so callers must both try/catch and check `ok`.
 */
export async function executeAction(portfolioId: number, action: ExecuteAction): Promise<{ ok: boolean; note: string }> {
  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) throw new Error(`portfolio ${portfolioId} not found`);
  if (!isInvestKind(portfolio.kind)) throw new Error("not an invest portfolio");
  if (!(action.shares > 0)) return { ok: false, note: "non-positive shares" };

  const resp = await fetchCandles(action.symbol, "1d", "5m");
  const price = resp.price ?? resp.candles.at(-1)?.c ?? null;
  if (price == null || !(price > 0)) return { ok: false, note: `no price for ${action.symbol}` };

  const existing = await prisma.holding.findFirst({ where: { portfolioId, symbol: action.symbol, status: "held" } }); // single open lot per (portfolio, symbol) — executeAction only ever maintains one held row

  if (action.kind === "buy" || action.kind === "add") {
    const maxShares = portfolio.cash / price;
    const shares = Math.min(action.shares, maxShares);
    if (!(shares > 0)) return { ok: false, note: "insufficient cash" };
    const cost = shares * price;
    await prisma.$transaction(async (tx) => {
      if (existing) {
        const next = buyInto(existing.shares, existing.avgCost, shares, price);
        await tx.holding.update({ where: { id: existing.id }, data: { shares: next.shares, avgCost: next.avgCost } });
      } else {
        await tx.holding.create({ data: { portfolioId, symbol: action.symbol, shares, avgCost: price } });
      }
      await tx.portfolio.update({ where: { id: portfolioId }, data: { cash: portfolio.cash - cost } });
    });
    return { ok: true, note: `${action.kind} ${shares.toFixed(4)} ${action.symbol} @ ${price.toFixed(2)}` };
  }

  // trim | sell
  if (!existing) return { ok: false, note: `no holding for ${action.symbol}` };
  const r = sellFrom(existing.shares, existing.avgCost, action.shares, price);
  const proceeds = (existing.shares - r.shares) * price;
  await prisma.$transaction(async (tx) => {
    await tx.holding.update({
      where: { id: existing.id },
      data: {
        shares: r.shares,
        realizedPnl: existing.realizedPnl + r.realizedPnlDelta,
        status: r.sold ? "sold" : "held",
        closedAt: r.sold ? new Date() : null,
      },
    });
    await tx.portfolio.update({ where: { id: portfolioId }, data: { cash: portfolio.cash + proceeds } });
  });
  return { ok: true, note: `${action.kind} ${(existing.shares - r.shares).toFixed(4)} ${action.symbol} @ ${price.toFixed(2)}` };
}
