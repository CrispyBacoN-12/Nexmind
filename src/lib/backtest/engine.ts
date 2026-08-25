// Backtest engine for the rule-based core of the desk: Scanner setup →
// ATR levels → TP-ladder exits. No AI, no I/O — pure and deterministic, so the
// result is an honest baseline for what the strategy skeleton earns on its own.
//
// Fidelity notes (kept intentionally pessimistic):
// - Entries fill at the signal bar's close (the live engine enters at scan price).
// - Exits are evaluated from the NEXT bar onward using intrabar high/low, and the
//   ADVERSE price is checked first — if a bar touches both SL and TP, we book the
//   loss. Live fills are friendlier, so real results should skew better, not worse.
// - One open position per symbol (mirrors the live dedupe rule).

import {
  sma, rsi, macd, atr, adx, bollinger, stochastic, anchoredVWAP, anchorFor, type Candle,
} from "@/lib/indicators";
import { decideSetup, structureFields, DEFAULT_THRESHOLDS, type ScanSnapshot, type SetupThresholds } from "@/lib/trading/scanner";
import { decideAction, type LadderState, type OpenPosition, type TrailConfig } from "@/lib/trading/positionRules";
import { lorentzianSeries } from "@/lib/lc/lorentzian";
import { computeStats } from "@/lib/trading/stats";

// Same constants as the live desk (hawk.computeLevels defaults + manage POINT_VALUE).
const ATR_SL_MULT = 1.5;
const ATR_TP_MULT = 2.5;
const TP2_FACTOR = 1.6; // tp2 = tpMult * 1.6 * atr
const POINT_VALUE = 1;
// Bars needed before sma50/ADX values are meaningful. Exported because the
// random-entry control has to draw its fake entries from exactly the bars the
// real rule was allowed to fire on — a control that could enter during warm-up
// would be matched on count but not on opportunity.
export const WARMUP = 60;

export interface SimTrade {
  symbol: string;
  side: "long" | "short";
  entry: number;
  exit: number;
  sl: number;
  tp1: number;
  tp2: number;
  lot: number;
  outcome: "win" | "loss" | "breakeven";
  tp1Hit: boolean;
  pnl: number; // net of slippage/commission (equals grossPnl when no CostModel is applied)
  grossPnl: number; // pnl before slippage/commission
  rMultiple: number | null;
  openedAt: Date;
  closedAt: Date;
}

/**
 * Trading friction, expressed in basis points so the same model scales across
 * assets with wildly different price levels (gold ~$2k, BTC ~$60k, stocks ~$100).
 * Both fields default to 0 (no cost) so every existing caller of openPosition/
 * stepPosition/backtestCandles is unaffected unless it opts in.
 */
export interface CostModel {
  slippageBps?: number; // price-worse-than-theoretical on every fill (entry, partial exit, final exit)
  commissionBps?: number; // round-turn commission, applied once per closed trade against notional (lot * entry)
}

const NO_COSTS: CostModel = {};

// Shared disclosed cost assumption for every paper-money path in the app (QUANT
// research backtests and the live paper desk alike): calibrated to a real MT5
// Raw/ECN gold account (the broker type this desk actually trades through) —
// ~$0.10/oz spread + ~$7/lot round-turn commission, padded 2x for safety.
// Previously this was a generic crypto/CFD taker-fee guess (5bps/10bps) that
// overstated real gold trading costs by roughly an order of magnitude; every
// consumer imports this one constant, so all paper P/L stays judged consistently.
export const DEFAULT_COST_MODEL: CostModel = { slippageBps: 0.5, commissionBps: 1 };

export interface BacktestResult {
  symbol: string;
  bars: number;
  signals: number;
  trades: SimTrade[]; // closed trades only
  openAtEnd: boolean;
}

/**
 * Per-bar indicator snapshots, computed once over the whole series (all causal).
 *
 * This used to stop at the nine indicators the base setup reads. Everything the
 * scanner also computes — Bollinger, Stochastic, VWAP, the volume profile, the
 * sweep — was simply absent here, so any confluence filter added to decideSetup
 * would have been inert in the backtest and reported "no effect" no matter what
 * it actually did to live entries. A filter you cannot measure is worse than one
 * you never added.
 */
