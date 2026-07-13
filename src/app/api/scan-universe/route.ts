import { runTradeTick } from "@/lib/trading/engine";
import { manageOpenTrades } from "@/lib/trading/manage";
import { UNIVERSES, discoverActive, prepareSymbols } from "@/lib/trading/universe";
import { screenUniverse } from "@/lib/trading/screener";
import { prisma } from "@/lib/db";
import { canPortfolioTrade, isSwingKind } from "@/lib/portfolioGuards";
import { isGlobalTradingHalt, getScanTimeframe } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CONCURRENCY = 6;
const MAX_SYMBOLS = 120; // covers the full NASDAQ-100 preset in one pass

interface Row { symbol: string; outcome: string; tradeId?: number; costUsd: number; error?: string }

// Scan a US universe (preset) or discovered actives through the desk pipeline.
// POST { preset?: "us-mega"|"dow30"|"nasdaq100"|"sp500", discover?: boolean, max?: number }
// sp500 is pre-filtered through screener.ts (liquidity/ATR/no-bank) before scanning.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const portfolioId = Number(body.portfolioId);
  if (!Number.isInteger(portfolioId)) return Response.json({ error: "portfolioId is required" }, { status: 400 });
  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) return Response.json({ error: "portfolio not found" }, { status: 404 });
  if (!canPortfolioTrade(portfolio.status)) return Response.json({ error: "portfolio is archived" }, { status: 409 });
  if (!isSwingKind(portfolio.kind)) return Response.json({ error: "not a swing portfolio" }, { status: 409 });
  if (await isGlobalTradingHalt()) return Response.json({ error: "global trading halt is on" }, { status: 409 });
  const max = Math.min(typeof body.max === "number" ? body.max : MAX_SYMBOLS, MAX_SYMBOLS);

  // First close any positions that have hit TP/SL.
  const managed = await manageOpenTrades(portfolioId);
  const tf = await getScanTimeframe(portfolioId);

  // Build the symbol list.
  let raw: string[] = [];
  let source = "preset";
  let screenedOut: number | undefined;
  if (body.discover) {
    raw = await discoverActive(max);
    source = "discover";
    if (raw.length === 0) return Response.json({ error: "discovery unavailable (Yahoo trending blocked) — try a preset", managed });
  } else {
    const presetKey = body.preset as string;
    const preset = UNIVERSES[presetKey] ?? UNIVERSES["us-mega"];
    source = preset.label;
    if (presetKey === "sp500") {
      // sp500 is large and heterogeneous — narrow to liquid, tradeable-range,
      // non-bank names before spending AI calls on the pipeline (see screener.ts).
      const screened = await screenUniverse(preset.symbols);
      raw = screened.filter((r) => r.passed).map((r) => r.symbol);
      screenedOut = preset.symbols.length - raw.length;
      source = `${preset.label} (screened)`;
    } else {
      raw = preset.symbols;
    }
  }
  const symbols = prepareSymbols(raw, max);

  // Scan with a bounded concurrency pool. The Scanner (no AI) filters for free;
  // AI only fires on real setups, so most of a large scan costs nothing.
  const results: Row[] = [];
  let totalCost = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < symbols.length) {
      const symbol = symbols[cursor++];
      try {
        const r = await runTradeTick(symbol, portfolioId, { range: tf.range, interval: tf.interval });
        totalCost += r.costUsd;
        results.push({ symbol, outcome: r.outcome, tradeId: r.tradeId, costUsd: r.costUsd });
      } catch (e) {
        results.push({ symbol, outcome: "error", costUsd: 0, error: String(e) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, symbols.length) }, worker));

  const setups = results.filter((r) => ["executed", "vetoed", "no-consensus", "rules-blocked"].includes(r.outcome));
  return Response.json({
    source,
    scanned: results.length,
    executed: results.filter((r) => r.outcome === "executed").length,
    setups, // the interesting ones (Scanner found something)
    totalCostUsd: totalCost,
    managed: { checked: managed.checked, closed: managed.closed.length },
    ...(screenedOut != null ? { screenedOut } : {}),
  });
}
