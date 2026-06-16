// Watchlist helpers. The Scanner has no hard-coded universe — it scans whatever
// is in this table. We seed a few sensible defaults the first time it's empty.

import { prisma } from "@/lib/db";

export const DEFAULT_WATCHLIST: { symbol: string; label: string }[] = [
  { symbol: "GC=F", label: "Gold" },
  { symbol: "BTC-USD", label: "Bitcoin" },
  { symbol: "EURUSD=X", label: "EUR/USD" },
  { symbol: "^GSPC", label: "S&P 500" },
  { symbol: "AAPL", label: "Apple" },
  { symbol: "NVDA", label: "NVIDIA" },
  { symbol: "PTT.BK", label: "PTT (SET)" },
  { symbol: "AOT.BK", label: "AOT (SET)" },
];

/** Return a portfolio's watchlist, seeding defaults the first time it's empty. */
export async function getWatchlist(portfolioId: number) {
  const count = await prisma.watchlist.count({ where: { portfolioId } });
  if (count === 0) {
    await prisma.watchlist.createMany({
      data: DEFAULT_WATCHLIST.map((w, i) => ({ ...w, sort: i, portfolioId })),
    });
  }
  return prisma.watchlist.findMany({ where: { portfolioId }, orderBy: { sort: "asc" } });
}

/** Normalize a user-entered symbol (uppercase, trimmed). */
export function normSymbol(s: string): string {
  return s.trim().toUpperCase();
}
