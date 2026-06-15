// Pure predicates about a portfolio's lifecycle status.

/** Archived portfolios are skipped by scan/tick; active ones may trade. */
export function canPortfolioTrade(status: string): boolean {
  return status !== "archived";
}
