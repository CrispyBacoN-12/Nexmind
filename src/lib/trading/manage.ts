// Position manager — the missing half of the desk. The engine only OPENS paper
// trades; this re-checks each open trade against the live price and walks the
// ladder: at TP1 (when a TP2 exists) it closes half, banks the P/L, and moves
// SL to breakeven; the rest then closes as a win at TP2 or a breakeven at the
// moved SL. Trades without a TP2 still close fully at TP1 or SL. Without this,
// positions stay open forever.

import { prisma } from "@/lib/db";
import { fetchCandles } from "@/lib/marketData";
import { decideAction, applySlippage, type LadderState } from "./positionRules";
import { generateLesson, type LessonInput } from "./memo";
import { Prisma, type Trade } from "@/generated/prisma/client";
import { DEFAULT_COST_MODEL, rMultipleOf } from "@/lib/backtest/engine";

// Simplified paper P/L: USD per 1.0 price-point per lot. Real instruments differ
// (contract sizes, pip values); this keeps the demo consistent and transparent.
const POINT_VALUE = 1;

export interface CloseResult {
  id: number;
  symbol: string;
  outcome: "win" | "loss" | "breakeven";
  exit: number;
  price: number;
  pnl: number;
}

export interface PartialResult {
  id: number;
  symbol: string;
  exit: number;
  bankedPnl: number;
}

export interface ManageSummary {
  checked: number;
  closed: CloseResult[];
  partials: PartialResult[];
}

/** Latest price for a symbol (cached per run). */
async function makePriceFetcher() {
  const cache = new Map<string, number | null>();
  return async (symbol: string): Promise<number | null> => {
    if (cache.has(symbol)) return cache.get(symbol)!;
    let p: number | null = null;
    try {
      const r = await fetchCandles(symbol, "1d", "5m");
      p = r.price ?? r.candles.at(-1)?.c ?? null;
    } catch {
      p = null;
    }
    cache.set(symbol, p);
    return p;
  };
}

/** Walk every open trade through the ladder rules: partial at TP1, close at TP2/SL. */
export async function manageOpenTrades(portfolioId: number): Promise<ManageSummary> {
  const open = await prisma.trade.findMany({ where: { status: "open", portfolioId } });
  const priceOf = await makePriceFetcher();
  const closed: CloseResult[] = [];
  const partials: PartialResult[] = [];

  for (const t of open) {
    const cur = await priceOf(t.symbol);
    if (cur == null) continue;

    const ladder = safeParse<LadderState>(t.stagedTp, {});
    const action = decideAction(
      { side: t.side as "long" | "short", entry: t.entry, sl: t.sl, tp1: t.tp1, tp2: t.tp2, trail: ladder.trail },
      ladder,
      cur,
    );

    // Still open — ratchet the SL and record the new best-price-since-entry,
    // no fill/log entry involved (mirrors the backtest engine's stepPosition).
    if (action.kind === "trail-update") {
      await prisma.trade.update({
        where: { id: t.id },
        data: { sl: action.sl, stagedTp: JSON.stringify({ ...ladder, trailExtreme: action.extreme }) },
      });
      continue;
    }
    if (action.kind === "hold") continue;

    const log = safeParse<{ stage: string; note: string }[]>(t.decisionLog, []);

    // Closing a long is a sell (fills lower than theoretical); closing a short
    // is a buy-to-cover (fills higher) — same slippage direction/assumption as
    // the backtest engine and the entry fill in engine.ts.
    const exit = applySlippage(t.side === "long" ? "sell" : "buy", action.exit, DEFAULT_COST_MODEL.slippageBps ?? 0);

    if (action.kind === "partial-tp1") {
      const favorable = t.side === "long" ? exit - t.entry : t.entry - exit;
      const banked = favorable * (t.lot / 2) * POINT_VALUE;
      const next: LadderState = {
        tp1Hit: true,
        partialPnl: (ladder.partialPnl ?? 0) + banked,
        origSl: ladder.origSl ?? t.sl,
      };
      log.push({ stage: "manage", note: `TP1 partial — half closed at ${exit.toFixed(4)}, SL → breakeven` });
      await prisma.trade.update({
        where: { id: t.id },
        data: { sl: t.entry, stagedTp: JSON.stringify(next), decisionLog: JSON.stringify(log) },
      });
      partials.push({ id: t.id, symbol: t.symbol, exit, bankedPnl: banked });
      continue;
    }

    // Full close (win / loss / breakeven). Commission is charged once here,
    // against notional (lot * entry) — same convention as stepPosition() in
    // src/lib/backtest/engine.ts, so live and backtested P/L stay comparable.
    const remainingLot = ladder.tp1Hit ? t.lot / 2 : t.lot;
    const favorable = t.side === "long" ? exit - t.entry : t.entry - exit;
    const grossPnl = (ladder.partialPnl ?? 0) + favorable * remainingLot * POINT_VALUE;
    const notional = t.lot * t.entry * POINT_VALUE;
    const commission = notional * ((DEFAULT_COST_MODEL.commissionBps ?? 0) / 10000);
    const pnl = grossPnl - commission;
    const risk = Math.abs(t.entry - (ladder.origSl ?? t.sl));
    const rMultiple = rMultipleOf(pnl, t.entry, risk, t.lot);

    log.push({
      stage: "manage",
      note: `${action.outcome} — exit ${exit.toFixed(4)} (price ${cur.toFixed(4)})${ladder.tp1Hit ? " · incl. TP1 partial" : ""}`,
    });
    await prisma.trade.update({
      where: { id: t.id },
      data: {
        status: "closed",
        outcome: action.outcome,
        pnl,
        grossPnl,
        rMultiple,
        closedAt: new Date(),
        decisionLog: JSON.stringify(log),
        stagedTp: JSON.stringify(ladder),
      },
    });
    closed.push({ id: t.id, symbol: t.symbol, outcome: action.outcome, exit, price: cur, pnl });

    if (action.outcome === "loss") {
      await recordLesson(t, { outcome: "loss", exit: action.exit, pnl, rMultiple });
    }
  }

  return { checked: open.length, closed, partials };
}

function safeParse<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

/** MEMO distills a lesson for a loss. Lesson.tradeId is unique, so a P2002 just means it's already recorded. */
async function recordLesson(trade: Trade, close: LessonInput): Promise<void> {
  try {
    const { text } = await generateLesson(trade, close);
    await prisma.lesson.create({ data: { tradeId: trade.id, text } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return;
    console.error(`MEMO: failed to record lesson for trade ${trade.id}`, e);
  }
}
