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

/**
 * The pre-2016 folds, which live in a SEPARATE cache and a separate name space.
 *
 * Kept out of FoldName rather than appended to it, because the two are not
 * interchangeable and the type is what stops them being mixed. Only a `FoldName`
 * may be persisted in a PanelFoldReport or reach the desk gate; a deep fold is a
 * research instrument that has never been part of the approval path and must not
 * become one by being assignable to the same field.
 */
export type DeepFoldName = "deep1" | "deep2" | "deep3";

/**
 * The XAUUSD folds — a third name space, on the same principle and for a
 * stronger reason.
 *
 * The table itself, the pass bar and the caveat every gold verdict carries live
 * in research/xauFolds.ts; only the NAME lives here, so that `Fold`'s union can
 * mention it without this module depending on that one. Gold is one symbol with
 * no cross-section and no ticker-disjoint replication, so an `xau-v1` result is
 * a weaker class of evidence than a `panel-v1` one, and nothing named here may
 * ever be persisted where a `FoldName` is expected.
 */
export type XauFoldName = "xfit" | "xselect" | "xtest1" | "xtest2" | "xtest3";

/**
 * A window of market, named.
 *
 * The generic parameter exists only to keep the name spaces apart at the call
 * sites that care: `Fold<FoldName>` is what FOLDS and TEST_FOLDS hand out, so
 * blindTest's persisted `fold: FoldName` still type-checks, while a bare `Fold`
 * (the union) is what the fold-agnostic machinery — foldSlice, sliceFold,
 * simulateFold, runControl — accepts, so a deep or gold fold runs through
 * exactly the same code as a shallow one with no second implementation to drift.
 */
