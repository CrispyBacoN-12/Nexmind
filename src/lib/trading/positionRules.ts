// Pure position-management ladder: given an open trade, its ladder state, and the
// current price, decide what to do. No I/O — trivially testable. manage.ts owns
// persistence (it moves SL to entry and banks the partial P/L).

export interface OpenPosition {
  side: "long" | "short";
  entry: number;
  sl: number;
  tp1: number;
  tp2?: number | null;
}

export interface LadderState {
  tp1Hit?: boolean;
  partialPnl?: number; // banked half-lot P/L from the TP1 partial
  origSl?: number; // SL before it moved to breakeven (for R-multiple math)
}

export type PositionAction =
  | { kind: "hold" }
  | { kind: "close"; outcome: "win" | "loss" | "breakeven"; exit: number }
  | { kind: "partial-tp1"; exit: number }; // close half at TP1, move SL to entry

export function decideAction(t: OpenPosition, ladder: LadderState, price: number): PositionAction {
  const hitUp = (level: number) => (t.side === "long" ? price >= level : price <= level);
  const hitSl = t.side === "long" ? price <= t.sl : price >= t.sl;

  if (!ladder.tp1Hit) {
    if (hitUp(t.tp1)) {
      if (t.tp2 == null) return { kind: "close", outcome: "win", exit: t.tp1 };
      return { kind: "partial-tp1", exit: t.tp1 };
    }
    if (hitSl) return { kind: "close", outcome: "loss", exit: t.sl };
    return { kind: "hold" };
  }

  // After TP1: half is banked and SL sits at breakeven (entry).
  if (t.tp2 != null && hitUp(t.tp2)) return { kind: "close", outcome: "win", exit: t.tp2 };
  if (hitSl) return { kind: "close", outcome: "breakeven", exit: t.sl };
  return { kind: "hold" };
}
