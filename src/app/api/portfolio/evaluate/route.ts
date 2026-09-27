// The portfolio gates for one advisor ticket. Reads the journal (open trades,
// NAV log), fetches the three market facts the gates need (sector,
// correlations, SPY regime), and runs evaluatePortfolio non-strict: a failed
// gate can be un-blocked by a written reason. With commit=true and the ticket
// unlocked, every overridden gate is written to GateOverride — the audit log
// is the price of an override. All gate logic is in src/lib/portfolio/.

import { prisma } from "@/lib/db";
import { fetchFundamentals } from "@/lib/market/fundamentals";
import { BENCHMARK } from "@/lib/market/regime";
import { fetchCandles } from "@/lib/marketData";
import { evaluatePortfolio } from "@/lib/portfolio/evaluate";
import { navPoints, slotsFromJournal } from "@/lib/portfolio/journalInput";
import { dateAlignedCorrelation, regimeFromBenchmark } from "@/lib/portfolio/marketInputs";
import { resolveGicsSector } from "@/lib/portfolio/sectorMap";
import { GATE_ORDER, type GateName } from "@/lib/portfolio/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TICKER_RE = /^[A-Z][A-Z.\-]{0,9}$/;
const bad = (error: string, status = 400) => Response.json({ ok: false, error }, { status });

const positive = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const ticker = String(body.ticker ?? "").trim().toUpperCase();
  if (!TICKER_RE.test(ticker)) return bad("Enter a ticker symbol, e.g. AAPL.");
  const { entry, stop, baseShares, worstLossR } = body;
  if (!positive(entry)) return bad("entry must be a positive number.");
  if (!positive(stop) || (stop as number) >= (entry as number)) return bad("stop must be positive and below entry (long only).");
  if (typeof baseShares !== "number" || !Number.isInteger(baseShares) || baseShares < 0) {
    return bad("baseShares must be a whole number of shares, 0 or more.");
  }
  if (worstLossR != null && !positive(worstLossR)) return bad("worstLossR must be a positive number or null.");

  const overrides: Partial<Record<GateName, string>> = {};
  if (body.overrides != null) {
    if (typeof body.overrides !== "object" || Array.isArray(body.overrides)) return bad("overrides must be an object of gate -> reason.");
    for (const [gate, reason] of Object.entries(body.overrides as Record<string, unknown>)) {
      if (!(GATE_ORDER as readonly string[]).includes(gate)) return bad(`Unknown gate "${gate}".`);
      if (typeof reason !== "string") return bad(`The reason for ${gate} must be text.`);
      if (reason.trim()) overrides[gate as GateName] = reason.trim().slice(0, 1000);
    }
  }
  const commit = body.commit === true;

  const [openRows, navRows] = await Promise.all([
    prisma.journalTrade.findMany({ where: { exitDate: null } }),
    prisma.navSnapshot.findMany({ orderBy: { date: "asc" } }),
  ]);
  const slots = slotsFromJournal(openRows);
  const held = [...new Set(slots.map((s) => s.ticker))].filter((t) => t !== ticker);

  // Every fetch fails soft to null; the gate that reads it then fails closed at WARN.
  const daily = (t: string) => fetchCandles(t, "1y", "1d").then((r) => r.candles).catch(() => null);
  const [fund, benchmark, mine, ...heldCandles] = await Promise.all([
    fetchFundamentals(ticker).catch(() => null),
    fetchCandles(BENCHMARK, "2y", "1d", 300).then((r) => r.candles).catch(() => null),
    daily(ticker),
    ...held.map(daily),
  ]);

  const correlations: Record<string, number | null> = {};
  held.forEach((t, i) => {
    const theirs = heldCandles[i];
    correlations[t] = mine && theirs ? dateAlignedCorrelation(mine, theirs) : null;
  });
  // Adding to a name already held: its correlation with itself is 1 by
  // definition, and the gate should say so rather than read it as unknown.
  if (slots.some((s) => s.ticker === ticker)) correlations[ticker] = 1;

  const sector = resolveGicsSector(ticker, fund?.industry);
  const result = evaluatePortfolio({
    today: new Date().toISOString().slice(0, 10),
    slots,
    candidate: { ticker, sector, baseShares, entry: entry as number, stop: stop as number, worstLossR: (worstLossR as number | null) ?? null },
    navHistory: navPoints(navRows),
    regime: regimeFromBenchmark(benchmark),
    correlations,
    strictMode: false,
    overrides,
  });

  let committed = 0;
  if (commit) {
    if (!result.canExecute) return bad(`Still blocked by ${result.blockedBy.join(", ") || "a zero share size"} — nothing was logged.`);
    const used = result.gates.filter((g) => g.overridden);
    if (used.length > 0) {
      await prisma.gateOverride.createMany({
        data: used.map((g) => ({ ticker, gate: g.gate, severity: g.severity, message: g.message, reason: overrides[g.gate]! })),
      });
    }
    committed = used.length;
  }

  return Response.json({ ok: true, sector, committed, ...result });
}
