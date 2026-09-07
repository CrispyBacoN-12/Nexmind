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
  matchedRandomSignals, monthlyBlockBootstrap, pairedBlockBootstrap, mulberry32, summarizeControl,
  type BootstrapResult, type ControlDistribution, type PairedBootstrapResult,
} from "./control";
import { foldSlice, PANEL_WARMUP_BARS, type Fold, type Panel } from "./panel";

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
  /**
   * Passed straight through to simulateExits. It lives on the EXIT object on
   * purpose: runControl re-simulates through simulateFold with this same
   * object, so the matched random control automatically fills at the same price
   * the strategy does. A control filling at the close while the rule fills at
   * the open would not be a control, it would be a second strategy.
   */
  entryAt?: "close" | "open" | "open-unmanaged";
}

export const PANEL_LOT = 0.1;

/** The geometry half of a PanelExit — what an exit CHANGE is, with the fill and sizing left out. */
export type ExitGeometry = Pick<PanelExit, "tp1Mult" | "slMult" | "trail" | "singleTarget">;

/**
 * The exit the desk would have used anyway, and therefore the null every
 * proposed exit change is measured against.
 *
 * 1.5/1.5 — an even 1:1 against the 1.5 ATR stop. Not chosen here: it is
 * LADDER_OPTIONS[0], which runResearch already uses as REFINEMENT_LADDER, the
 * fixed geometry every refinement round is compared under. Restated as plain
 * numbers rather than imported because runResearch.ts pulls in prisma and this
 * module must not; runResearch.test.ts asserts the two agree, so the copy
 * cannot drift silently.
 */
export const BASELINE_EXIT: ExitGeometry = { tp1Mult: 1.5, slMult: 1.5, singleTarget: true };

/** Paired resamples for the exit control. Cheap — no re-simulation, same reason as BOOTSTRAP_RUNS. */
export const EXIT_BOOTSTRAP_RUNS = 1000;

/**
 * The bar an exit change must clear: the 5th percentile of the resampled
 * candidate-minus-baseline difference must be above zero.
 *
 * One-sided at 5%, the same level the entry gate asks of the random-entry
 * control's p95 — deliberately, so "beat the control" means the same strength
 * of evidence whichever axis is being changed. Pre-registered here, before any
 * exit geometry was measured against it.
 */
export const EXIT_DELTA_PERCENTILE = 0.05;

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
 *
 * `warmup` is a parameter rather than a constant because PANEL_WARMUP_BARS is
 * 250 DAILY bars — one calendar year, and five calendar years of weekly ones.
 * A weekly panel passes WEEKLY_PANEL_WARMUP_BARS instead. The default keeps
 * every daily caller bit-identical.
 */