export function barSnapshots(candles: Candle[]): ScanSnapshot[] {
  const closes = candles.map((c) => c.c);
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const r = rsi(closes, 14);
  const { histogram } = macd(closes);
  const atrArr = atr(candles, 14);
  const { adx: adxArr, plusDI, minusDI } = adx(candles, 14);
  const { upper: bbU, middle: bbM, lower: bbL } = bollinger(closes, 20, 2);
  const { k: stochK, d: stochD } = stochastic(candles, 14, 3, 3);
  // anchorFor, not dailyAnchor: on daily bars a per-day reset makes every bar its
  // own session and the deviation is ~0 everywhere. Same chooser the live scanner
  // uses, so a 1h backtest still anchors exactly the way the desk does.
  const vwapArr = anchoredVWAP(candles, anchorFor(candles));
  const lc = lorentzianSeries(candles); // confluence filter, same as the live scanner
  return candles.map((c, i) => {
    const u = bbU[i];
    const l = bbL[i];
    const m = bbM[i];
    const vwap = vwapArr[i];
    return {
      price: c.c,
      sma20: s20[i],
      sma50: s50[i],
      rsi: r[i],
      adx: adxArr[i],
      plusDI: plusDI[i],
      minusDI: minusDI[i],
      macdHist: histogram[i],
      atr: atrArr[i],
      bbPercentB: u != null && l != null && u !== l ? (c.c - l) / (u - l) : null,
      bbWidth: u != null && l != null && m ? (u - l) / m : null,
      stochK: stochK[i],
      stochD: stochD[i],
      vwapDevPct: vwap != null && vwap !== 0 ? (c.c - vwap) / vwap : null,
      lc: {
        prediction: lc.prediction[i],
        signal: lc.signal[i],
        kernelBullish: lc.kernelBullish[i],
        kernelBearish: lc.kernelBearish[i],
      },
      ...structureFields(candles, i, c.c),
    };
  });
}

export interface SimPosition extends OpenPosition {
  tp2: number | null; // null = single-target mode: TP1 is the full exit, no partial/breakeven leg
  lot: number;
  openedAt: Date;
  ladder: LadderState;
  costs: CostModel;
}

export type StepResult = { status: "open" } | { status: "closed"; trade: Omit<SimTrade, "symbol"> };

/**
 * Advance one open position through one bar's high/low. Mutates `pos` (ladder/SL)
 * on a TP1 partial. Pessimistic: the adverse extreme is offered to the ladder
 * BEFORE the favorable one, so a bar touching both SL and TP books the loss.
 */
