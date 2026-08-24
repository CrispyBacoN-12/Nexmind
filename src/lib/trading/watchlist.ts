// Watchlist helpers. The Scanner has no hard-coded universe — it scans whatever
// is in this table. We seed a few sensible defaults the first time it's empty.

import { prisma } from "@/lib/db";

// Stocks-only pivot (68becb9/6b54dee) narrowed the app to equities, but this
// seed still listed gold/crypto/forex/index tickers until 2026-08-24 — any
// portfolio created since the pivot would have been seeded with instruments
// the app no longer supports. Seed single-name equities only.
export const DEFAULT_WATCHLIST: { symbol: string; label: string }[] = [
  { symbol: "AAPL", label: "Apple" },
  { symbol: "NVDA", label: "NVIDIA" },
  { symbol: "PTT.BK", label: "PTT (SET)" },
  { symbol: "AOT.BK", label: "AOT (SET)" },
];

// Options portfolios can only trade names with a Yahoo option chain — that rules
// out futures (GC=F), crypto (BTC-USD), forex (EURUSD=X), indices (^GSPC), and
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
