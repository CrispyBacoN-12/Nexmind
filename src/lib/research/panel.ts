// The panel: the 491-symbol S&P 500 daily bar cache, cut into folds that a
// research candidate is fitted on, gated on, and finally measured against.
//
// Why this exists (see docs/PROPOSAL-panel-validation.md for the measurements):
// the research loop used to backtest ONE symbol, which on a daily swing rule
// produced a median of 4 trades per candidate — too few to decide anything, and
// unfixable by fetching deeper history, because the binding constraint was
// scope and not depth. Meanwhile the "held-out" blind test overlapped its own
// training window by 66%. Both problems are window-policy problems, so the
// window policy lives here, in one file, as data.
//
// Pure and synchronous: no network, no database. The only I/O is reading the
// cache file, and that is deliberately never done at import time — the file is
// ~89MB of JSON and parsing it costs seconds and roughly a gigabyte of heap.
// Call loadPanel() from a script or a cron path, never from a request handler.

import { readFileSync } from "node:fs";
import type { Candle } from "@/lib/indicators";

export const PANEL_CACHE_PATH = ".cache/bars/sp500-1d.json";

/**
 * Bars of real history prepended to each fold, informing the indicators without
 * ever being tradable.
 *
 * ATR and ADX are Wilder-smoothed, i.e. exponential with a long memory, and
 * SMA50 needs fifty closes before it is anything at all. A fold sliced cold
 * therefore misreads the market for its first stretch — and worse, misreads it
 * *differently* in each fold, which would show up as regime disagreement that
 * is really just a boundary artifact. 250 daily bars is about a calendar year,
 * comfortably past the point where a 14-period Wilder average has forgotten its
 * seed.
 */
export const PANEL_WARMUP_BARS = 250;

export type FoldName = "fit" | "select" | "test1" | "test2" | "test3";

export interface Fold {
  name: FoldName;
  /** inclusive, ISO date */
  from: string;
  /** exclusive, ISO date */
  to: string;
  /** what this stretch of market actually was — quoted in verdicts, so keep it factual */
  regime: string;
}

/**
 * The window policy. Every fold is disjoint from every other, and every TEST
 * fold lies strictly after both fitting folds in wall-clock time.
 *
 * The candidate is proposed, refined and ladder-swept on FIT, approved or
 * rejected on SELECT, and only then measured on the three TEST folds — which
 * nothing in the loop is ever allowed to select on. Three test folds rather
 * than one because a single fold is a single regime, and a single regime is
 * worth about three independent observations once the measured cross-sectional
 * correlation (rho 0.24-0.47 across this cache) is accounted for. Three
 * different regimes is roughly nine, which is a real improvement over one and
 * still not a big number. Do not describe it as one.
 *
 * A candidate must clear the bar in ALL THREE test folds, not on their average.
 * Averaging lets one strong regime carry two dead ones, which is exactly how
 * research-29 reached the desk and lost -3.46R.
 *
 * The honest cost of this layout: FIT ends in 2018, so a candidate is fitted on
 * a market seven years stale by the time it is deployed. That is a feature for
 * validation — surviving it is evidence the mechanism is not regime-specific —
 * and a real limitation for tuning. It is the price of having any untouched
 * data left at all, given that the cache starts in 2016.
 */
export const FOLDS: Record<FoldName, Fold> = {
  fit: { name: "fit", from: "2016-01-01", to: "2019-01-01", regime: "post-2015 correction recovery through the 2018 Q4 selloff" },
  select: { name: "select", from: "2019-01-01", to: "2020-01-01", regime: "2019 melt-up on falling rates" },
  test1: { name: "test1", from: "2020-01-01", to: "2022-01-01", regime: "COVID crash and the liquidity-driven recovery" },
  test2: { name: "test2", from: "2022-01-01", to: "2024-01-01", regime: "rate-hike bear market and the 2023 recovery" },
  test3: { name: "test3", from: "2024-01-01", to: "2027-01-01", regime: "2024-2026 bull, AI-concentrated leadership" },
};

export const FIT_FOLD = FOLDS.fit;
export const SELECT_FOLD = FOLDS.select;
export const TEST_FOLDS: Fold[] = [FOLDS.test1, FOLDS.test2, FOLDS.test3];

export interface Panel {
  /** when the cache was fetched — pinned into every result so a re-run is comparable */
  fetchedAt: string;
  cachePath: string;
  symbols: string[];
  bars: Record<string, Candle[]>;
}

export interface FoldSlice {
  /** warm-up prefix + the fold itself */
  candles: Candle[];
  /** index of the fold's first bar within `candles`; nothing before it may be traded */
  entryFrom: number;
  /** bars inside the fold proper (candles.length - entryFrom) */
  tradableBars: number;
}