export function stepPosition(pos: SimPosition, bar: Candle): StepResult {
  const adverse = pos.side === "long" ? bar.l : bar.h;
  const favorable = pos.side === "long" ? bar.h : bar.l;

  let action = decideAction(pos, pos.ladder, adverse);
  // A trailing position's adverse call can itself return "trail-update" (not
  // just "hold") whenever the bar's worse-of-the-two price is still favorable
  // vs. the prior extreme (e.g. the whole bar gapped up on a long) — that must
  // still fall through to the favorable check below, or the bar's TRUE best
  // price (and thus the correct ratchet) is silently never applied. Unlike
  // "hold", a "close"/"partial-tp1" from the adverse check is a resolved,
  // intentionally-pessimistic outcome and must NOT be overridden by rechecking
  // the favorable price.
  if (action.kind === "hold" || action.kind === "trail-update") action = decideAction(pos, pos.ladder, favorable);

  // Ratchet: still open, no fill involved — just persist the tightened SL and
  // the new best-price-since-entry so the next bar's decideAction call sees it.
  if (action.kind === "trail-update") {
    pos.sl = action.sl;
    pos.ladder = { ...pos.ladder, trailExtreme: action.extreme };
    return { status: "open" };
  }

  // Closing a long is a sell (fills lower than theoretical); closing a short is
  // a buy-to-cover (fills higher). Always worse for the trader, on both the
  // TP1 partial leg and the final exit.
  const slipFrac = (pos.costs.slippageBps ?? 0) / 10000;
  const fillExit = (theoretical: number) =>
    pos.side === "long" ? theoretical * (1 - slipFrac) : theoretical * (1 + slipFrac);

  if (action.kind === "partial-tp1") {
    const exit = fillExit(action.exit);
    const favorableMove = pos.side === "long" ? exit - pos.entry : pos.entry - exit;
    pos.ladder = {
      tp1Hit: true,
      partialPnl: favorableMove * (pos.lot / 2) * POINT_VALUE,
      origSl: pos.sl,
    };
    pos.sl = pos.entry; // breakeven
    return { status: "open" };
  }

  if (action.kind === "close") {
    const exit = fillExit(action.exit);
    const remainingLot = pos.ladder.tp1Hit ? pos.lot / 2 : pos.lot;
    const favorableMove = pos.side === "long" ? exit - pos.entry : pos.entry - exit;
    const grossPnl = (pos.ladder.partialPnl ?? 0) + favorableMove * remainingLot * POINT_VALUE;
    const notional = pos.lot * pos.entry * POINT_VALUE;
    const commission = notional * ((pos.costs.commissionBps ?? 0) / 10000);
    const pnl = grossPnl - commission;
    const risk = Math.abs(pos.entry - (pos.ladder.origSl ?? pos.sl));
    return {
      status: "closed",
      trade: {
        side: pos.side,
        entry: pos.entry,
        exit,
        sl: pos.ladder.origSl ?? pos.sl,
        tp1: pos.tp1,
        tp2: pos.tp2 ?? pos.tp1,
        lot: pos.lot,
        outcome: action.outcome,
        tp1Hit: pos.ladder.tp1Hit ?? false,
        pnl,
        grossPnl,
        rMultiple: risk > 0 ? pnl / (risk * pos.lot * POINT_VALUE) : null,
        openedAt: pos.openedAt,
        closedAt: new Date(bar.t * 1000),
      },
    };
  }

  return { status: "open" };
}

/**
 * Build a position the way the live desk does: ATR-multiple levels off the entry.
 * `singleTarget` makes TP1 the sole/full exit (tp2 null) instead of a partial
 * leg toward a farther TP2 — see positionRules.decideAction, which already
 * treats a null tp2 as "close full position, outcome win" on TP1 touch.
 */
export function openPosition(
  side: "long" | "short",
  entry: number,
  atrVal: number,
  lot: number,
  openedAt: Date,
  singleTarget = false,
  tp1Mult = ATR_TP_MULT,
  costs: CostModel = NO_COSTS,
  slMult = ATR_SL_MULT,
  trailMult?: { activateMult: number; offsetMult: number },
): SimPosition {
  const dir = side === "long" ? 1 : -1;
  // Buying (long) fills higher than the signal price, selling (short) fills
  // lower — always worse for the trader. SL/TP are ATR-multiples off the
  // actual fill, same as a live bracket order placed right after the fill.
  const fillEntry = entry * (1 + dir * (costs.slippageBps ?? 0) / 10000);
  const sl = fillEntry - dir * slMult * atrVal;
  const trail: TrailConfig | null = trailMult
    ? { activateDist: trailMult.activateMult * atrVal, offsetDist: trailMult.offsetMult * atrVal }
    : null;
  return {
    side, entry: fillEntry, lot, openedAt, costs, sl, trail,
    // origSl anchors R-multiple math to the true initial risk once a trailing
    // stop ratchets sl away from where it opened (mirrors the breakeven-move case).
    ladder: trail ? { origSl: sl } : {},
    tp1: fillEntry + dir * tp1Mult * atrVal,
    tp2: singleTarget ? null : fillEntry + dir * tp1Mult * TP2_FACTOR * atrVal,
  };
}

// An entry rule answers per bar i: take a long/short or stand aside? The default
// is the built-in trend-pullback (decideSetup); the Backtest Lab passes a
// pluggable strategy evaluator instead to compare alternatives.
export type EntryRule = (i: number) => "long" | "short" | null;

