// Pure predicates about a portfolio's lifecycle status.

/** Archived portfolios are skipped by scan/tick; active ones may trade. */
export function canPortfolioTrade(status: string): boolean {
  return status !== "archived";
}

/** An invest portfolio is buy-and-hold (advisory rebalance), not the swing desk. */
export function isInvestKind(kind: string): boolean {
  return kind === "invest";
}

/** An options portfolio runs the autonomous options desk. */
export function isOptionsKind(kind: string): boolean {
  return kind === "options";
}

/** A swing portfolio runs the autonomous trade desk (the default kind). */
export function isSwingKind(kind: string): boolean {
  return kind === "swing";
}
