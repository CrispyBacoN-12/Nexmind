// Scheduled scan runner. For each given portfolio id (or every active swing
// portfolio when none passed): trade its watchlist, OR — when the portfolio has
// a `universe` set — auto-trade across that universe. Standalone so Task
// Scheduler can drive it without the dev server running.
//
//   node --import tsx scripts/scan.mts 9      # scan portfolio 9 only
//   node --import tsx scripts/scan.mts        # scan all active swing portfolios
import { prisma } from "@/lib/db";
import { runTradeTick } from "@/lib/trading/engine";
import { manageOpenTrades } from "@/lib/trading/manage";
import { scanSymbol } from "@/lib/trading/scanner";
import { getWatchlist } from "@/lib/trading/watchlist";
import { UNIVERSES, prepareSymbols } from "@/lib/trading/universe";
import { getScanTimeframe, getPortfolioStrategy, getPortfolioUniverse, isGlobalTradingHalt } from "@/lib/settings";
import { isSwingKind, canPortfolioTrade } from "@/lib/portfolioGuards";

type Portfolio = Awaited<ReturnType<typeof prisma.portfolio.findMany>>[number];
type TF = Awaited<ReturnType<typeof getScanTimeframe>>;

const ts = () => new Date().toISOString();
const log = (m: string) => console.log(`[${ts()}] ${m}`);
const argIds = process.argv.slice(2).map(Number).filter(Number.isInteger);

/** Watchlist mode: one tick per enabled symbol. */
async function scanWatchlist(p: Portfolio, tf: TF) {
  const wl = (await getWatchlist(p.id)).filter((w) => w.enabled);
  for (const w of wl) {
    try {
      const r = await runTradeTick(w.symbol, p.id, { range: tf.range, interval: tf.interval });
      log(`#${p.id} ${p.name} ${w.symbol} (${tf.interval}/${tf.range}) -> ${r.outcome}${r.tradeId ? ` trade#${r.tradeId}` : ""}`);
    } catch (e) {
      log(`#${p.id} ${p.name} ${w.symbol} ERROR ${String(e)}`);
    }
  }
}

/** Universe mode: cheap Scanner pre-filter, then spend AI only on as many
 *  candidates as there are open slots (maxOpenPositions − currently open). */
async function scanUniverse(p: Portfolio, tf: TF, universeKey: string) {
  const uni = UNIVERSES[universeKey];
  if (!uni) { log(`#${p.id} ${p.name} unknown universe "${universeKey}" — skipped`); return; }

  const open = await prisma.trade.findMany({ where: { status: "open", portfolioId: p.id }, select: { symbol: true } });
  const held = new Set(open.map((t) => t.symbol));
  const remaining = p.maxOpenPositions - open.length;
  if (remaining <= 0) { log(`#${p.id} ${p.name} full (${open.length}/${p.maxOpenPositions}) — skipped`); return; }

  const strategy = await getPortfolioStrategy(p.id);
  const symbols = prepareSymbols(uni.symbols, 200).filter((s) => !held.has(s));

  // Cheap pass (no AI): keep only symbols with a fresh setup.
  const candidates: string[] = [];
  for (const s of symbols) {
    try {
      const scan = await scanSymbol(s, tf.range, tf.interval, strategy);
      if (scan.side) candidates.push(scan.symbol);
    } catch { /* skip unfetchable symbol */ }
  }
  log(`#${p.id} ${p.name} universe=${universeKey}: ${candidates.length} setups / ${symbols.length} scanned, ${remaining} slot(s) open`);

  // Spend AI only up to the open-slot budget.
  let aiUsed = 0;
  let heldCount = open.length;
  for (const s of candidates) {
    if (aiUsed >= remaining || heldCount >= p.maxOpenPositions) break;
    aiUsed++;
    try {
      const r = await runTradeTick(s, p.id, { range: tf.range, interval: tf.interval });
      if (r.outcome === "executed") heldCount++;
      log(`#${p.id} ${p.name} ${s} -> ${r.outcome}${r.tradeId ? ` trade#${r.tradeId}` : ""}`);
    } catch (e) {
      log(`#${p.id} ${p.name} ${s} ERROR ${String(e)}`);
    }
  }
}

async function main() {
  if (await isGlobalTradingHalt()) { log("global trading halt is ON — skipping scan"); return; }
  const portfolios = await prisma.portfolio.findMany({
    where: argIds.length ? { id: { in: argIds } } : { status: "active", kind: "swing" },
  });
  if (portfolios.length === 0) { log("no matching portfolios"); return; }

  for (const p of portfolios) {
    if (!isSwingKind(p.kind) || !canPortfolioTrade(p.status)) {
      log(`#${p.id} ${p.name} skipped (kind=${p.kind}, status=${p.status})`);
      continue;
    }
    await manageOpenTrades(p.id);
    const tf = await getScanTimeframe(p.id);
    const universe = await getPortfolioUniverse(p.id);
    if (universe) await scanUniverse(p, tf, universe);
    else await scanWatchlist(p, tf);
  }
}

main()
  .catch((e) => { log(`FATAL ${String(e)}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
