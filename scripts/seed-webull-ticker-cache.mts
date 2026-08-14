// One-off/rerunnable: pre-warms WebullTickerCache for the equities universe
// so a fresh deploy or cache wipe doesn't hit Webull's ~60 req/60s rate
// limit cold during the first live scan (see docs/superpowers/specs/
// 2026-08-14-webull-data-provider-and-papertrade-shadow-design.md §3c).
// Usage:
//   node --import tsx scripts/seed-webull-ticker-cache.mts            # every watchlist symbol across all swing portfolios
//   node --import tsx scripts/seed-webull-ticker-cache.mts dow30      # a specific universe key from src/lib/trading/universe.ts
import { prisma } from "@/lib/db";
import { getTickerId } from "../src/lib/webull/symbols";
import { UNIVERSES } from "../src/lib/trading/universe";
import { getWatchlist } from "../src/lib/trading/watchlist";

const CONCURRENCY = 5; // stay well under Webull's ~60 req/60s ceiling

async function resolveSymbols(universeKey: string | undefined): Promise<string[]> {
  if (universeKey) {
    const uni = UNIVERSES[universeKey];
    if (!uni) throw new Error(`unknown universe "${universeKey}"`);
    return uni.symbols;
  }
  const portfolios = await prisma.portfolio.findMany({ where: { kind: "swing" } });
  const sets = await Promise.all(portfolios.map((p) => getWatchlist(p.id)));
  return [...new Set(sets.flat().map((w) => w.symbol))];
}

async function main() {
  const symbols = await resolveSymbols(process.argv[2]);
  console.log(`seeding WebullTickerCache for ${symbols.length} symbols (concurrency ${CONCURRENCY})...`);

  let ok = 0;
  let failed = 0;
  let next = 0;
  async function worker() {
    while (next < symbols.length) {
      const sym = symbols[next++];
      try {
        await getTickerId(sym);
        ok++;
      } catch (e) {
        failed++;
        console.warn(`  ${sym}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, symbols.length) }, worker));
  console.log(`done: ${ok} cached, ${failed} failed`);
}

main()
  .catch((e) => { console.error(`FATAL ${String(e)}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