/**
 * One symbol's entry decisions, decoupled from the exit geometry that trades them.
 *
 * `sides[i]` is what the entry rule said on bar i (null = stand aside) and
 * `atrs[i]` is the ATR used to place that bar's stop and target. Both are
 * index-aligned with the candle array they were built from.
 *
 * The point of splitting this out is that the entry side is by far the expensive
 * half — a sandboxed research strategy re-slices the whole history on every bar —
 * while the exit side is a cheap walk over highs and lows. The ladder sweep runs
 * eight exit geometries over ONE entry signal, and used to pay the entry cost
 * eight times over. So does the random-entry control in research/control.ts,
 * which reuses `atrs` verbatim and only replaces `sides`.
 */
export interface EntrySignals {
  sides: ("long" | "short" | null)[];
  atrs: number[];
}

export interface ExitOptions {
  lot?: number;
  singleTarget?: boolean;
  tp1Mult?: number;
  costs?: CostModel;
  slMult?: number;
  trail?: { activateMult: number; offsetMult: number };
  /**
   * First index at which a new position may open. Defaults to 0 (i.e. WARMUP).
   *
   * The panel passes a warm-up prefix of bars from *before* the fold it is
   * measuring, so that ATR/ADX/SMA50 at the fold's first bar are seeded from
   * real history instead of from the slice boundary — Wilder smoothing carries
   * a long memory, and a fold cut cold reads as a different market for its
   * first few hundred bars. Those prefix bars must inform the indicators
   * without ever being traded, which is exactly what this index expresses.
   */
  entryFrom?: number;
}

/**
 * Evaluate the entry rule once per bar and record what it said.
 *
 * Two deliberate differences from the loop this replaced:
 *
 * 1. The rule is now consulted on EVERY bar past warm-up, where the old inline
 *    version skipped bars on which a position happened to be open. For a pure
 *    rule (every built-in one, and every research candidate that behaves like a
 *    function of `(bars, snaps, i)`) the resulting signals are identical. For a
 *    rule that secretly carries state between calls the sequence it sees is now
 *    the same regardless of exit geometry — which is the property that makes an
 *    entry signal reusable across ladders at all, and arguably the more correct
 *    reading of "entry rule" either way.
 *
 * 2. The full ScanSnapshot array is built only when the built-in `decideSetup`
 *    is the entry rule. A caller-supplied EntryRule computes its own view of the
 *    bar, and the only field this function then needs is `.atr` — but
 *    barSnapshots() also builds the Lorentzian series and per-bar structure
 *    fields, which measured 210ms of a 431ms full-history AAPL backtest, every
 *    millisecond of it discarded.
 */
export function computeEntrySignals(
  candles: Candle[],
  thresholds: SetupThresholds = DEFAULT_THRESHOLDS,
  entry?: EntryRule,
  precomputed?: ScanSnapshot[],
): EntrySignals {
  const snaps = precomputed ?? (entry ? null : barSnapshots(candles));
  const atrArr: (number | null)[] = snaps ? snaps.map((s) => s.atr) : atr(candles, 14);

  const sides: ("long" | "short" | null)[] = new Array(candles.length).fill(null);
  const atrs: number[] = new Array(candles.length).fill(0);
  for (let i = 0; i < candles.length; i++) {
    atrs[i] = atrArr[i] ?? candles[i].c * 0.005;
    if (i < WARMUP) continue;
    sides[i] = entry ? entry(i) : decideSetup(snaps![i], thresholds).side;
  }
  return { sides, atrs };
}

