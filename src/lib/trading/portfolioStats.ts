// Pure per-portfolio aggregation over a portfolio's trades. No DB access — the
// caller supplies the trade rows and the portfolio's starting balance.

import { currentDrawdownPct } from "./circuitBreaker";
import type { ClosedTrade } from "./stats";

export interface PortfolioTrade {
  status: string;
  pnl: number | null;
  rMultiple: number | null;
  outcome: string | null;
  closedAt: Date | null;
}

export interface PortfolioStats {
  equity: number;        // startingBalance + realized P/L
  realizedPnl: number;   // sum of closed-trade pnl
  openCount: number;     // number of open trades
  currentDrawdownPct: number; // non-negative % below the all-time equity peak
}

export function computePortfolioStats(trades: PortfolioTrade[], startingBalance: number): PortfolioStats {
  const closed = trades.filter((t) => t.status === "closed");
  const realizedPnl = closed.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const openCount = trades.filter((t) => t.status === "open").length;
  const closedForDd: ClosedTrade[] = closed.map((t) => ({
    pnl: t.pnl ?? 0, rMultiple: t.rMultiple, outcome: t.outcome, closedAt: t.closedAt,
  }));
  return {
    equity: startingBalance + realizedPnl,
    realizedPnl,
    openCount,
    currentDrawdownPct: currentDrawdownPct(closedForDd, startingBalance),
  };
}
