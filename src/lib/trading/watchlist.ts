// Watchlist helpers. The Scanner has no hard-coded universe — it scans whatever
// is in this table. We seed a few sensible defaults the first time it's empty.

import { prisma } from "@/lib/db";

export const DEFAULT_WATCHLIST: { symbol: string; label: string }[] = [
  { symbol: "XAUUSD", label: "Gold" },
  { symbol: "BTC-USD", label: "Bitcoin" },
  { symbol: "EURUSD", label: "EUR/USD" },
  { symbol: "^GSPC", label: "S&P 500" },
  { symbol: "AAPL", label: "Apple" },
  { symbol: "NVDA", label: "NVIDIA" },
  { symbol: "PTT.BK", label: "PTT (SET)" },
  { symbol: "AOT.BK", label: "AOT (SET)" },
];

// Options portfolios can only trade names with a Yahoo option chain — that rules
// out spot gold (XAUUSD), crypto (BTC-USD), forex (EURUSD), indices (^GSPC), and
// SET stocks. Seed liquid US single-name options instead.
export const OPTIONS_WATCHLIST: { symbol: string; label: string }[] = [
  { symbol: "AAPL", label: "Apple" },
  { symbol: "NVDA", label: "NVIDIA" },
  { symbol: "MSFT", label: "Microsoft" },
  { symbol: "TSLA", label: "Tesla" },
  { symbol: "AMZN", label: "Amazon" },
  { symbol: "META", label: "Meta" },
  { symbol: "GOOGL", label: "Alphabet" },
  { symbol: "AMD", label: "AMD" },
];

/** Return a portfolio's watchlist, seeding defaults the first time it's empty.
 *  Options portfolios get an options-tradable (US single-name) seed. */
export async function getWatchlist(portfolioId: number) {
  const count = await prisma.watchlist.count({ where: { portfolioId } });
  if (count === 0) {
    const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId }, select: { kind: true } });
    const seed = portfolio?.kind === "options" ? OPTIONS_WATCHLIST : DEFAULT_WATCHLIST;
    await prisma.watchlist.createMany({
      data: seed.map((w, i) => ({ ...w, sort: i, portfolioId })),
    });
  }
  return prisma.watchlist.findMany({ where: { portfolioId }, orderBy: { sort: "asc" } });
}

/** Normalize a user-entered symbol (uppercase, trimmed). */
export function normSymbol(s: string): string {
  return s.trim().toUpperCase();
}
