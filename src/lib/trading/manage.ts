// Position manager — the missing half of the desk. The engine only OPENS paper
// trades; this re-checks each open trade against the live price and walks the
// ladder: at TP1 (when a TP2 exists) it closes half, banks the P/L, and moves
// SL to breakeven; the rest then closes as a win at TP2 or a breakeven at the
// moved SL. Trades without a TP2 still close fully at TP1 or SL. Without this,
// positions stay open forever.

import { prisma } from "@/lib/db";
import { fetchCandles } from "@/lib/marketData";
import { decideAction, type LadderState } from "./positionRules";
import { generateLesson, type LessonInput } from "./memo";
import { Prisma, type Trade } from "@/generated/prisma/client";
import { getCurrentDrawdownPct } from "./circuitBreaker";
import { isKillSwitchOn, getDrawdownHaltPct } from "@/lib/settings";

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
      { side: t.side as "long" | "short", entry: t.entry, sl: t.sl, tp1: t.tp1, tp2: t.tp2 },
      ladder,
      cur,
    );
    if (action.kind === "hold") continue;

    const log = safeParse<{ stage: string; note: string }[]>(t.decisionLog, []);

    if (action.kind === "partial-tp1") {
      const favorable = t.side === "long" ? action.exit - t.entry : t.entry - action.exit;
      const banked = favorable * (t.lot / 2) * POINT_VALUE;
      const next: LadderState = {
        tp1Hit: true,
        partialPnl: (ladder.partialPnl ?? 0) + banked,
        origSl: ladder.origSl ?? t.sl,
      };
      log.push({ stage: "manage", note: `TP1 partial — half closed at ${action.exit.toFixed(4)}, SL → breakeven` });
      await prisma.trade.update({
        where: { id: t.id },
        data: { sl: t.entry, stagedTp: JSON.stringify(next), decisionLog: JSON.stringify(log) },
      });
      partials.push({ id: t.id, symbol: t.symbol, exit: action.exit, bankedPnl: banked });
      continue;
    }

    // Full close (win / loss / breakeven).
    const remainingLot = ladder.tp1Hit ? t.lot / 2 : t.lot;
    const favorable = t.side === "long" ? action.exit - t.entry : t.entry - action.exit;
    const pnl = (ladder.partialPnl ?? 0) + favorable * remainingLot * POINT_VALUE;
    const risk = Math.abs(t.entry - (ladder.origSl ?? t.sl));
    const rMultiple = risk > 0 ? pnl / (risk * t.lot * POINT_VALUE) : null;

    log.push({
      stage: "manage",
      note: `${action.outcome} — exit ${action.exit.toFixed(4)} (price ${cur.toFixed(4)})${ladder.tp1Hit ? " · incl. TP1 partial" : ""}`,
    });
    await prisma.trade.update({
      where: { id: t.id },
      data: {
        status: "closed",
        outcome: action.outcome,
        pnl,
        rMultiple,
        closedAt: new Date(),
        decisionLog: JSON.stringify(log),
        stagedTp: JSON.stringify(ladder),
      },
    });
    closed.push({ id: t.id, symbol: t.symbol, outcome: action.outcome, exit: action.exit, price: cur, pnl });

    if (action.outcome === "loss") {
      await recordLesson(t, { outcome: "loss", exit: action.exit, pnl, rMultiple });
    }
  }

  const killSwitchOn = await isKillSwitchOn(portfolioId);
  if (!killSwitchOn) {
    const haltPct = await getDrawdownHaltPct(portfolioId);
    const dd = await getCurrentDrawdownPct(portfolioId);
    if (dd >= haltPct) {
      await prisma.portfolio.update({
        where: { id: portfolioId },
        data: {
          killSwitch: true,
          killSwitchReason: `Auto-halted: drawdown -${dd.toFixed(1)}% exceeded ${haltPct}% limit at ${new Date().toISOString()}`,
        },
      });
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
