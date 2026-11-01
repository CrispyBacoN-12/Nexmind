// Shared types and constants for the stock advisory tool.
//
// This tool does not predict. It reports structure and risk for a ticker the
// owner already chose, so they can decide with their eyes open. Every rule this
// project has ever fitted died on its deep hold-out; nothing here is an edge.
//
// Pure — no I/O anywhere under src/lib/advisor/. Candles arrive as arguments.

import type { Candle } from "@/lib/indicators";
import type { GateDecision } from "@/lib/market/marketGate";

import type { StopStructure } from "./chartStop";
import type { FillGuard } from "./fillGuard";

/** Printed on every card, verbatim. Do not soften it. */
export const ADVISOR_NO_EDGE_CLAIM =
  "เครื่องมือนี้ไม่ได้ทำนายอะไรทั้งสิ้น มันรายงานโครงสร้างและความเสี่ยงของหุ้นที่คุณเลือกเท่านั้น " +
  "ไม่มีกฎเกณฑ์ใดในโปรเจกต์นี้ที่ผ่านการทดสอบ deep hold-out ได้ " +
  "ดังนั้นสิ่งที่แสดงอยู่นี้จึงไม่ใช่เหตุผลให้ซื้อ";

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

/**
 * The next scheduled earnings report for the ticker on the card.
 *
 * The shape lives HERE, in the pure tree, rather than beside the fetch that
 * fills it: the card owns what it renders, and `src/lib/market/earnings.ts`
 * produces this shape rather than the other way round. That keeps every import
 * across the boundary pointing from the I/O module into the pure one.
 *
 * There is no "days away" field. Days from WHAT is the whole question — the
 * card's numbers are all as of its last closed bar, not as of the moment the
 * owner is reading it — so the subtraction is done at render time against
 * `asOf`, once, by `earningsPhrase`.
 */
export interface EarningsInfo {
  /** YYYY-MM-DD of the next scheduled report, or null when none is known. */
  date: string | null;
  /** Finnhub's session tag: bmo (before open), amc (after close), dmh (during). */
  hour: string | null;
  /** Why there is no date. ALWAYS set when `date` is null — "unknown" and
   *  "none scheduled" are different facts and the card must not merge them. */
  note?: string;
}

/** One rung of the base-rate table. Percent units throughout. */
export interface BaseRateRow {
  r: number;
  /** Reached entry + r * stop distance before the stop, within the horizon. */
  targetFirstPct: number;
  stopFirstPct: number;
  /** Neither within the horizon. */
  openPct: number;
  /** 1 / (1 + r): the target-first share at which this rung only breaks even, before costs. */
  breakEvenPct: number;
}

/**
 * The card's geometry replayed from every close in the sample. See baseRate.ts:
 * it is the stock's drift and volatility, not an edge.
 */
export interface BaseRate {
  /** Entries replayed (one per eligible session; windows overlap). */
  entries: number;
  /** Sessions each entry was walked forward. */
  horizon: number;
  /** First and last ENTRY date, YYYY-MM-DD. */
  from: string;
  to: string;
  /** Entries whose resolving session touched both stop and 1R target (counted as stop). */
  sameBarBoth: number;
  /** The stock's own move over the sample, first entry close to last bar close. */
  buyHoldPct: number;
  rows: BaseRateRow[];
}

/**
 * The last trade price, fetched by the route. Same never-a-bare-null contract as
 * EarningsInfo: a missing price always carries the reason.
 */
export interface LiveQuote {
  price: number | null;
  /** Epoch SECONDS of the price, as the vendor stamps it. */
  at: number | null;
  note?: string;
}

/**
 * The worst overnight gap against a long in the sample, in units of the stop.
 * See gapRisk.ts for the formula and for why ATR_{t-1} is the denominator.
 */
export interface GapRisk {
  /** Sessions that could be measured (prior ATR available). */
  sessions: number;
  /** YYYY-MM-DD span of the history the figure was read from. */
  from: string;
  to: string;
  /** max over t of max(0, C_{t-1} - O_t) / (slMult * ATR_{t-1}). */
  worstStops: number;
  /** Session the worst gap opened on; null when no session gapped down at all. */
  worstDate: string | null;
  /** 1 + worstStops: the loss had that gap hit a position resting just above its stop. */
  worstLossR: number;
  /** Sessions whose adverse gap alone was at least half a stop. */
  overHalfStop: number;
  /** Sessions whose adverse gap alone was a full stop or more — a stop-out past -1R even from entry. */
  overOneStop: number;
}