export interface Fold<N extends string = FoldName | DeepFoldName | XauFoldName> {
  name: N;
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
export const FOLDS: Record<FoldName, Fold<FoldName>> = {
  fit: { name: "fit", from: "2016-01-01", to: "2019-01-01", regime: "post-2015 correction recovery through the 2018 Q4 selloff" },
  select: { name: "select", from: "2019-01-01", to: "2020-01-01", regime: "2019 melt-up on falling rates" },
  test1: { name: "test1", from: "2020-01-01", to: "2022-01-01", regime: "COVID crash and the liquidity-driven recovery" },
  test2: { name: "test2", from: "2022-01-01", to: "2024-01-01", regime: "rate-hike bear market and the 2023 recovery" },
  test3: { name: "test3", from: "2024-01-01", to: "2027-01-01", regime: "2024-2026 bull, AI-concentrated leadership" },
};

export const FIT_FOLD = FOLDS.fit;
export const SELECT_FOLD = FOLDS.select;
export const TEST_FOLDS: Fold<FoldName>[] = [FOLDS.test1, FOLDS.test2, FOLDS.test3];

/** The pre-2016 cache. A different file on purpose — see DEEP_FOLDS. */
export const DEEP_PANEL_CACHE_PATH = ".cache/bars/sp500-1d-deep.json";

/**
 * Sixteen years of market that no fold above has ever touched.
 *
 * WHY THESE EXIST. The 2016 floor of the main cache is a routing artifact, not
 * a limit on price history: marketData's provider chain reaches Yahoo only when
 * Alpaca errors, Alpaca never errors, and Alpaca's equity data starts
 * 2016-01-04. Yahoo serves the same split- and dividend-adjusted daily bars back
 * to the 1990s for most of these names, so the untouched data was there the
 * whole time and simply never fetched.
 *
 * WHAT THEY ARE FOR, and the line that must not be crossed. FIT and SELECT are
 * spent — every mechanism in scripts/mechanism-screen.mts has been read on them
 * — and so, by now, are the three TEST folds, because their numbers have been
 * read while deciding what to look at next. Data whose numbers are known cannot
 * adjudicate the hypothesis those numbers suggested. These three folds are the
 * only windows left where that is not true, which makes them expensive: they are
 * for settling a hypothesis written down BEFORE the run, once, not for screening
 * ideas. A script that reads them without a pre-registered pass bar in its own
 * header is spending them for nothing.
 *
 * They are strictly earlier than FIT rather than later, which buys a property no
 * amount of extra 2020s data could: three regimes with no structural overlap
 * with the ones already used — two full bear markets (2000-02, 2007-09) against
 * a panel whose only bear folds are a one-month crash and a single rate-hike
 * year. A mechanism that survives here has survived market structure, not just
 * more of the same decade.
 *
 * The cost, stated plainly: these bars come from a different provider than the
 * 2016+ ones, and the survivorship bias is WORSE here than in the main cache,
 * because a name in today's index that also traded in 2000 survived twenty-six
 * years rather than ten. The margin over the matched control absorbs the level
 * of that bias but is not proof it absorbs all of it — see
 * PANEL_SURVIVORSHIP_CAVEAT and the quartile diagnostic in
 * scripts/deep-holdout.mts, which measures the residual instead of assuming it.
 */
export const DEEP_FOLDS: Record<DeepFoldName, Fold<DeepFoldName>> = {
  deep1: { name: "deep1", from: "2000-01-01", to: "2005-01-01", regime: "dot-com bust and the 2002 bottom" },
  deep2: { name: "deep2", from: "2005-01-01", to: "2010-01-01", regime: "housing bubble, 2008 crisis, and the 2009 bottom" },
  deep3: { name: "deep3", from: "2010-01-01", to: "2016-01-01", regime: "QE recovery, flash crash, 2011 and 2015 corrections" },
};

export const DEEP_FOLD_LIST: Fold<DeepFoldName>[] = [DEEP_FOLDS.deep1, DEEP_FOLDS.deep2, DEEP_FOLDS.deep3];

/**
 * Bars fetched BEFORE the first deep fold, so deep1 gets the same warm-up every
 * other fold gets.
 *
 * PANEL_WARMUP_BARS is 250 trading days; a cache starting in December 1999 would
 * hand deep1 about twenty. The indicators would then be cold for deep1 and warm
 * for deep2/deep3, which is precisely the boundary artifact PANEL_WARMUP_BARS
 * exists to prevent — and it would show up as deep1 disagreeing with the others,
 * i.e. as a regime finding.
 */
export const DEEP_CACHE_START = "1998-01-01";

export interface Panel {
  /** when the cache was fetched — pinned into every result so a re-run is comparable */
  fetchedAt: string;
  cachePath: string;
  symbols: string[];
  bars: Record<string, Candle[]>;
  /** placeholder bars removed on load, per symbol; only symbols that lost some appear */
  droppedBars: Record<string, number>;
}

// Bar hygiene moved to lib/bars.ts so the live provider router can apply the
// same rule without importing this module. Re-exported because loadPanel below
// uses sanitizeSeries and because both are part of this module's tested surface.
import { isPlaceholderBar, sanitizeSeries } from "@/lib/bars";
export { isPlaceholderBar, sanitizeSeries };

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
    const rebuild =
      cachePath === DEEP_PANEL_CACHE_PATH
        ? `npx tsx scripts/cache-deep-history.mts`
        : `node --env-file=.env --import tsx scripts/cache-daily-bars.mts sp500`;
    throw new Error(
      `panel cache unreadable at ${cachePath} (${e instanceof Error ? e.message : String(e)}) — ` +
        `rebuild it with: ${rebuild}`,
    );
  }
  if (!raw.bars || typeof raw.bars !== "object") {
    throw new Error(`panel cache at ${cachePath} has no 'bars' map — expected { fetchedAt, bars: { SYMBOL: Candle[] } }`);
  }

  // Sanitize on load rather than at the call sites: every path into the panel
  // goes through here, and a filter that one script remembers to apply is a
  // filter that decides verdicts by which script ran.
  const bars: Record<string, Candle[]> = {};
  const droppedBars: Record<string, number> = {};
  for (const symbol of Object.keys(raw.bars)) {
    const rows = raw.bars[symbol];
    if (!Array.isArray(rows) || !rows.length) continue;
    const { candles, dropped } = sanitizeSeries(rows);
    if (!candles.length) continue; // a series that was entirely placeholder is not history
    bars[symbol] = candles;
    if (dropped) droppedBars[symbol] = dropped;
  }

  const symbols = Object.keys(bars).sort();
  if (!symbols.length) throw new Error(`panel cache at ${cachePath} is empty`);

  cached = {
    fetchedAt: raw.fetchedAt ?? "unknown",
    cachePath,
    symbols,
    bars,
    droppedBars,
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