/** Trade a precomputed entry signal under one exit geometry. Cheap and pure. */
export function simulateExits(
  symbol: string,
  candles: Candle[],
  signals: EntrySignals,
  opts: ExitOptions = {},
): BacktestResult {
  const {
    lot = 0.1,
    singleTarget = false,
    tp1Mult = ATR_TP_MULT,
    costs = NO_COSTS,
    slMult = ATR_SL_MULT,
    trail,
    entryFrom = 0,
  } = opts;

  const trades: SimTrade[] = [];
  let signalCount = 0;
  let open: SimPosition | null = null;

  // Nothing can be open before the first tradable bar, so starting the manage
  // step here too is equivalent to starting it at WARMUP.
  for (let i = Math.max(WARMUP, entryFrom); i < candles.length; i++) {
    const bar = candles[i];

    // 1) Manage any open position first (mirrors the bot's manage-before-scan order).
    if (open) {
      const r = stepPosition(open, bar);
      if (r.status === "closed") {
        trades.push({ symbol, ...r.trade });
        open = null;
      }
      if (open) continue; // still holding — one position per symbol, no new entries
    }

    // 2) Take this bar's signal, if there was one.
    const side = signals.sides[i];
    if (!side) continue;
    signalCount++;
    open = openPosition(side, bar.c, signals.atrs[i], lot, new Date(bar.t * 1000), singleTarget, tp1Mult, costs, slMult, trail);
  }

  return { symbol, bars: candles.length, signals: signalCount, trades, openAtEnd: open != null };
}

/** Run the rule-based strategy over one symbol's candles. */
export function backtestCandles(
  symbol: string,
  candles: Candle[],
  lot = 0.1,
  thresholds: SetupThresholds = DEFAULT_THRESHOLDS,
  entry?: EntryRule,
  singleTarget = false,
  tp1Mult = ATR_TP_MULT,
  costs: CostModel = NO_COSTS,
  slMult = ATR_SL_MULT,
  trail?: { activateMult: number; offsetMult: number },
  /** Snapshots for exactly these candles, when the caller already built them.
   *  Sweeps re-run the same series under a dozen threshold sets; recomputing the
   *  Lorentzian series each time costs more than the rest of the backtest. */
  precomputed?: ScanSnapshot[],
): BacktestResult {
  return simulateExits(symbol, candles, computeEntrySignals(candles, thresholds, entry, precomputed), {
    lot, singleTarget, tp1Mult, costs, slMult, trail,
  });
}

export interface BacktestSummary {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;       // %
  totalPnl: number;
  avgR: number | null;   // mean R-multiple over trades that have one
  expectancy: number | null; // avg pnl per trade
  profitFactor: number | null;   // gross win $ / gross loss $; null if no losing trades (undefined ratio)
  maxDrawdownPct: number | null; // largest peak-to-trough on the equity curve, as a positive % of startingBalance
  sharpeRatio: number | null;    // annualized, based on daily P/L (same math as the live-reporting path)
  sortinoRatio: number | null;   // annualized, based on daily P/L, downside deviation only
  totalCostsUsd: number;         // sum of grossPnl - pnl across all trades; 0 when no CostModel was applied
}

/** Reduce closed trades to the headline metrics used to compare configs. */
export function summarizeBacktest(trades: SimTrade[], startingBalance = 10000): BacktestSummary {
  const n = trades.length;
  const wins = trades.filter((t) => t.outcome === "win").length;
  const losses = trades.filter((t) => t.outcome === "loss").length;
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const rs = trades.map((t) => t.rMultiple).filter((r): r is number => r != null);
  const avgR = rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : null;

  const grossWin = trades.reduce((s, t) => s + Math.max(t.pnl, 0), 0);
  const grossLoss = trades.reduce((s, t) => s + Math.max(-t.pnl, 0), 0);
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : null;
  const totalCostsUsd = trades.reduce((s, t) => s + (t.grossPnl - t.pnl), 0);

  // Reuses the same equity-curve/Sharpe/Sortino math as the live-reporting
  // path (trading/stats.ts) so backtest and live numbers are directly
  // comparable. computeStats returns maxDrawdownPct as a negative number;
  // flipped to a positive magnitude here to match the montecarlo.ts /
  // circuitBreaker.ts convention used elsewhere in this codebase.
  const perf = computeStats(trades, startingBalance);

  return {
    trades: n,
    wins,
    losses,
    winRate: n ? (wins / n) * 100 : 0,
    totalPnl,
    avgR,
    expectancy: n ? totalPnl / n : null,
    profitFactor,
    maxDrawdownPct: perf.maxDrawdownPct == null ? null : Math.abs(perf.maxDrawdownPct),
    sharpeRatio: perf.sharpeRatio,
    sortinoRatio: perf.sortinoRatio,
    totalCostsUsd,
  };
}
