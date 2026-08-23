// Does the AI add money?
//
// Until now the desk had no way to answer that. A trade HAWK refused or SAGE
// vetoed leaves no record — it is simply absent from the Trade table — so every
// review of "how are the analysts doing" could only look at the trades they
// approved. That is the textbook shape of survivorship bias: a desk that vetoes
// its way to three lucky winners looks brilliant, and a desk that vetoed ten
// losers looks identical to one that never saw them.
//
// So on every tick where a real backend was live, we also write down what the
// deterministic mock WOULD have done with the same scan, and later replay both
// ladders forward against the same candles under the same exit rules. What comes
// out is two arms scored per opportunity, not per trade:
//
//   AI arm   — the analysts' ladder when they traded, and exactly 0 when they
//              stood aside. Standing aside earns nothing; scoring a veto as
//              "no data" is how a veto-happy desk flatters itself.
//   Mock arm — always takes the scanner's side with the default ATR ladder.
//
// The difference is the analysts' contribution, in R, per opportunity.

import { prisma } from "@/lib/db";
import { fetchCandles } from "@/lib/marketData";
import { stepPosition, DEFAULT_COST_MODEL, type SimPosition } from "@/lib/backtest/engine";
import type { ProposedLevels } from "./hawk";
import type { Candle } from "@/lib/indicators";
import type { Interval, Range } from "@/lib/yahoo";
import type { Counterfactual } from "@/generated/prisma/client";

export interface RecordInput {
  portfolioId: number;
  symbol: string;
  timeframe: string;
  aiBackend: string;
  scanSide: "long" | "short";
  scanNote: string;
  aiOutcome: "executed" | "no-consensus" | "vetoed" | "rules-blocked";
  aiReason?: string;
  tradeId?: number;
  /** The analysts' final ladder. Null when they never produced one; present but
   *  NOT replayed when aiOutcome is anything other than "executed". */
  aiLevels: ProposedLevels | null;
  /** What the mock would have proposed for this same scan. */
  mockLevels: ProposedLevels;
  lot: number;
}

/**
 * Persist one tick's fork in the road. Never throws: a measurement failing must
 * not cost a trade, so a broken write is logged and the tick carries on.
 */
export async function recordCounterfactual(input: RecordInput): Promise<void> {
  try {
    await prisma.counterfactual.create({
      data: {
        portfolioId: input.portfolioId,
        symbol: input.symbol,
        timeframe: input.timeframe,
        aiBackend: input.aiBackend,
        scanSide: input.scanSide,
        scanNote: input.scanNote.slice(0, 500),
        aiOutcome: input.aiOutcome,
        aiReason: input.aiReason?.slice(0, 500),
        tradeId: input.tradeId,
        aiEntry: input.aiLevels?.entry,
        aiSl: input.aiLevels?.sl,
        aiTp1: input.aiLevels?.tp1,
        aiTp2: input.aiLevels?.tp2,
        mockEntry: input.mockLevels.entry,
        mockSl: input.mockLevels.sl,
        mockTp1: input.mockLevels.tp1,
        mockTp2: input.mockLevels.tp2,
        lot: input.lot,
      },
    });
  } catch (e) {
    console.error(`[counterfactual] failed to record ${input.symbol}:`, e instanceof Error ? e.message : e);
  }
}

// ---- replay ----

/** Build a replayable position straight from explicit levels — which is all
 *  openPosition() cannot do, since it derives everything from ATR multiples.
 *  SAGE tightens SL/TP, and replaying the default ladder instead of the one it
 *  actually chose would score a trade nobody took. `entry` is the filled price,
 *  so no slippage is applied a second time. */
function positionFrom(levels: ProposedLevels, side: "long" | "short", lot: number, openedAt: Date): SimPosition {
  return {
    side,
    entry: levels.entry,
    sl: levels.sl,
    tp1: levels.tp1,
    tp2: levels.tp2,
    trail: levels.trail ?? null,
    lot,
    openedAt,
    costs: DEFAULT_COST_MODEL,
    ladder: levels.trail ? { origSl: levels.sl } : {},
  };
}

export interface ArmResult { r: number | null; pnl: number | null; note: string; settled: boolean }

/** Walk one ladder through the bars that came after it opened. */
export function replay(pos: SimPosition, bars: Candle[]): ArmResult {
  for (const bar of bars) {
    const step = stepPosition(pos, bar);
    if (step.status === "closed") {
      const t = step.trade;
      return {
        r: t.rMultiple,
        pnl: t.pnl,
        note: `${t.outcome} at ${t.exit.toFixed(4)} on ${new Date(t.closedAt).toISOString().slice(0, 10)}`,
        settled: true,
      };
    }
  }
  return { r: null, pnl: null, note: `still open after ${bars.length} bars`, settled: false };
}

/** The AI arm when the analysts declined: a real decision with a real score. */
const STOOD_ASIDE: ArmResult = { r: 0, pnl: 0, note: "stood aside — no trade taken", settled: true };

/**
 * Resolve every unsettled row we now have enough candle history for. A row is
 * written back only once BOTH arms have terminated — half a comparison scored
 * against a full one is worse than none, because it silently favours whichever
 * arm happens to exit sooner.
 */
