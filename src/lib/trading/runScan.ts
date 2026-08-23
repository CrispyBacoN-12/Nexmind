// Scheduled scan orchestration, shared by the CLI script (scripts/scan.mts,
// for local Task Scheduler use) and the cron API routes (for Vercel/GitHub
// Actions triggers). For each given portfolio id (or every active swing
// portfolio when none passed): trade its watchlist, OR — when the portfolio
// has a `universe` set — auto-trade across that universe.
import { prisma } from "@/lib/db";
import { runTradeTick } from "@/lib/trading/engine";
import { manageOpenTrades, type ManageSummary } from "@/lib/trading/manage";
import { getStrategy } from "@/lib/trading/strategies";
import { getResearchStrategy } from "@/lib/research/adapter";
import { fetchCandlesBatch } from "@/lib/marketData";
import { adx } from "@/lib/indicators";
import { getWatchlist } from "@/lib/trading/watchlist";
import { UNIVERSES, prepareSymbols } from "@/lib/trading/universe";
import { getScanTimeframe, getPortfolioStrategy, getPortfolioUniverse, isGlobalTradingHalt, getDrawdownHaltPct, getSetting, setSetting } from "@/lib/settings";
import { isSwingKind, canPortfolioTrade } from "@/lib/portfolioGuards";
import { SECONDARY_PASSES } from "@/lib/trading/secondaryPasses";
import { getCurrentDrawdownPct } from "@/lib/trading/circuitBreaker";
import { sendDiscordNotification } from "@/lib/notify/discord";
import type { Interval, Range } from "@/lib/yahoo";

type Portfolio = Awaited<ReturnType<typeof prisma.portfolio.findMany>>[number];
type TF = Awaited<ReturnType<typeof getScanTimeframe>>;

/** Watchlist mode: one tick per enabled symbol. An `override` runs a second
 *  strategy/cadence pass on top of the portfolio's own default — this is how
 *  two merged desks (e.g. Gold Desk + ex-Gold Trend Desk) share one book. */
async function scanWatchlist(p: Portfolio, tf: TF, log: (m: string) => void, override?: { strategy: string; interval: Interval; range: Range; label: string }) {
  const wl = (await getWatchlist(p.id)).filter((w) => w.enabled);
  const range = override?.range ?? tf.range;
  const interval = override?.interval ?? tf.interval;
  const tag = override ? ` [+${override.label}]` : "";
  for (const w of wl) {
    try {
      const r = await runTradeTick(w.symbol, p.id, { range, interval, strategy: override?.strategy });
      const scanNote = r.steps.find((s) => s.stage === "scanner")?.note ?? "";
      const detail = r.outcome === "no-setup" && scanNote ? scanNote : `${r.outcome}${r.tradeId ? ` trade#${r.tradeId}` : ""}`;
      log(`#${p.id} ${p.name}${tag} ${w.symbol} (${interval}/${range}) -> ${detail}`);
      if (r.outcome === "executed" && r.tradeId) await notifyTradeOpened(p.name, w.symbol, r.tradeId);
    } catch (e) {
      log(`#${p.id} ${p.name}${tag} ${w.symbol} ERROR ${String(e)}`);
    }
  }
}

/** Universe mode: cheap Scanner pre-filter, then spend AI on the setups that
 *  can still become positions.
 *
 *  The free-slot budget is checked here, before HAWK, not only inside the Iron
 *  Rules after it. A state-based entry rule (trend-pullback is true for as long
 *  as the trend and the RSI band hold) keeps every one of its setups alive for
 *  the whole bar, so on a 1wk desk scanned every 15 minutes the same ~60 S&P
 *  names re-qualify on every tick all week. Letting them all through would spend
 *  four analyst calls each only for the Iron Rules to reject them for a cap that
 *  was already known before the first call was made. */
