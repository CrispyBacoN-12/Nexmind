// Scheduled scan runner. Runs one swing trade-tick over the watchlist of each
// given portfolio id (or every active swing portfolio when no id is passed).
// Same pipeline as /api/scan-all, but standalone so Task Scheduler can drive it
// without the dev server running.
//
//   node --import tsx scripts/scan.mts 9      # scan portfolio 9 only
//   node --import tsx scripts/scan.mts        # scan all active swing portfolios
import { prisma } from "@/lib/db";
import { runTradeTick } from "@/lib/trading/engine";
import { manageOpenTrades } from "@/lib/trading/manage";
import { getWatchlist } from "@/lib/trading/watchlist";
import { getScanTimeframe, isGlobalTradingHalt } from "@/lib/settings";
import { isSwingKind, canPortfolioTrade } from "@/lib/portfolioGuards";

const ts = () => new Date().toISOString();
const argIds = process.argv.slice(2).map(Number).filter(Number.isInteger);

async function main() {
  if (await isGlobalTradingHalt()) {
    console.log(`[${ts()}] global trading halt is ON — skipping scan`);
    return;
  }
  const portfolios = await prisma.portfolio.findMany({
    where: argIds.length ? { id: { in: argIds } } : { status: "active", kind: "swing" },
  });
  if (portfolios.length === 0) { console.log(`[${ts()}] no matching portfolios`); return; }

  for (const p of portfolios) {
    if (!isSwingKind(p.kind) || !canPortfolioTrade(p.status)) {
      console.log(`[${ts()}] #${p.id} ${p.name} skipped (kind=${p.kind}, status=${p.status})`);
      continue;
    }
    await manageOpenTrades(p.id);
    const tf = await getScanTimeframe(p.id);
    const wl = (await getWatchlist(p.id)).filter((w) => w.enabled);
    for (const w of wl) {
      try {
        const r = await runTradeTick(w.symbol, p.id, { range: tf.range, interval: tf.interval });
        console.log(`[${ts()}] #${p.id} ${p.name} ${w.symbol} (${tf.interval}/${tf.range}) -> ${r.outcome}${r.tradeId ? ` trade#${r.tradeId}` : ""}`);
      } catch (e) {
        console.log(`[${ts()}] #${p.id} ${p.name} ${w.symbol} ERROR ${String(e)}`);
      }
    }
  }
}

main()
  .catch((e) => { console.log(`[${ts()}] FATAL ${String(e)}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