export interface CorrelationLine {
  ticker: string;
  /** null when the holding's candles could not be fetched or had no variance. */
  correlation: number | null;
  /** Why it is null, when it is null; or why a non-null reading is only
   *  approximate (the two series do not end on the same date). Empty string
   *  ONLY when the reading is clean. */
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
  /** A stop the owner gave (typed, or a chart-agent link). Used only when finite
   *  and 0 < stop < the final entry; otherwise ignored with a card warning and
   *  the chain goes on to the 5-minute chart. Absent or null: no given stop. */
  stopOverride?: number | null;
  /** The 5-minute bars the route fetched for the stop chain, or the reason it
   *  could not. Absent or null means no 5-minute read was attempted. `cutoffSec`
   *  keeps a forming bar out. */
  intraday?: { candles: Candle[]; cutoffSec: number } | { error: string } | null;
  capital: number;
  maxSlots: number;
  /** Percent units: 1 = 1%. */
  riskPct: number;
  costBps?: number;
  /** Notes from the caller's own input handling (deduped holdings, dropped tokens).
   *  Prepended to the card's warnings — the core never invents these. */
  inputNotes?: string[];
  holdings: HoldingInput[];
  /** SPY daily candles, at least TREND_PERIOD of them. null = gate reads BLIND. */
  benchmark: Candle[] | null;
  /** Fetched by the caller, like everything else here. Omitted or null means the
   *  card says the date is unknown — never that there is no report coming. */
  earnings?: EarningsInfo | null;
  /** Longer daily history (the route's 2y pull) read ONLY for gap risk, so the
   *  6mo figures above do not move. Omitted or null: the card says unknown. */
  gapHistory?: Candle[] | null;
  /** The last trade price, fetched by the route. Omitted: the fill guard says no quote. */
  quote?: LiveQuote | null;
  /** Epoch seconds at request time — used ONLY to age `quote`. advise() reads no clock. */
  nowSec?: number | null;
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
  /** Where `stop` came from, in chain order: a stop the owner gave, the latest
   *  5-minute swing low, the previous-day low, or the 1.5 x ATR rule. */
  stopSource: "given" | "swing" | "pdl" | "atr";
  /** Why earlier sources were skipped, in chain order. Empty when none was tried. */
  stopNotes: string[];
  /** Tight / wide copy for a non-ATR stop. Disclosed, never moves the stop. */
  stopFlags: string[];
  /** The bar a swing or PDL stop sits under; null for given and ATR. */
  stopStructure: StopStructure | null;
  /** What the plain ATR stop would have been, so the owner can compare. null
   *  when the ATR stop is the one in use. */
  atrAlternative: { stop: number; atrMult: number; shares: number } | null;
  /** slDistance / atr. Always set: exactly ADVISOR_ATR_SL_MULT for an ATR stop. */
  stopAtrMult: number;
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
  /** The one non-price fact on this card. It is reported, never acted on: the
   *  2026-09-08 earnings-event screen found timing worthless as a standalone
   *  entry in BOTH directions (drift and fade both landed on their own control),
   *  so a date near the entry is a risk disclosure and nothing more. Nothing on
   *  this card sizes, stops or ladders differently because of it. */
  earnings: EarningsInfo | null;
  /** Reported, never applied: sizing still assumes the stop fills at the stop.
   *  null when the history was missing or too short to read. */
  gapRisk: GapRisk | null;
  /** shares * slDistance * gapRisk.worstLossR — dollars at stake if the worst
   *  sampled gap hit today's position resting just above its stop. */
  gapWorstLossUsd: number | null;
  /** What a fill above the entry does to this card's risk. Reported, never
   *  applied: `sizing` above is still sized at `entry`. See fillGuard.ts. */
  fillGuard: FillGuard;
  /** The card's stop and ladder replayed from every close in the 2y sample.
   *  The stock's drift, not an edge — see baseRate.ts. null when history is short. */
  baseRate: BaseRate | null;
  /** True when the asked-about ticker is already in holdings. Shown at the top. */
  alreadyHeld: boolean;
  /** Everything that went wrong but did not stop the card rendering. */
  warnings: string[];
  noEdgeClaim: string;
}

export type AdvisorResult =
  | { ok: true; card: AdvisorCard }
  | { ok: false; error: string };