function toEpochSeconds(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00Z`) / 1000;
}

/**
 * Cut one symbol's history down to a fold, with a warm-up prefix in front.
 *
 * Returns tradableBars = 0 when the symbol has no bars inside the fold at all —
 * a 2021 listing simply does not participate in test1, and pretending otherwise
 * would invent history. Callers skip those symbols and report how many traded,
 * because a panel result carried by a shrinking subset of names is a different
 * claim from one carried by all of them.
 */
export function foldSlice(bars: Candle[], fold: Fold, warmup = PANEL_WARMUP_BARS): FoldSlice {
  const from = toEpochSeconds(fold.from);
  const to = toEpochSeconds(fold.to);

  const first = bars.findIndex((b) => b.t >= from);
  if (first < 0) return { candles: [], entryFrom: 0, tradableBars: 0 };

  const endIdx = bars.findIndex((b) => b.t >= to);
  const end = endIdx < 0 ? bars.length : endIdx;
  if (end <= first) return { candles: [], entryFrom: 0, tradableBars: 0 };

  const start = Math.max(0, first - warmup);
  return {
    candles: bars.slice(start, end),
    entryFrom: first - start,
    tradableBars: end - first,
  };
}

let cached: Panel | null = null;

/**
 * Read and parse the bar cache. Memoized for the lifetime of the process, since
 * a research round slices the same 89MB across five folds and a few hundred
 * backtests.
 *
 * Throws rather than falling back to a live fetch: a panel result that silently
 * came from a different data set than the one stamped in `fetchedAt` is worse
 * than no panel result. Rebuild the cache with `scripts/cache-daily-bars.mts`.
 */
export function loadPanel(cachePath: string = PANEL_CACHE_PATH): Panel {
  if (cached && cached.cachePath === cachePath) return cached;

  let raw: { fetchedAt?: string; bars?: Record<string, Candle[]> };
  try {
    raw = JSON.parse(readFileSync(cachePath, "utf8"));
  } catch (e) {
    throw new Error(
      `panel cache unreadable at ${cachePath} (${e instanceof Error ? e.message : String(e)}) — ` +
        `rebuild it with: node --env-file=.env --import tsx scripts/cache-daily-bars.mts sp500`,
    );
  }
  if (!raw.bars || typeof raw.bars !== "object") {
    throw new Error(`panel cache at ${cachePath} has no 'bars' map — expected { fetchedAt, bars: { SYMBOL: Candle[] } }`);
  }

  const symbols = Object.keys(raw.bars).filter((s) => Array.isArray(raw.bars![s]) && raw.bars![s].length > 0).sort();
  if (!symbols.length) throw new Error(`panel cache at ${cachePath} is empty`);

  cached = {
    fetchedAt: raw.fetchedAt ?? "unknown",
    cachePath,
    symbols,
    bars: raw.bars,
  };
  return cached;
}

/** Test seam — drops the memoized cache so a test can load a fixture. */
export function resetPanelCache(): void {
  cached = null;
}

/**
 * What this panel cannot tell you, restated wherever a panel number is reported.
 *
 * The cache holds TODAY's S&P 500 membership, so every name in it survived to
 * 2026 and the ones that were delisted between 2016 and now are simply absent.
 * Absolute returns measured on it are therefore biased upward, and no amount of
 * fold discipline fixes that. What does survive the bias is the COMPARISON
 * against the random-entry control in research/control.ts, which is drawn from
 * the same survivors and inherits the same lift.
 */
export const PANEL_SURVIVORSHIP_CAVEAT =
  "universe is today's S&P 500 membership, so delisted names are absent and absolute returns are biased upward; " +
  "only the margin over the matched random-entry control is bias-cancelling";

/**
 * Which window policy produced a ResearchStrategy row — persisted in
 * ResearchStrategy.validation.
 *
 * Two values, and the distinction is not cosmetic. `legacy-single-symbol` rows
 * were fitted and "held out" on one symbol, on a window that overlapped itself
 * by 66%; `panel-v1` rows were fitted on FIT, selected on SELECT, and measured
 * on three later folds they never saw. Their backtestSummary fields have the
 * same shape and mean different things, so nothing may compare them and the
 * desk may only activate the latter.
 *
 * Existing rows default to `legacy-single-symbol` rather than being backfilled:
 * they really were produced that way, and rewriting history to say otherwise is
 * the one thing this column exists to prevent.
 */
export const PANEL_VALIDATION = "panel-v1";
export const LEGACY_VALIDATION = "legacy-single-symbol";
