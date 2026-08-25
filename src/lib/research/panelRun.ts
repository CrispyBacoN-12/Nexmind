// Runs one strategy across the whole panel for one fold, and judges the result
// against the pre-registered pass bar.
//
// The shape of this file follows one performance fact: computing entry signals
// is the expensive half (the sandbox is ~220ms per 2669-bar symbol) and
// simulating exits is nearly free. So signals are computed ONCE per symbol per
// fold and then reused — across the exit-ladder sweep, and across all 200 runs
// of the random-entry control. Without that split a control would cost 200x a
// backtest instead of roughly 1x, and this gate would be unaffordable rather
// than merely slow.
//
// No prisma, no network. The caller supplies a SignalSource; see
// adapter.panelSignalsForCode for the sandbox-backed one.

import {
  simulateExits, summarizeBacktest, DEFAULT_COST_MODEL,
  type BacktestSummary, type CostModel, type EntrySignals, type SimTrade,
} from "@/lib/backtest/engine";
import type { Candle } from "@/lib/indicators";
import { evaluateHoldout, type HoldoutVerdict } from "./holdout";
import {
  matchedRandomSignals, monthlyBlockBootstrap, mulberry32, summarizeControl,
  type BootstrapResult, type ControlDistribution,
} from "./control";
import { foldSlice, type Fold, type Panel } from "./panel";

// ---------------------------------------------------------------------------
// The pass bar. Pre-registered in docs/PROPOSAL-panel-validation.md §4 before
// any candidate was measured against it, for the same reason
// MIN_HOLDOUT_RETENTION was: a threshold chosen after seeing the number it
// judges is not a threshold, it is a rationalisation.
// ---------------------------------------------------------------------------

/**
 * Trades a fold must produce before its numbers are read at all.
 *
 * Ten times the single-symbol MIN_TRADES = 20, which is not arbitrary: the
 * measured cross-sectional correlation on this cache (rho 0.24-0.47) means a
 * panel's trades are worth far less each than an independent draw, so buying
 * breadth has to be paid for in count. 200 is still not many once N_eff is
 * applied; it is a floor for "decidable", not a claim of significance.
 */
export const MIN_PANEL_TRADES = 200;

/**
 * Distinct symbols that must contribute at least one trade.
 *
 * Guards the failure the trade floor alone cannot see: 200 trades concentrated
 * in eight names is a claim about eight names. It also catches the case where a
 * rule quietly stops firing on most of the universe in a later fold, which is
 * regime dependence wearing a participation costume.
 */
export const MIN_PANEL_SYMBOLS = 100;

/** Random-entry control runs. 200 puts the p95 estimate on ~10 tail observations — coarse, and enough for a one-sided bar. */
export const CONTROL_RUNS = 200;
export const CONTROL_PERCENTILE = 0.95;

/** Block-bootstrap resamples. Cheap (no re-simulation), so there is no reason to be stingy. */
export const BOOTSTRAP_RUNS = 1000;

/**
 * Fixed seed, so a verdict is reproducible from the cache alone.
 *
 * Deliberately a constant and not a parameter with a default: a caller able to
 * choose the seed is a caller able to retry until the control loses.
 */
export const PANEL_SEED = 20260825;

// ---------------------------------------------------------------------------

/** Exit geometry, as plain numbers — deliberately not runResearch's ExitLadder, which drags prisma in. */
export interface PanelExit {
  tp1Mult: number;
  slMult: number;
  trail?: { activateMult: number; offsetMult: number };
  singleTarget?: boolean;
  lot?: number;
  costs?: CostModel;
}

export const PANEL_LOT = 0.1;

/** How a symbol's bars become entry signals. Kept a callback so this module never imports the sandbox (or prisma behind it). */
export type SignalSource = (symbol: string, candles: Candle[]) => EntrySignals;

/** One symbol's fold, with its signals already computed — the reusable unit. */
export interface PreparedSymbol {
  symbol: string;
  candles: Candle[];
  /** index of the first tradable bar; everything before it is Wilder warm-up */
  entryFrom: number;
  signals: EntrySignals;
}

