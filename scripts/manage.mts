// Position-manager runner (NO AI). Checks every open swing trade against the
// live price and closes at SL/TP1/TP2 via the ladder rules. Cheap, so it runs
// frequently to give timely exits regardless of each desk's (AI-expensive) scan
// cadence — the daily stock/gold desks otherwise only check exits once a day.
//
//   node --import tsx scripts/manage.mts        # manage all active swing portfolios
//   node --import tsx scripts/manage.mts 11     # just portfolio 11
import { prisma } from "@/lib/db";
import { manageOpenTrades } from "@/lib/trading/manage";
import { isSwingKind, canPortfolioTrade } from "@/lib/portfolioGuards";

const ts = () => new Date().toISOString();
const log = (m: string) => console.log(`[${ts()}] ${m}`);
const argIds = process.argv.slice(2).map(Number).filter(Number.isInteger);

async function main() {
  const portfolios = await prisma.portfolio.findMany({
    where: argIds.length ? { id: { in: argIds } } : { status: "active", kind: "swing" },
  });
  for (const p of portfolios) {
    if (!isSwingKind(p.kind) || !canPortfolioTrade(p.status)) continue;
    try {
      const r = await manageOpenTrades(p.id);
      if (r.checked === 0) continue; // stay quiet when there's nothing open
      log(`#${p.id} ${p.name}: managed ${r.checked} open (closed ${r.closed.length}, tp1 ${r.partials.length})`);
      for (const c of r.closed) log(`  CLOSE ${c.symbol} ${c.outcome} @ ${c.price.toFixed(2)} pnl=${c.pnl.toFixed(2)}`);
      for (const pt of r.partials) log(`  TP1 ${pt.symbol} half @ ${pt.exit.toFixed(2)} banked=${pt.bankedPnl.toFixed(2)}`);
    } catch (e) {
      log(`#${p.id} ${p.name} manage ERROR ${String(e)}`);
    }
  }
}

main()
  .catch((e) => { log(`FATAL ${String(e)}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
