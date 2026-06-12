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

import { sma, rsi, macd, atr, adx, type Candle } from "@/lib/indicators";
import { decideSetup, type ScanSnapshot } from "@/lib/trading/scanner";
import { decideAction, type LadderState, type OpenPosition } from "@/lib/trading/positionRules";
import { lorentzianSeries } from "@/lib/lc/lorentzian";

// Same constants as the live desk (hawk.computeLevels defaults + manage POINT_VALUE).
const ATR_SL_MULT = 1.5;
const ATR_TP_MULT = 2.5;
const TP2_FACTOR = 1.6; // tp2 = tpMult * 1.6 * atr
const POINT_VALUE = 1;
const WARMUP = 60; // bars needed before sma50/ADX values are meaningful

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
  pnl: number;
  rMultiple: number | null;
  openedAt: Date;
  closedAt: Date;
}

export interface BacktestResult {
  symbol: string;
  bars: number;
  signals: number;
  trades: SimTrade[]; // closed trades only
  openAtEnd: boolean;
}

/** Per-bar indicator snapshots, computed once over the whole series (all causal). */
function snapshots(candles: Candle[]): ScanSnapshot[] {
  const closes = candles.map((c) => c.c);
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const r = rsi(closes, 14);
  const { histogram } = macd(closes);
  const atrArr = atr(candles, 14);
  const { adx: adxArr, plusDI, minusDI } = adx(candles, 14);
  const lc = lorentzianSeries(candles); // confluence filter, same as the live scanner
  return candles.map((c, i) => ({
    price: c.c,
    sma20: s20[i],
    sma50: s50[i],
    rsi: r[i],
    adx: adxArr[i],
    plusDI: plusDI[i],
    minusDI: minusDI[i],
    macdHist: histogram[i],
    atr: atrArr[i],
    lc: {
      prediction: lc.prediction[i],
      signal: lc.signal[i],
      kernelBullish: lc.kernelBullish[i],
      kernelBearish: lc.kernelBearish[i],
    },
  }));
}

export interface SimPosition extends OpenPosition {
  tp2: number;
  lot: number;
  openedAt: Date;
  ladder: LadderState;
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
  if (action.kind === "hold") action = decideAction(pos, pos.ladder, favorable);

  if (action.kind === "partial-tp1") {
    const favorableMove = pos.side === "long" ? action.exit - pos.entry : pos.entry - action.exit;
    pos.ladder = {
      tp1Hit: true,
      partialPnl: favorableMove * (pos.lot / 2) * POINT_VALUE,
      origSl: pos.sl,
    };
    pos.sl = pos.entry; // breakeven
    return { status: "open" };
  }

  if (action.kind === "close") {
    const remainingLot = pos.ladder.tp1Hit ? pos.lot / 2 : pos.lot;
    const favorableMove = pos.side === "long" ? action.exit - pos.entry : pos.entry - action.exit;
    const pnl = (pos.ladder.partialPnl ?? 0) + favorableMove * remainingLot * POINT_VALUE;
    const risk = Math.abs(pos.entry - (pos.ladder.origSl ?? pos.sl));
    return {
      status: "closed",
      trade: {
        side: pos.side,
        entry: pos.entry,
        exit: action.exit,
        sl: pos.ladder.origSl ?? pos.sl,
        tp1: pos.tp1,
        tp2: pos.tp2,
        lot: pos.lot,
        outcome: action.outcome,
        tp1Hit: pos.ladder.tp1Hit ?? false,
        pnl,
        rMultiple: risk > 0 ? pnl / (risk * pos.lot * POINT_VALUE) : null,
        openedAt: pos.openedAt,
        closedAt: new Date(bar.t * 1000),
      },
    };
  }

  return { status: "open" };
}

/** Build a position the way the live desk does: ATR-multiple levels off the entry. */
export function openPosition(side: "long" | "short", entry: number, atrVal: number, lot: number, openedAt: Date): SimPosition {
  const dir = side === "long" ? 1 : -1;
  return {
    side, entry, lot, openedAt, ladder: {},
    sl: entry - dir * ATR_SL_MULT * atrVal,
    tp1: entry + dir * ATR_TP_MULT * atrVal,
    tp2: entry + dir * ATR_TP_MULT * TP2_FACTOR * atrVal,
  };
}

/** Run the rule-based strategy over one symbol's candles. */
export function backtestCandles(symbol: string, candles: Candle[], lot = 0.1): BacktestResult {
  const snaps = snapshots(candles);
  const trades: SimTrade[] = [];
  let signals = 0;
  let open: SimPosition | null = null;

  for (let i = WARMUP; i < candles.length; i++) {
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

    // 2) Look for a fresh setup on this bar.
    const { side } = decideSetup(snaps[i]);
    if (!side) continue;
    signals++;

    const a = snaps[i].atr ?? bar.c * 0.005;
    open = openPosition(side, bar.c, a, lot, new Date(bar.t * 1000));
  }

  return { symbol, bars: candles.length, signals, trades, openAtEnd: open != null };
}
