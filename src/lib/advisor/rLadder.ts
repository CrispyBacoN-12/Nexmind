// The R ladder: what each exit multiple is worth, in the prices the owner will
// actually type into Webull and the dollars they will actually see.
//
// The tool does NOT pick a target. The three exit geometries in this repo
// disagree — 2.5 live, 1.2 research, 1.5 trail — and none of them survived a
// deep hold-out, so choosing one here would be inventing an answer. The ladder
// shows the whole range and the owner picks.
//
// Pure.

import { ADVISOR_COST_BPS, ADVISOR_R_STEPS, type LadderRow } from "./types";

/**
 * One row per R multiple. Prices are entry + r * slDistance; P/L is per the
 * whole position. With zero shares the prices still print — the owner may want
 * to see the geometry even when they cannot take the trade.
 */
export function rLadder(
  entry: number,
  slDistance: number,
  shares: number,
  steps: readonly number[] = ADVISOR_R_STEPS,
): LadderRow[] {
  return steps.map((r) => {
    const price = entry + r * slDistance;
    return {
      r,
      price,
      gainPct: entry > 0 ? ((price - entry) / entry) * 100 : 0,
      plUsd: shares * (price - entry),
    };
  });
}

/**
 * Round-trip cost expressed as a fraction of one R — the only unit in which
 * cost is comparable to an edge. Webull charges no stock commission, so this
 * is spread plus slippage, entry and exit, and it is an assumption rather than
 * a measurement of the owner's own fills.
 *
 * Note how fast it grows as the stop tightens: the same 5bps is 0.02R behind a
 * $9 stop and 0.18R behind a $1 one.
 */
export function costInR(entry: number, slDistance: number, costBps: number = ADVISOR_COST_BPS): number {
  if (!Number.isFinite(slDistance) || slDistance <= 0) return 0;
  if (!Number.isFinite(entry) || entry <= 0) return 0;
  return ((2 * costBps) / 10_000) * entry / slDistance;
}
