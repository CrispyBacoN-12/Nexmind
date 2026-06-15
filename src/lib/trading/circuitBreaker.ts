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
