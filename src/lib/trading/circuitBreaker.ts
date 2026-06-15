import { prisma } from "@/lib/db";
import type { ClosedTrade } from "./stats";

/**
 * Current drawdown as a percentage below the all-time equity peak.
 * 0 means equity is at or above its peak. Walks closed trades in
 * chronological order over startingBalance + cumulative pnl.
 */
export function currentDrawdownPct(closed: ClosedTrade[], startingBalance: number): number {
  const ordered = [...closed].sort((a, b) => (a.closedAt?.getTime() ?? 0) - (b.closedAt?.getTime() ?? 0));
  let equity = startingBalance;
  let peak = startingBalance;
  for (const t of ordered) {
    equity += t.pnl ?? 0;
    peak = Math.max(peak, equity);
  }
  return peak <= 0 ? 0 : Math.max(0, ((peak - equity) / peak) * 100);
}

/** Loads all closed trades and computes the current drawdown vs. the all-time equity peak. */
export async function getCurrentDrawdownPct(startingBalance: number): Promise<number> {
  const closed = await prisma.trade.findMany({
    where: { status: "closed" },
    orderBy: { closedAt: "asc" },
    select: { pnl: true, rMultiple: true, outcome: true, closedAt: true },
  });
  return currentDrawdownPct(closed.map((t) => ({ ...t, pnl: t.pnl ?? 0 })), startingBalance);
}
