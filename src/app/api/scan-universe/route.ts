import { runTradeTick } from "@/lib/trading/engine";
import { manageOpenTrades } from "@/lib/trading/manage";
import { UNIVERSES, discoverActive, prepareSymbols } from "@/lib/trading/universe";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CONCURRENCY = 6;
const MAX_SYMBOLS = 120; // covers the full NASDAQ-100 preset in one pass

interface Row { symbol: string; outcome: string; tradeId?: number; costUsd: number; error?: string }

// Scan a US universe (preset) or discovered actives through the desk pipeline.
// POST { preset?: "us-mega"|"dow30"|"nasdaq100", discover?: boolean, max?: number }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const max = Math.min(typeof body.max === "number" ? body.max : MAX_SYMBOLS, MAX_SYMBOLS);

  // First close any positions that have hit TP/SL.
  const managed = await manageOpenTrades();

  // Build the symbol list.
  let raw: string[] = [];
  let source = "preset";
  if (body.discover) {
    raw = await discoverActive(max);
    source = "discover";
    if (raw.length === 0) return Response.json({ error: "discovery unavailable (Yahoo trending blocked) — try a preset", managed });
  } else {
    const preset = UNIVERSES[body.preset as string] ?? UNIVERSES["us-mega"];
    raw = preset.symbols;
    source = preset.label;
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
        const r = await runTradeTick(symbol);
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
  });
}
