// Shared types and constants for the stock advisory tool.
//
// This tool does not predict. It reports structure and risk for a ticker the
// owner already chose, so they can decide with their eyes open. Every rule this
// project has ever fitted died on its deep hold-out; nothing here is an edge.
//
// Pure — no I/O anywhere under src/lib/advisor/. Candles arrive as arguments.

import type { Candle } from "@/lib/indicators";
import type { GateDecision } from "@/lib/market/marketGate";

/** Printed on every card, verbatim. Do not soften it. */
export const ADVISOR_NO_EDGE_CLAIM =
  "This tool does not predict anything. It reports structure and risk for a " +
  "ticker you chose. No rule in this project has survived its deep hold-out, " +
  "so nothing here is a reason to buy.";

/** Round-trip cost assumption, in basis points. Webull charges no stock
 *  commission, so this is spread plus slippage, not fees. It is an assumption,
 *  not a measurement of the owner's own fills. */
export const ADVISOR_COST_BPS = 5;

export const ADVISOR_ATR_PERIOD = 14;

/** The one constant all three exit geometries in this repo agree on. The target
 *  multiple is the one they disagree about — hence the ladder, not a choice. */
export const ADVISOR_ATR_SL_MULT = 1.5;

export const ADVISOR_R_STEPS: readonly number[] = [1, 1.5, 2, 2.5, 3];

/** Which of the two caps produced `shares`. Both, when they tie. */
export type SizingCap = "risk" | "affordability";

export interface ShareSizingInput {
  /** Intended fill price. */
  entry: number;
  /** Distance from entry to stop, in dollars. Always positive. */
  slDistance: number;
  /** Total account capital, in dollars. */
  capital: number;
  /** How many positions the account is willing to hold at once. */
  maxSlots: number;
  /** Percent units: 1 = 1% of capital. */
  riskPct: number;
}

export interface ShareSizingResult {
  /** Whole shares to buy. Zero is a legitimate answer and always has a reason. */
  shares: number;
  /** Shares the risk budget alone would allow. */
  riskShares: number;
  /** Shares one slot's worth of capital could pay for. */
  affordableShares: number;
  /** capital / maxSlots */
  slotBudget: number;
  /** capital * riskPct / 100 — what was ASKED for, not what happens. */
  riskUsdTarget: number;
  /** shares * slDistance — what actually happens if the stop fills. */
  actualRiskUsd: number;
  /** Percent units. Usually below riskPct, because affordability binds first. */
  actualRiskPct: number;
  /** Never empty when shares > 0. */
  boundBy: SizingCap[];
  /** Always populated. Explains the number, especially when it is zero. */
  reason: string;
}

export interface LadderRow {
  /** R multiple: 1, 1.5, 2, 2.5, 3. */
  r: number;
  /** entry + r * slDistance */
  price: number;
  /** Percent units, relative to entry. */
  gainPct: number;
  /** shares * (price - entry). Zero when shares is zero. */
  plUsd: number;
}

export interface CorrelationLine {
  ticker: string;
  /** null when the holding's candles could not be fetched or had no variance. */
  correlation: number | null;
  /** Why it is null, when it is null. Empty string otherwise. */
  note: string;
}

/** One position the owner already holds, as typed into the form. */
export interface HoldingInput {
  ticker: string;
  /** null when the fetch failed — the holding still consumes a slot. */
  candles: Candle[] | null;
}

export interface AdvisorInput {
  ticker: string;
  candles: Candle[];
  /** Blank in the form means "use the last close". */
  entryOverride?: number | null;
  capital: number;
  maxSlots: number;
  /** Percent units: 1 = 1%. */
  riskPct: number;
  costBps?: number;
  holdings: HoldingInput[];
  /** SPY daily candles, at least TREND_PERIOD of them. null = gate reads BLIND. */
  benchmark: Candle[] | null;
}

export interface AdvisorCard {
  ticker: string;
  /** Date of the last bar used, YYYY-MM-DD. */
  asOf: string;
  lastClose: number;
  entry: number;
  entrySource: "last close" | "override";
  atr: number;
  slDistance: number;
  stop: number;
  sizing: ShareSizingResult;
  /** shares * entry */
  deployedUsd: number;
  ladder: LadderRow[];
  /** Round-trip cost expressed as a fraction of one R. */
  costR: number;
  correlations: CorrelationLine[];
  avgCorrelation: number | null;
  /** From the desk's own corrMultiplierFor. Reported, never applied. */
  corrMultiplier: number;
  /** floor(shares * corrMultiplier). Shown as a second line. */
  corrAdjustedShares: number;
  /** max(0, maxSlots - holdings.length) */
  freeSlots: number;
  gate: GateDecision;
  /** True when the asked-about ticker is already in holdings. Shown at the top. */
  alreadyHeld: boolean;
  /** Everything that went wrong but did not stop the card rendering. */
  warnings: string[];
  noEdgeClaim: string;
}

export type AdvisorResult =
  | { ok: true; card: AdvisorCard }
  | { ok: false; error: string };