async function scanUniverse(p: Portfolio, tf: TF, universeKey: string, log: (m: string) => void) {
  const uni = UNIVERSES[universeKey];
  if (!uni) { log(`#${p.id} ${p.name} unknown universe "${universeKey}" — skipped`); return; }

  const open = await prisma.trade.findMany({ where: { status: "open", portfolioId: p.id }, select: { symbol: true } });
  const held = new Set(open.map((t) => t.symbol));

  let slots = p.maxOpenPositions - open.length;
  if (slots <= 0) {
    log(`#${p.id} ${p.name} universe=${universeKey}: ${open.length}/${p.maxOpenPositions} positions open, no free slot — not scanning`);
    return;
  }

  const strategy = await getPortfolioStrategy(p.id);
  const strat = getStrategy(strategy) ?? await getResearchStrategy(strategy);
  const symbols = prepareSymbols(uni.symbols, 200).filter((s) => !held.has(s));

  const candleMap = await fetchCandlesBatch(symbols, tf.range, tf.interval);
  const candidates: { symbol: string; adx: number }[] = [];
  for (const s of symbols) {
    const resp = candleMap.get(s);
    if (!resp || !strat || resp.candles.length < 60) continue;
    const sig = strat.build(resp.candles)(resp.candles.length - 1);
    if (sig?.side) {
      const a = adx(resp.candles, 14).adx;
      candidates.push({ symbol: resp.symbol, adx: a[a.length - 1] ?? 0 });
    }
  }
  // Which setups get the free slots. Iterating the universe in its own order
  // hands them to the same alphabetical head every week (AAPL, ABBV, ACN, ...),
  // which is not a neutral sample of the rule — it is a five-name portfolio.
  // Strongest trend first is at least a property of the setup rather than of the
  // ticker's spelling. It is a tie-break among setups the rule already accepted,
  // NOT a filter: it cannot remove a trade, only reorder who is served first.
  // Untested as a ranking — worth its own sweep before anyone trusts it.
  candidates.sort((a, b) => b.adx - a.adx);
  log(`#${p.id} ${p.name} universe=${universeKey}: ${candidates.length} setups / ${candleMap.size} fetched, ${slots} slot(s) free`);

  for (const [n, c] of candidates.entries()) {
    if (slots <= 0) {
      log(`#${p.id} ${p.name} position cap ${p.maxOpenPositions} reached — ${candidates.length - n} setup(s) left unspent`);
      break;
    }
    try {
      const r = await runTradeTick(c.symbol, p.id, { range: tf.range, interval: tf.interval });
      log(`#${p.id} ${p.name} ${c.symbol} -> ${r.outcome}${r.tradeId ? ` trade#${r.tradeId}` : ""}`);
      if (r.outcome === "executed" && r.tradeId) {
        slots--;
        await notifyTradeOpened(p.name, c.symbol, r.tradeId);
      }
    } catch (e) {
      log(`#${p.id} ${p.name} ${c.symbol} ERROR ${String(e)}`);
    }
  }
}

/** Runs the scheduled scan for `ids` (or every active swing portfolio when
 *  omitted). Returns the log lines AND persists them to the ScanLog table —
 *  scans run on GitHub Actions runners and Vercel serverless functions, which
 *  share no filesystem with each other or with the app that renders the
 *  Activity page, so a shared Postgres row is the only durable option. */
export async function runScheduledScan(ids?: number[]): Promise<string[]> {
  const lines: string[] = [];
  const log = (m: string) => lines.push(`[${new Date().toISOString()}] ${m}`);

  if (await isGlobalTradingHalt()) { log("global trading halt is ON — skipping scan"); return persistAndReturn(lines); }
  const portfolios = await prisma.portfolio.findMany({
    where: ids && ids.length ? { id: { in: ids } } : { status: "active", kind: "swing" },
  });
  if (portfolios.length === 0) { log("no matching portfolios"); return persistAndReturn(lines); }

  for (const p of portfolios) {
    if (!isSwingKind(p.kind) || !canPortfolioTrade(p.status)) {
      log(`#${p.id} ${p.name} skipped (kind=${p.kind}, status=${p.status})`);
      continue;
    }
    const managed = await manageOpenTrades(p.id);
    await notifyClosedTrades(p.name, managed);
    await checkDrawdownAlert(p.id, p.name);

    const tf = await getScanTimeframe(p.id);
    const universe = await getPortfolioUniverse(p.id);
    if (universe) await scanUniverse(p, tf, universe, log);
    else await scanWatchlist(p, tf, log);

    for (const sp of SECONDARY_PASSES.filter((s) => s.portfolioId === p.id)) {
      await scanWatchlist(p, tf, log, { strategy: sp.strategy, interval: sp.interval as Interval, range: sp.range as Range, label: sp.label });
    }
  }

  return persistAndReturn(lines);
}

async function persistAndReturn(lines: string[]): Promise<string[]> {
  if (lines.length > 0) {
    await prisma.scanLog.createMany({ data: lines.map((message) => ({ message })) });
  }
  return lines;
}

// ---- notifications ----

async function notifyTradeOpened(portfolioName: string, symbol: string, tradeId: number): Promise<void> {
  const t = await prisma.trade.findUnique({ where: { id: tradeId }, select: { side: true, entry: true, sl: true, tp1: true, lot: true } });
  if (!t) return;
  await sendDiscordNotification(
    `**${portfolioName}** opened ${t.side.toUpperCase()} ${symbol} @ ${t.entry.toFixed(4)} · SL ${t.sl.toFixed(4)} · TP1 ${t.tp1.toFixed(4)} · ${t.lot} lot (trade#${tradeId})`,
    "info",
  );
}

async function notifyClosedTrades(portfolioName: string, managed: ManageSummary): Promise<void> {
  for (const c of managed.closed) {
    const level = c.outcome === "loss" ? "warning" : "info";
    const sign = c.pnl >= 0 ? "+" : "";
    await sendDiscordNotification(
      `**${portfolioName}** closed ${c.symbol} — ${c.outcome} @ ${c.exit.toFixed(4)} (${sign}${c.pnl.toFixed(2)}) (trade#${c.id})`,
      level,
    );
  }
}

/** Notifies once on the transition into a drawdown breach (vs the portfolio's
 *  own drawdownHaltPct), and once again on recovery — not on every scan tick
 *  while still in breach. State tracked via a per-portfolio Setting key since
 *  there's no other persistent per-portfolio scratch space for this. */
async function checkDrawdownAlert(portfolioId: number, portfolioName: string): Promise<void> {
  const [pct, haltPct, wasBreached] = await Promise.all([
    getCurrentDrawdownPct(portfolioId),
    getDrawdownHaltPct(portfolioId),
    getSetting(`drawdownBreach:${portfolioId}`, "false"),
  ]);
  const isBreached = pct >= haltPct;
  if (isBreached === (wasBreached === "true")) return;

  await setSetting(`drawdownBreach:${portfolioId}`, String(isBreached));
  if (isBreached) {
    await sendDiscordNotification(
      `**${portfolioName}** drawdown ${pct.toFixed(1)}% has crossed its ${haltPct}% halt threshold`,
      "critical",
    );
  } else {
    await sendDiscordNotification(`**${portfolioName}** drawdown ${pct.toFixed(1)}% has recovered below its ${haltPct}% threshold`, "info");
  }
}
