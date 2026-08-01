// Pure position-management ladder: given an open trade, its ladder state, and the
// current price, decide what to do. No I/O — trivially testable. manage.ts owns
// persistence (it moves SL to entry and banks the partial P/L).

/** Fixed price distances (computed once off entry ATR) for an ATR trailing stop. */
export interface TrailConfig {
  activateDist: number; // price must move this far in favor of entry before the trail arms
  offsetDist: number; // trail stays this far behind the best price reached since entry
}

export interface OpenPosition {
  side: "long" | "short";
  entry: number;
  sl: number;
  tp1: number;
  tp2?: number | null;
  /** When set, this REPLACES the tp1/tp2 ladder entirely: exit is whichever of
   *  the hard SL or the ratcheting trail stop the price reaches first (tp1/tp2
   *  are ignored). Matches strategies whose validated exit is an ATR trailing
   *  stop rather than a fixed-target ladder. */
  trail?: TrailConfig | null;
}

export interface LadderState {
  tp1Hit?: boolean;
  partialPnl?: number; // banked half-lot P/L from the TP1 partial
  origSl?: number; // SL before it moved to breakeven (for R-multiple math)
  /** Static trail config, persisted here purely so callers with no other
   *  per-trade storage (manage.ts's Trade row) can carry it across ticks. */
  trail?: TrailConfig;
  /** Best favorable price reached since entry — only tracked once `trail` is set. */
  trailExtreme?: number;
}

export type PositionAction =
  | { kind: "hold" }
  | { kind: "close"; outcome: "win" | "loss" | "breakeven"; exit: number }
  | { kind: "partial-tp1"; exit: number } // close half at TP1, move SL to entry
  | { kind: "trail-update"; sl: number; extreme: number }; // still open — ratchet SL, record new extreme

/**
 * Price the trader actually gets vs. the theoretical level, given round-turn
 * slippage in bps — always worse for the trader, never better. A "buy" (opening
 * a long, or buying-to-cover a short) fills higher; a "sell" (opening a short,
 * or selling out of a long) fills lower.
 */
export function applySlippage(action: "buy" | "sell", price: number, slippageBps: number): number {
  const frac = slippageBps / 10000;
  return action === "buy" ? price * (1 + frac) : price * (1 - frac);
}

export function decideAction(t: OpenPosition, ladder: LadderState, price: number): PositionAction {
  if (t.trail) return decideTrailingAction(t, ladder, price);

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

/**
 * ATR trailing stop: two exit orders coexist — the fixed hard SL (t.sl) and a
 * trail stop that arms once price has moved `activateDist` in favor of entry,
 * then ratchets to stay `offsetDist` behind the best price reached since entry
 * (never loosens). Whichever level is more protective is the effective stop —
 * the caller persists `t.sl` as that effective stop each tick (see trail-update),
 * so on the next call `t.sl` already IS the ratcheted floor and no separate
 * "original hard SL" needs to be tracked.
 */
function decideTrailingAction(t: OpenPosition, ladder: LadderState, price: number): PositionAction {
  const dir = t.side === "long" ? 1 : -1;
  const trail = t.trail!;
  const priorExtreme = ladder.trailExtreme ?? t.entry;
  const extreme = dir === 1 ? Math.max(priorExtreme, price) : Math.min(priorExtreme, price);

  const favorableFromEntry = dir * (extreme - t.entry);
  const trailStop = favorableFromEntry >= trail.activateDist ? extreme - dir * trail.offsetDist : null;
  const effectiveStop =
    trailStop == null ? t.sl : dir === 1 ? Math.max(t.sl, trailStop) : Math.min(t.sl, trailStop);

  const hitSl = t.side === "long" ? price <= effectiveStop : price >= effectiveStop;
  if (hitSl) {
    const favorableStop = dir * (effectiveStop - t.entry);
    const outcome = favorableStop > 0 ? "win" : favorableStop < 0 ? "loss" : "breakeven";
    return { kind: "close", outcome, exit: effectiveStop };
  }

  if (extreme !== priorExtreme || effectiveStop !== t.sl) {
    return { kind: "trail-update", sl: effectiveStop, extreme };
  }
  return { kind: "hold" };
}