export interface FoldRun {
  fold: Fold;
  /** symbols with any bars inside the fold — the denominator for participation */
  symbolsInFold: number;
  /** symbols that produced at least one closed trade */
  symbolsTraded: number;
  signals: number;
  trades: SimTrade[];
  summary: BacktestSummary;
}

/** One symbol's fold bars, before any strategy has looked at them. */
export interface FoldSliceRow {
  symbol: string;
  candles: Candle[];
  /** index of the first tradable bar; everything before it is Wilder warm-up */
  entryFrom: number;
}

/**
 * Slice every symbol to the fold.
 *
 * Symbols with no bars in the fold are dropped rather than zero-filled: a name
 * that listed in 2021 did not participate in a 2020 fold, and counting it as a
 * silent zero would deflate participation for a reason that has nothing to do
 * with the strategy.
 *
 * Separate from prepareFold because slicing is per-FOLD while signals are per-
 * CODE-VERSION: a research round refines the same candidate two or three times
 * and runs three candidates in parallel, so the slices are cut once and shared
 * while only the signals are recomputed.
 */
export function sliceFold(panel: Panel, fold: Fold, symbols: string[] = panel.symbols): FoldSliceRow[] {
  const out: FoldSliceRow[] = [];
  for (const symbol of symbols) {
    const bars = panel.bars[symbol];
    if (!bars?.length) continue;
    const slice = foldSlice(bars, fold);
    if (!slice.tradableBars) continue;
    out.push({ symbol, candles: slice.candles, entryFrom: slice.entryFrom });
  }
  return out;
}

/** Attach entry signals to pre-cut slices. This is the expensive step — one sandbox pass per symbol. */
export function withSignals(slices: FoldSliceRow[], signalsFor: SignalSource): PreparedSymbol[] {
  return slices.map((s) => ({ ...s, signals: signalsFor(s.symbol, s.candles) }));
}

/** sliceFold + withSignals, for callers that only need the fold once. */
export function prepareFold(
  panel: Panel,
  fold: Fold,
  signalsFor: SignalSource,
  symbols: string[] = panel.symbols,
): PreparedSymbol[] {
  return withSignals(sliceFold(panel, fold, symbols), signalsFor);
}

/** Simulate one exit geometry over prepared signals. Cheap — this is the function the ladder sweep repeats. */
export function simulateFold(prepared: PreparedSymbol[], fold: Fold, exit: PanelExit): FoldRun {
  const trades: SimTrade[] = [];
  let signals = 0;
  let symbolsTraded = 0;

  for (const p of prepared) {
    const r = simulateExits(p.symbol, p.candles, p.signals, {
      lot: exit.lot ?? PANEL_LOT,
      singleTarget: exit.singleTarget ?? true,
      tp1Mult: exit.tp1Mult,
      slMult: exit.slMult,
      trail: exit.trail,
      costs: exit.costs ?? DEFAULT_COST_MODEL,
      entryFrom: p.entryFrom,
    });
    signals += r.signals;
    if (r.trades.length) symbolsTraded++;
    for (const t of r.trades) trades.push(t);
  }

  return {
    fold,
    symbolsInFold: prepared.length,
    symbolsTraded,
    signals,
    trades,
    summary: summarizeBacktest(trades),
  };
}

/**
 * The distribution of avgR a coin flip would have produced, holding everything
 * except entry timing fixed.
 *
 * Each run re-places every symbol's entries at random (same count, same
 * long/short mix, same eligible bars) and re-simulates the same exits. The
 * strategy's own avgR is then read against this, not against zero — because on
 * this universe zero is not the null hypothesis. 69-87% of names rose in every
 * window measured, so a long-biased rule clears zero on beta alone.
 *
 * Both sides inherit the cache's survivorship bias equally, which is what makes
 * the MARGIN meaningful even though neither absolute number is.
 */
export function runControl(
  prepared: PreparedSymbol[],
  fold: Fold,
  exit: PanelExit,
  runs: number = CONTROL_RUNS,
  seed: number = PANEL_SEED,
): ControlDistribution | null {
  const rng = mulberry32(seed);
  const avgRs: number[] = [];

  for (let r = 0; r < runs; r++) {
    const shuffled = prepared.map((p) => ({
      ...p,
      signals: matchedRandomSignals(p.signals, p.entryFrom, rng),
    }));
    const run = simulateFold(shuffled, fold, exit);
    if (run.summary.avgR != null) avgRs.push(run.summary.avgR);
  }

  return summarizeControl(avgRs);
}

