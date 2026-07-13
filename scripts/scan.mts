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
import { getStrategy } from "@/lib/trading/strategies";
import { getResearchStrategy } from "@/lib/research/adapter";
import { fetchCandlesBatch } from "@/lib/marketData";
import { getWatchlist } from "@/lib/trading/watchlist";
import { UNIVERSES, prepareSymbols } from "@/lib/trading/universe";
import { getScanTimeframe, getPortfolioStrategy, getPortfolioUniverse, isGlobalTradingHalt } from "@/lib/settings";
import { isSwingKind, canPortfolioTrade } from "@/lib/portfolioGuards";
import { SECONDARY_PASSES } from "@/lib/trading/secondaryPasses";
import type { Interval, Range } from "@/lib/yahoo";

type Portfolio = Awaited<ReturnType<typeof prisma.portfolio.findMany>>[number];
type TF = Awaited<ReturnType<typeof getScanTimeframe>>;

const ts = () => new Date().toISOString();
const log = (m: string) => console.log(`[${ts()}] ${m}`);
const argIds = process.argv.slice(2).map(Number).filter(Number.isInteger);

/** Watchlist mode: one tick per enabled symbol. An `override` runs a second
 *  strategy/cadence pass on top of the portfolio's own default — this is how
 *  two merged desks (e.g. Gold Desk + ex-Gold Trend Desk) share one book. */
async function scanWatchlist(p: Portfolio, tf: TF, override?: { strategy: string; interval: Interval; range: Range; label: string }) {
  const wl = (await getWatchlist(p.id)).filter((w) => w.enabled);
  const range = override?.range ?? tf.range;
  const interval = override?.interval ?? tf.interval;
  const tag = override ? ` [+${override.label}]` : "";
  for (const w of wl) {
    try {
      const r = await runTradeTick(w.symbol, p.id, { range, interval, strategy: override?.strategy });
      // On no-setup, log the scanner's reason (ADX/RSI/trend) instead of a bare outcome.
      const scanNote = r.steps.find((s) => s.stage === "scanner")?.note ?? "";
      const detail = r.outcome === "no-setup" && scanNote ? scanNote : `${r.outcome}${r.tradeId ? ` trade#${r.tradeId}` : ""}`;
      log(`#${p.id} ${p.name}${tag} ${w.symbol} (${interval}/${range}) -> ${detail}`);
    } catch (e) {
      log(`#${p.id} ${p.name}${tag} ${w.symbol} ERROR ${String(e)}`);
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
  const strat = getStrategy(strategy) ?? await getResearchStrategy(strategy);
  const symbols = prepareSymbols(uni.symbols, 200).filter((s) => !held.has(s));

  // Cheap pass (no AI): batch-fetch candles once, then run the strategy locally.
  const candleMap = await fetchCandlesBatch(symbols, tf.range, tf.interval);
  const candidates: string[] = [];
  for (const s of symbols) {
    const resp = candleMap.get(s);
    if (!resp || !strat || resp.candles.length < 60) continue;
    const sig = strat.build(resp.candles)(resp.candles.length - 1);
    if (sig?.side) candidates.push(resp.symbol);
  }
  log(`#${p.id} ${p.name} universe=${universeKey}: ${candidates.length} setups / ${candleMap.size} fetched, ${remaining} slot(s) open`);

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

    for (const sp of SECONDARY_PASSES.filter((s) => s.portfolioId === p.id)) {
      await scanWatchlist(p, tf, { strategy: sp.strategy, interval: sp.interval as Interval, range: sp.range as Range, label: sp.label });
    }
  }
}

main()
  .catch((e) => { log(`FATAL ${String(e)}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