export async function resolveCounterfactuals(
  portfolioId: number,
  opts: { range?: Range; limit?: number } = {},
): Promise<{ checked: number; resolved: number; pending: number }> {
  const rows = await prisma.counterfactual.findMany({
    where: { portfolioId, resolvedAt: null },
    orderBy: { openedAt: "asc" },
    take: opts.limit ?? 500,
  });
  if (rows.length === 0) return { checked: 0, resolved: 0, pending: 0 };

  // One fetch per (symbol, timeframe) — rows for the same symbol share bars.
  const barsFor = new Map<string, Candle[]>();
  let resolved = 0;

  for (const row of rows) {
    const key = `${row.symbol}|${row.timeframe}`;
    if (!barsFor.has(key)) {
      try {
        const r = await fetchCandles(row.symbol, opts.range ?? "3mo", row.timeframe as Interval);
        barsFor.set(key, r.candles);
      } catch {
        barsFor.set(key, []);
      }
    }
    // Strictly after the opening bar: a position cannot be filled and stopped
    // out on its own signal bar, and the live desk never does that either.
    const opened = row.openedAt.getTime() / 1000;
    const forward = barsFor.get(key)!.filter((c) => c.t > opened);
    if (forward.length === 0) continue;

    const side = row.scanSide as "long" | "short";
    const mock = replay(
      positionFrom(
        { entry: row.mockEntry, sl: row.mockSl, tp1: row.mockTp1, tp2: row.mockTp2, trail: null },
        side, row.lot, row.openedAt,
      ),
      forward,
    );
    // Keyed off the outcome, not off the stored levels: a rules-blocked row
    // keeps the ladder the analysts wanted for the record, but they never got
    // the trade, so replaying it would credit them with a position nobody held.
    const ai =
      row.aiOutcome !== "executed" || row.aiEntry == null || row.aiSl == null || row.aiTp1 == null
        ? STOOD_ASIDE
        : replay(
            positionFrom(
              { entry: row.aiEntry, sl: row.aiSl, tp1: row.aiTp1, tp2: row.aiTp2, trail: null },
              side, row.lot, row.openedAt,
            ),
            forward,
          );

    if (!mock.settled || !ai.settled) continue;

    await prisma.counterfactual.update({
      where: { id: row.id },
      data: {
        resolvedAt: new Date(),
        aiR: ai.r, aiPnl: ai.pnl, aiExitNote: ai.note,
        mockR: mock.r, mockPnl: mock.pnl, mockExitNote: mock.note,
      },
    });
    resolved++;
  }

  return { checked: rows.length, resolved, pending: rows.length - resolved };
}

// ---- scoring ----

export interface ArmStats {
  opportunities: number;
  traded: number;
  avgR: number;
  totalR: number;
  winRate: number;
}

export interface ArmComparison {
  ai: ArmStats;
  mock: ArmStats;
  /** AI minus mock, in R per opportunity — the analysts' contribution. */
  edgePerOpportunity: number;
  /** How many of the mock's trades the analysts refused, and what those refusals
   *  would have earned: the number this whole module exists to produce. A
   *  negative refusedAvgR means the vetoes were dodging losers. */
  refused: number;
  refusedAvgR: number;
  byOutcome: Record<string, { count: number; mockAvgR: number }>;
}

type Scored = Pick<Counterfactual, "aiOutcome" | "aiR" | "mockR">;

/** Pure aggregation over resolved rows — no DB, so it can be tested directly. */
export function compareArms(rows: Scored[]): ArmComparison {
  const usable = rows.filter((r) => r.aiR != null && r.mockR != null) as Array<Scored & { aiR: number; mockR: number }>;
  const n = usable.length;
  const took = usable.filter((r) => r.aiOutcome === "executed");
  const refusedRows = usable.filter((r) => r.aiOutcome !== "executed");

  const arm = (rs: number[], traded: number): ArmStats => ({
    opportunities: n,
    traded,
    // Per OPPORTUNITY, not per trade: dividing the AI's winnings by the handful
    // of trades it deigned to take is how standing aside becomes free.
    avgR: n ? rs.reduce((a, b) => a + b, 0) / n : 0,
    totalR: rs.reduce((a, b) => a + b, 0),
    winRate: traded ? (rs.filter((r) => r > 0).length / traded) * 100 : 0,
  });

  const ai = arm(usable.map((r) => r.aiR), took.length);
  const mock = arm(usable.map((r) => r.mockR), n);

  const byOutcome: ArmComparison["byOutcome"] = {};
  for (const r of usable) {
    const b = (byOutcome[r.aiOutcome] ??= { count: 0, mockAvgR: 0 });
    b.mockAvgR = (b.mockAvgR * b.count + r.mockR) / (b.count + 1);
    b.count++;
  }

  return {
    ai,
    mock,
    edgePerOpportunity: ai.avgR - mock.avgR,
    refused: refusedRows.length,
    refusedAvgR: refusedRows.length ? refusedRows.reduce((a, r) => a + r.mockR, 0) / refusedRows.length : 0,
    byOutcome,
  };
}

/** Resolved rows for a portfolio, scored. */
export async function armComparison(portfolioId: number): Promise<ArmComparison> {
  const rows = await prisma.counterfactual.findMany({
    where: { portfolioId, resolvedAt: { not: null } },
    select: { aiOutcome: true, aiR: true, mockR: true },
  });
  return compareArms(rows);
}
