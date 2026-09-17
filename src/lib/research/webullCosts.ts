// Whole-share, real-fee-schedule trade economics for Webull US equities.
//
// Extracted from scripts/mr-down3-webull-cost-realism.mts (Probe #1), which
// hand-rolled this math for one long-only mechanism. Generalized here to also
// handle short trades — the SEC/FINRA fees below apply to the SELL leg of a
// round trip, which is the EXIT for a long but the ENTRY for a short — so any
// future probe on a short-capable mechanism (or a two-sided one) does not have
// to re-derive this by hand.
//
// engine.ts's CostModel is bps-only and has no notion of whole shares, a fixed
// dollar slot, or SEC/FINRA fees; this module is a post-processing step over a
// FoldRun's trade list, same as the probe it was extracted from — it does not
// change how the engine or panel simulate a fold.

import type { ClosedTrade } from "@/lib/trading/stats";

// Webull US-equities disclosed fee schedule. Not a modeling choice.
export const SEC_FEE_RATE = 0.0000278; // per $ of sell-side dollar volume
export const SEC_FEE_MIN = 0.01;
export const FINRA_TAF_RATE = 0.000166; // per sell-side share
export const FINRA_TAF_MIN = 0.01;
export const FINRA_TAF_MAX = 8.30;

export function secFee(sellDollarVol: number): number {
  return Math.max(SEC_FEE_MIN, sellDollarVol * SEC_FEE_RATE);
}

export function finraTaf(shares: number): number {
  return Math.min(FINRA_TAF_MAX, Math.max(FINRA_TAF_MIN, shares * FINRA_TAF_RATE));
}

export interface RawTrade {
  side: "long" | "short";
  entry: number;
  exit: number;
  sl: number;
  openedAt: Date;
  closedAt: Date;
}

export interface WholeShareTrade extends ClosedTrade {
  shares: number;
  grossUsd: number;
  feesUsd: number;
  netUsd: number;
  holdingDays: number;
}

/**
 * Whole-share economics for one trade at a fixed dollar slot, under an
 * explicit fill pair. `entryFill`/`exitFill` are separate from `raw.entry`/
 * `raw.exit` on purpose: a friction sweep (e.g. a flat cents-per-share model
 * CostModel cannot express) shifts the fills by hand while `raw.entry`/
 * `raw.sl` stay put, since the stop DISTANCE they encode is invariant to
 * execution friction — a PFOF fill moves the price level, not the ATR
 * multiple the stop was placed at.
 *
 * Returns null when the slot cannot buy even one whole share (excluded, not
 * zeroed or fractional — a real account simply could not take the trade).
 */
export function priceWholeShareTrade(
  raw: RawTrade,
  slotUsd: number,
  entryFill: number = raw.entry,
  exitFill: number = raw.exit,
): WholeShareTrade | null {
  const shares = Math.floor(slotUsd / raw.entry);
  if (shares < 1) return null;

  const dir = raw.side === "long" ? 1 : -1;
  const grossUsd = (exitFill - entryFill) * dir * shares;
  // The SELL leg of the round trip: the exit for a long, the entry for a
  // short (selling short to open). SEC/FINRA fees are charged on this leg only.
  const sellFill = raw.side === "long" ? exitFill : entryFill;
  const feesUsd = secFee(sellFill * shares) + finraTaf(shares);
  const netUsd = grossUsd - feesUsd;

  const riskPerShare = Math.abs(raw.entry - raw.sl);
  const riskUsd = riskPerShare * shares;
  const rMultiple = riskUsd > 0 ? netUsd / riskUsd : null;

  const holdingDays = (raw.closedAt.getTime() - raw.openedAt.getTime()) / 86_400_000;

  return {
    shares, grossUsd, feesUsd, netUsd, holdingDays,
    pnl: netUsd, rMultiple, outcome: netUsd > 0 ? "win" : netUsd < 0 ? "loss" : "breakeven", closedAt: raw.closedAt,
  };
}

/** Batch helper: price every trade at its own fill (no hand-applied friction override), splitting out exclusions. */
export function priceWholeShareTrades(trades: RawTrade[], slotUsd: number): { priced: WholeShareTrade[]; excluded: number } {
  const priced: WholeShareTrade[] = [];
  let excluded = 0;
  for (const t of trades) {
    const p = priceWholeShareTrade(t, slotUsd);
    if (p) priced.push(p); else excluded++;
  }
  return { priced, excluded };
}
