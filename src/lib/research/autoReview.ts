// Automatic approve/reject decision for a proposed ResearchStrategy candidate,
// replacing the human click that previously gated every candidate. A
// strategy still isn't live after this - "approved" only means it clears the
// bar for a human to consider porting into src/lib/trading/strategies.ts,
// same as manual approval always meant.
import type { BacktestSummary } from "@/lib/backtest/engine";

// Mirrors the bar research briefs already stated by hand ("fewer than 15
// trades was statistically untrustworthy"), with margin, plus a profit
// factor high enough to survive real-world slippage beyond the cost model.
export const MIN_TRADES = 20;
export const MIN_PROFIT_FACTOR = 1.1;

/**
 * `minTrades` is a parameter because the floor depends on what produced the
 * sample. 20 is right for one symbol; a panel of 491 correlated names needs an
 * order of magnitude more before its count means the same thing (see
 * MIN_PANEL_TRADES in panelRun.ts). The floor moves up, never down — no caller
 * may pass something below MIN_TRADES.
 */
export function autoReviewStatus(bt: BacktestSummary, safetyFlag: boolean, minTrades: number = MIN_TRADES): "approved" | "rejected" {
  if (safetyFlag) return "rejected";
  if (bt.trades < Math.max(minTrades, MIN_TRADES)) return "rejected";
  // expectancy has existed on every schema version this project has used
  // (profitFactor was added later - older rows simply lack the key, which
  // must not be read the same as "zero losing trades"), so it's the one
  // field guaranteed to catch a net-losing candidate.
  if (bt.expectancy == null || bt.expectancy <= 0) return "rejected";
  // null profitFactor on a current-schema row means zero losing trades -
  // strictly better than any finite ratio, so only a finite-and-low ratio
  // disqualifies a candidate.
  if (bt.profitFactor != null && bt.profitFactor < MIN_PROFIT_FACTOR) return "rejected";
  return "approved";
}
