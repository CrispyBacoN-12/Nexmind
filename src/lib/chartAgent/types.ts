// Shared types and pre-registered constants for the chart agent (agent #2):
// it reads 5-minute charts of scanned stocks for long liquidity-sweep setups.
// Every level, stop, target and R is computed in code; the AI only reads the
// finished setup. The constants live here so the spec's numbers have one home.

import type { Candle } from "@/lib/indicators";

/** How many scanned tickers the agent looks at, best first. */
export const CHART_TOP_N = 20;
/** Most setups shown on the panel. */
export const CHART_MAX_SETUPS = 5;
/** Price bins of the previous-session volume profile. */
export const CHART_PROFILE_BINS = 50;
/** Share of volume inside the value area (VAH/VAL). */
export const CHART_VALUE_AREA = 0.7;
/** Stop sits this many ATRs below the sweep low. */
export const CHART_STOP_BUFFER_ATR = 0.1;
/** Levels closer than this many ATRs merge into one target. */
export const CHART_LEVEL_MERGE_ATR = 0.1;
/** The first target must pay at least this many R or there is no setup. */
export const CHART_MIN_T1_R = 1.5;
/** Most recent 5-minute bars handed to the AI for its reading. */
export const CHART_AI_BARS = 24;
/** ATR period on the 5-minute bars. */
export const CHART_ATR_PERIOD = 14;

/**
 * p = previous session, d = today. POC = point of control, VAH/VAL = value
 * area high/low; PDH/PDL = previous day high/low; PMH/PML = pre-market
 * high/low. Sweep levels are PDL, PML, pVAL; targets are dPOC, pPOC, pVAH,
 * PDH, PMH.
 */
export type LevelName =
  | "pPOC"
  | "pVAH"
  | "pVAL"
  | "PDH"
  | "PDL"
  | "PMH"
  | "PML"
  | "dPOC";

/** A level is null when its session has no bars (or a flat profile). */
export type Levels = Record<LevelName, number | null>;

/** One ticker's 5-minute bars cut into New York sessions. */
export interface SessionSplit {
  /** ET date of the latest earlier session with regular bars, if any. */
  previousDate: string | null;
  previous: Candle[];
  premarket: Candle[];
  regular: Candle[];
}

export interface Target {
  price: number;
  /** Every level merged into this target. */
  names: LevelName[];
  r: number;
}

export interface Setup {
  ticker: string;
  entry: number;
  stop: number;
  t1: Target;
  t2: Target | null;
  sweptLevels: LevelName[];
  sweepBar: Candle;
  tags: string[];
  levels: Levels;
  /** ISO time the newest bar used ended (bar start + 5 minutes). */
  dataAsOf: string;
}

export type SetupOutcome =
  | { kind: "setup"; setup: Setup }
  | { kind: "none"; ticker: string; reason: string };
