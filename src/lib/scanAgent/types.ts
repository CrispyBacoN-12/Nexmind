// Shared shapes and pre-registered constants for the pre-market / open scan.
// The scan is a screen for the owner to read, not a signal: nothing here ranks
// a name as a buy. Thresholds live here so the UI and the scorer quote the same
// numbers.

import type { FilingHit } from "@/lib/riskSentry/filingWatch";
import type { NewsHeadline } from "@/lib/market/news";

/** Liquidity floors: below these a day-trade fill is not realistic. */
export const SCAN_MIN_PRICE = 5;
export const SCAN_MIN_AVG_VOLUME = 1_000_000;
/** ATR as a percent of price; below this the stop is inside the noise. */
export const SCAN_MIN_ATR_PCT = 1.5;

/** Gap trigger threshold, in percent (compared against TvRow.gapPct). */
export const SCAN_GAP_TRIGGER_PCT = 2;
/** Relative-volume trigger threshold, as a multiple of normal volume. */
export const SCAN_RVOL_TRIGGER = 2;
/** Pre-market volume trigger threshold, in percent of 10-day average volume. */
export const SCAN_PREMARKET_VOLUME_TRIGGER_PCT = 3;

/**
 * Per-slot dollar budget: $2,500 capital / 5 slots, the /advisor defaults. A row whose
 * close is above it cannot be bought as a whole share inside a slot, so it carries the
 * fractional-share tag ("เศษหุ้น · ตั้ง stop ไม่ได้ ต้องเฝ้าเอง").
 */
export const SCAN_SLOT_BUDGET = 500;
/** Rows that get headlines fetched. */
export const SCAN_NEWS_TOP_N = 30;
/** Rows sent to the AI note step, and how many go in one call. */
export const SCAN_AI_TOP_N = 30;
export const SCAN_AI_BATCH = 10;

export type MarketPhase = "pre" | "open" | "closed";

/** One screener row after parsing. Every nullable field is null when TradingView sent no number. */
export interface TvRow {
  ticker: string;
  exchange: string;
  type: string;
  close: number;
  changePct: number | null;
  gapPct: number | null;
  premarketChangePct: number | null;
  premarketVolume: number | null;
  rvolIntraday: number | null;
  rvol10d: number | null;
  avgVolume10d: number | null;
  atr: number | null;
  /** Epoch seconds. */
  earningsLastAt: number | null;
  /** TradingView's code: -1 before open, 1 after close, 0 unknown. */
  earningsLastTime: number | null;
  earningsNextAt: number | null;
  earningsNextTime: number | null;
}

export type EarningsTag = "reported" | "tonight" | null;
export type Trigger = "gap" | "volume" | "earnings";

export interface VolumeMetric {
  kind: "rvol" | "premarketPct";
  value: number | null;
}

export interface SourceStatus {
  name: string;
  ok: boolean;
  note: string;
}

export interface EconEvent {
  title: string;
  at: string;
  thaiTime: string;
}

export interface ScanRow {
  rank: number;
  ticker: string;
  price: number;
  changePct: number | null;
  gapPct: number | null;
  volume: VolumeMetric;
  atrPct: number | null;
  earnings: EarningsTag;
  triggers: Trigger[];
  filings: FilingHit[];
  /** True when the 8-K check for this ticker failed: no tag means "not looked at", not "clean". */
  filingsUnchecked: boolean;
  headlines: NewsHeadline[];
  note: string | null;
  noteReason: string | null;
  fractional: boolean;
  score: number;
}

export type ScanResult =
  | {
      ok: true;
      scannedAt: string;
      phase: MarketPhase;
      sessionDate: string;
      universeSize: number;
      covered: number;
      passed: number;
      rows: ScanRow[];
      econ: EconEvent[] | null;
      sources: SourceStatus[];
      scoreFormula: string;
    }
  | { ok: false; error: string };