export function sliceFold(
  panel: Panel,
  fold: Fold,
  symbols: string[] = panel.symbols,
  warmup: number = PANEL_WARMUP_BARS,
): FoldSliceRow[] {
  const out: FoldSliceRow[] = [];
  for (const symbol of symbols) {
    const bars = panel.bars[symbol];
    if (!bars?.length) continue;
    const slice = foldSlice(bars, fold, warmup);
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
      entryAt: exit.entryAt,
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

/** Do two geometries describe the same exit? Compared field by field so an added field cannot slip past a shallow check. */
export function sameGeometry(a: ExitGeometry, b: ExitGeometry): boolean {
  return (
    a.tp1Mult === b.tp1Mult &&
    a.slMult === b.slMult &&
    (a.singleTarget ?? true) === (b.singleTarget ?? true) &&
    a.trail?.activateMult === b.trail?.activateMult &&
    a.trail?.offsetMult === b.trail?.offsetMult
  );
}

export interface ExitComparison {
  fold: Fold;
  /** the proposed exit, on the rule's own entries */
  candidate: FoldRun;
  /** BASELINE_EXIT (or the caller's null), on the SAME entries */
  baseline: FoldRun;
  paired: PairedBootstrapResult | null;
  verdict: HoldoutVerdict;
}

/**
 * Score an EXIT change against the exit that would have been used anyway.
 *
 * The entries are held fixed and are the rule's own — no shuffling. That is the
 * mirror image of runControl, which holds the exit fixed and shuffles the
 * entries, and the pair of them is why the two axes can now both be measured:
 * whichever half of a strategy is under test, the other half is the constant.
 *
 * The baseline inherits `lot`, `costs` and `entryAt` from the candidate rather
 * than carrying its own. Same construction as runControl sharing its `exit`
 * object: a baseline filling at a different price, sizing at a different lot or
 * paying different costs would not be a control, it would be a second strategy,
 * and making that unrepresentable beats detecting it.
 */
export function runExitControl(
  prepared: PreparedSymbol[],
  fold: Fold,
  exit: PanelExit,
  baseline: ExitGeometry = BASELINE_EXIT,
  opts: { bootstrapRuns?: number; seed?: number } = {},
): ExitComparison {
  const seed = opts.seed ?? PANEL_SEED;
  const baselineExit: PanelExit = { ...baseline, lot: exit.lot, costs: exit.costs, entryAt: exit.entryAt };

  const candidateRun = simulateFold(prepared, fold, exit);
  const baselineRun = simulateFold(prepared, fold, baselineExit);
  const paired = pairedBlockBootstrap(
    candidateRun.trades,
    baselineRun.trades,
    opts.bootstrapRuns ?? EXIT_BOOTSTRAP_RUNS,
    mulberry32(seed + 2),
  );

  return {
    fold,
    candidate: candidateRun,
    baseline: baselineRun,
    paired,
    verdict: exitFoldVerdict(exit, baseline, candidateRun, baselineRun, paired),
  };
}

/**
 * Judge one exit comparison.
 *
 * Read the pass narrowly. It says the candidate geometry beats the baseline
 * ladder on these entries, and nothing else — in particular it says nothing
 * about whether the entries are worth taking. The panel's own baseline entry
 * loses to a matched random entry in every fold measured, and a better exit on
 * a negative-value entry is still a negative-value strategy. An exit change and
 * an entry change are separate claims needing separate gates, which is the
 * whole reason this function exists rather than a branch inside
 * panelFoldVerdict.
 */
export function exitFoldVerdict(
  exit: ExitGeometry,
  baseline: ExitGeometry,
  candidate: FoldRun,
  baselineRun: FoldRun,
  paired: PairedBootstrapResult | null,
): HoldoutVerdict {
  const reasons: string[] = [];

  if (sameGeometry(exit, baseline)) {
    reasons.push(
      `the candidate exit is the baseline exit (tp1 ${exit.tp1Mult}, sl ${exit.slMult}` +
        `${exit.trail ? `, trail ${exit.trail.activateMult}/${exit.trail.offsetMult}` : ""}) — ` +
        `a geometry compared against itself has no difference to measure, and a zero delta here is a caller error, not a verdict`,
    );
  }

  for (const [arm, run] of [["candidate", candidate], ["baseline", baselineRun]] as const) {
    if (run.summary.trades < MIN_PANEL_TRADES) {
      reasons.push(`${arm} arm produced ${run.summary.trades} trades in ${run.fold.name} (floor ${MIN_PANEL_TRADES}) — a comparison is only as readable as its thinner arm`);
    }
    if (run.symbolsTraded < MIN_PANEL_SYMBOLS) {
      reasons.push(`${arm} arm traded ${run.symbolsTraded} of ${run.symbolsInFold} symbols in ${run.fold.name} (floor ${MIN_PANEL_SYMBOLS})`);
    }
  }

  if (!paired) {
    reasons.push(
      `the paired bootstrap could not run on ${candidate.fold.name} (needs at least two calendar months traded by BOTH arms) — ` +
        `unverified, which is not a pass`,
    );
  } else if (paired.p5 <= 0) {
    reasons.push(
      `resampled candidate-minus-baseline avgR has p${Math.round(EXIT_DELTA_PERCENTILE * 100)} ` +
        `${paired.p5.toFixed(3)} (<= 0) over ${paired.blocks} shared monthly blocks ` +
        `(point estimate ${paired.delta >= 0 ? "+" : ""}${paired.delta.toFixed(3)}: ` +
        `${paired.candidateAvgR.toFixed(3)} vs ${paired.baselineAvgR.toFixed(3)}) — ` +
        `resampling whole months, the exit is not reliably better than the one we would have used anyway`,
    );
  }

  return { passed: reasons.length === 0, reasons };
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