export interface PanelFoldResult {
  fold: Fold;
  run: FoldRun;
  control: ControlDistribution | null;
  bootstrap: BootstrapResult | null;
  verdict: HoldoutVerdict;
}

/**
 * Judge one TEST fold. Four families of check, all of which must pass:
 *
 *   1. Everything evaluateHoldout already asks of a held-out sample — trade
 *      floor, positive expectancy, not an inverted split, PF >= 1.1, and at
 *      least half the fitted edge retained. Reused verbatim rather than
 *      restated, so the panel gate can never drift below the single-symbol one.
 *   2. Participation: enough distinct names carried it.
 *   3. The random-entry control: the edge must exceed what shuffled entries
 *      produce 95% of the time.
 *   4. The block bootstrap: the 5th percentile of resampled months must still
 *      be positive.
 *
 * A missing control or bootstrap FAILS. Both return null when there was not
 * enough to resample, and "we could not check" must never read as "it passed" —
 * the same fail-closed rule applyBlindTestVerdict applies to a fetch error.
 */
export function panelFoldVerdict(
  fit: Pick<BacktestSummary, "expectancy" | "avgR">,
  run: FoldRun,
  control: ControlDistribution | null,
  bootstrap: BootstrapResult | null,
): HoldoutVerdict {
  const reasons = [...evaluateHoldout(fit, run.summary, MIN_PANEL_TRADES).reasons];

  if (run.symbolsTraded < MIN_PANEL_SYMBOLS) {
    reasons.push(
      `only ${run.symbolsTraded} of ${run.symbolsInFold} symbols traded in ${run.fold.name} ` +
        `(floor ${MIN_PANEL_SYMBOLS}) — a panel result carried by a handful of names is a claim about those names`,
    );
  }

  const avgR = run.summary.avgR;
  if (avgR == null) {
    reasons.push(`no R-multiples in ${run.fold.name} — nothing to compare against the random-entry control`);
  } else if (!control) {
    reasons.push(`random-entry control produced no usable runs for ${run.fold.name} — unverified, which is not a pass`);
  } else if (avgR <= control.p95) {
    reasons.push(
      `avgR ${avgR.toFixed(3)} does not beat the random-entry control's p${Math.round(CONTROL_PERCENTILE * 100)} ` +
        `(${control.p95.toFixed(3)}, median ${control.median.toFixed(3)}, ${control.runs} runs) — ` +
        `on a universe where most names rise in every window measured, that margin IS the edge — avgR alone is not`,
    );
  }

  if (!bootstrap) {
    reasons.push(`block bootstrap could not run on ${run.fold.name} (needs trades spanning at least two calendar months) — unverified, not a pass`);
  } else if (bootstrap.p5 <= 0) {
    reasons.push(
      `block bootstrap p5 is ${bootstrap.p5.toFixed(3)} (<= 0) over ${bootstrap.blocks} monthly blocks — ` +
        `resampling whole months, the edge is not reliably positive`,
    );
  }

  return { passed: reasons.length === 0, reasons };
}

/** prepare → simulate → control → bootstrap → verdict, for one fold. */
export function evaluatePanelFold(
  panel: Panel,
  fold: Fold,
  signalsFor: SignalSource,
  exit: PanelExit,
  fit: Pick<BacktestSummary, "expectancy" | "avgR">,
  opts: { controlRuns?: number; bootstrapRuns?: number; seed?: number } = {},
): PanelFoldResult {
  const seed = opts.seed ?? PANEL_SEED;
  const prepared = prepareFold(panel, fold, signalsFor);
  const run = simulateFold(prepared, fold, exit);
  const control = runControl(prepared, fold, exit, opts.controlRuns ?? CONTROL_RUNS, seed);
  const bootstrap = monthlyBlockBootstrap(run.trades, opts.bootstrapRuns ?? BOOTSTRAP_RUNS, mulberry32(seed + 1));
  return { fold, run, control, bootstrap, verdict: panelFoldVerdict(fit, run, control, bootstrap) };
}
