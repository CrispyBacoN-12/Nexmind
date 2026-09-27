// Types for the portfolio layer. Everything in src/lib/portfolio/ is pure: no
// DB, no fetch, no clock. The same functions back the /advisor ticket gate
// (strictMode false, overridable with a written reason) and the Test B slot
// simulator (strictMode true, overrides ignored), so the rule a backtest
// measures is the rule the owner trades under.

import type { ResolvedSector } from "./sectorMap";

export type GateName = "CAPACITY" | "SECTOR" | "CORRELATION" | "REGIME" | "DRAWDOWN" | "GAP_HEAT";

/** Evaluated in this order, and reported in this order. */
export const GATE_ORDER: readonly GateName[] = ["CAPACITY", "SECTOR", "CORRELATION", "REGIME", "DRAWDOWN", "GAP_HEAT"];

/**
 * OK: passed, nothing to add.
 * WARN: passed with a caveat, OR failed because an input was missing/stale.
 *       A missing input never passes silently — it fails closed at WARN.
 * CRITICAL: failed on a measured breach.
 */
export type GateSeverity = "OK" | "WARN" | "CRITICAL";

/** A position already open. Long only — the desk's short leg is blocked. */
export interface PortfolioSlot {
  ticker: string;
  sector: ResolvedSector;
  shares: number;
  entry: number;
  stop: number;
  /** gapRisk().worstLossR for this ticker; null = not measured (heat then uses 1R, a lower bound). */
  worstLossR: number | null;
}

/** The trade being asked about. baseShares is the 1R sizing before any drawdown cut. */
export interface CandidateTrade {
  ticker: string;
  sector: ResolvedSector;
  baseShares: number;
  entry: number;
  stop: number;
  worstLossR: number | null;
}

export interface NavPoint {
  /** YYYY-MM-DD */
  date: string;
  nav: number;
}

export interface PortfolioConfig {
  maxSlots: number;
  /** Slot cap while SPY closes below its SMA200. */
  riskOffMaxSlots: number;
  /** Max names per GICS sector, the candidate included. */
  maxPerSector: number;
  /** 60-session return correlation above this blocks. */
  maxCorrelation: number;
  /** Sum over positions of risk$ x worstLossR, as % of NAV, after adding the candidate. */
  maxGapHeatPct: number;
  /** Consecutive-log NAV drop that stops new trades for the day. */
  dailyDrawdownStopPct: number;
  /** Drawdown from the NAV high-water mark that halves new size. */
  drawdownHalfSizePct: number;
  /** Drawdown from the high-water mark that stops all new trades (safe mode). */
  drawdownSafeModePct: number;
  /** Latest NAV log older than this many calendar days reads as unknown. */
  navStaleDays: number;
  /** Risk per trade in % of NAV. Only converts heat % into R for display. */
  riskPctPerTrade: number;
}

export const DEFAULT_PORTFOLIO_CONFIG: Readonly<PortfolioConfig> = {
  maxSlots: 5,
  riskOffMaxSlots: 2,
  maxPerSector: 2,
  maxCorrelation: 0.7,
  maxGapHeatPct: 10,
  dailyDrawdownStopPct: 3,
  drawdownHalfSizePct: 8,
  drawdownSafeModePct: 15,
  navStaleDays: 5,
  riskPctPerTrade: 1,
};

export interface PortfolioEvaluationInput {
  /** YYYY-MM-DD, supplied by the caller: the module never reads a clock. */
  today: string;
  slots: PortfolioSlot[];
  candidate: CandidateTrade;
  /** From the owner's NAV log; any order. */
  navHistory: NavPoint[];
  /** null = the benchmark could not be read. */
  regime: { spyClose: number; spySma200: number } | null;
  /** 60-session return correlation of the candidate with each held ticker.
   *  A held ticker missing from this map, or mapped to null, is unknown. */
  correlations: Record<string, number | null>;
  /** true for the simulator: every failed gate blocks, overrides are ignored. */
  strictMode: boolean;
  /** /advisor only: a non-blank reason un-blocks that gate. */
  overrides?: Partial<Record<GateName, string>>;
  config?: Partial<PortfolioConfig>;
}

export interface GateCheckResult {
  gate: GateName;
  passed: boolean;
  severity: GateSeverity;
  currentValue: number | string;
  threshold: number | string;
  message: string;
  /** Failed, but the owner gave a reason (never true in strictMode). */
  overridden: boolean;
}

export interface PortfolioEvaluationOutput {
  canExecute: boolean;
  gates: GateCheckResult[];
  /** Failed gates that are still blocking after overrides. */
  blockedBy: GateName[];
  /** Latest logged NAV, or null when there is no usable log. */
  nav: number | null;
  /** 1 normally, 0.5 past the half-size drawdown. Applied to suggestedShares even when overridden. */
  sizeMultiplier: number;
  suggestedShares: number;
  /** Open risk$ / NAV, before and after the candidate. null without a NAV. */
  nominalHeatPct: number | null;
  nominalHeatPctAfter: number | null;
  /** Same, in units of riskPctPerTrade. */
  nominalHeatRAfter: number | null;
  /** Sum of risk$ x worstLossR / NAV after the candidate: the overnight worst case if every name repeated its worst sampled gap at once. */
  tailRiskGapHeatPctAfter: number | null;
  tailRiskGapHeatRAfter: number | null;
  /** Positions (candidate included) whose worstLossR was unknown and counted as 1R. */
  gapUnmeasured: string[];
}
