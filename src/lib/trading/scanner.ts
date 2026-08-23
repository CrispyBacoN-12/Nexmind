// SCANNER — the no-AI market watcher. Computes indicators on market candles (via the marketData router)
// and emits a candidate setup only when conditions align. Cheap: no AI calls.

import { type Interval, type Range } from "@/lib/yahoo";
import { fetchCandles } from "@/lib/marketData";
import {
  sma, rsi, macd, atr, adx, bollinger, stochastic, anchoredVWAP, anchorFor,
  volumeProfile, detectLiquiditySweep, type Candle,
} from "@/lib/indicators";
import { findRecentUpLeg } from "@/lib/swings";
import { lorentzianLast, type LCState } from "@/lib/lc/lorentzian";
import { getStrategy, type Strategy } from "./strategies";
import { getResearchStrategy } from "@/lib/research/adapter";

export interface ScanSnapshot {
  price: number;
  sma20: number | null;
  sma50: number | null;
  rsi: number | null;
  adx: number | null;
  plusDI: number | null;
  minusDI: number | null;
  macdHist: number | null;
  atr: number | null;
  /** Bollinger %B: position of price within the 20/2 bands (0 = lower band, 1 = upper band). Optional - only populated by the scanner and research adapter, not every ScanSnapshot builder. */
  bbPercentB?: number | null;
  /** Bollinger bandwidth: (upper-lower)/middle - band width relative to price, low = squeeze. */
  bbWidth?: number | null;
  /** Stochastic Oscillator %K (fast, smoothed 3). */
  stochK?: number | null;
  /** Stochastic Oscillator %D (signal line, %K smoothed 3 more). */
  stochD?: number | null;
  /** Deviation of price from session-anchored VWAP, as a fraction (0.01 = 1% above VWAP). */
  vwapDevPct?: number | null;
  /** Lorentzian Classification state (confluence filter); null when history is too short. */
  lc?: LCState | null;
  /** Where price sits against the rolling volume profile: -1 below the value
   *  area, 0 inside it, +1 above. Null when there isn't enough history. */
  vpPos?: -1 | 0 | 1 | null;
  /** Direction implied by a liquidity sweep on the last few bars, or null when
   *  no stop-hunt fired recently. */
  sweep?: "long" | "short" | null;
}

/** A sweep older than this many bars is history, not a trade trigger. */
const SWEEP_BARS = 3;

/**
 * The two structural reads that need candles rather than a single value —
 * computed here so the live scanner and the backtester build them the same way.
 * `i` is the bar being judged; only bars up to and including it are consulted.
 */
export function structureFields(
  candles: Candle[], i: number, price: number,
): Pick<ScanSnapshot, "vpPos" | "sweep"> {
  // Under ~20 bars the "value area" is a couple of candles wide and says nothing;
  // better to abstain than to hand a filter a number it will act on.
  const vp = i >= 19 ? volumeProfile(candles, i, Math.min(50, i + 1)) : null;
  const vpPos = vp ? (price > vp.vah ? 1 : price < vp.val ? -1 : 0) : null;

  // Most recent sweep wins; anything older than SWEEP_BARS is not a trigger.
  let sweep: "long" | "short" | null = null;
  for (let j = i; j > i - SWEEP_BARS && j >= 0; j--) {
    const sw = detectLiquiditySweep(candles, j, 20);
    if (sw) { sweep = sw.side; break; }
  }
  return { vpPos, sweep };
}

export interface ScanResult {
  symbol: string;
  timeframe: string;
  side: "long" | "short" | null;
  price: number;
  atr: number | null;
  snapshot: ScanSnapshot;
  note: string;
  candles: Candle[]; // recent tail, for the analysts
  /** Exit ladder tuned for the firing strategy (Backtest Lab), when it has one. */
  preferredExit?: Strategy["preferredExit"];
}

const last = <T,>(arr: (T | null)[]): T | null => {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i] as T;
  return null;
};

// Setup gate thresholds. Relaxed (2026-06-19) for more frequent day-trade
// entries: ADX floor 25→20, RSI band 40–60 → 35–70, and Lorentzian downgraded
// from a hard gate to a confidence annotation. The setup *structure* (trend
// alignment + DI + MACD) is unchanged. Exposed as a parameter so the backtester
// can sweep values to find the best fit per symbol/timeframe.
export interface SetupThresholds {
  adxFloor: number;
  rsiLow: number;
  rsiHigh: number;
  /**
   * Confluence filters — the indicators the scanner has always computed and then
   * thrown away. Every one is inert while undefined, so DEFAULT_THRESHOLDS keeps
   * the pre-existing behaviour bit-for-bit; they exist to be swept, and only earn
   * a place in the defaults by surviving an out-of-sample test.
   *
   * All of them are vetoes. None can create an entry the trend-pullback rule did
   * not already find — a filter that can only subtract cannot invent an edge, it
   * can only reveal whether the trades it removes were the losing ones.
   */
  /** Skip longs with Bollinger %B above this (and shorts below 1 - this): price
   *  already pinned to the band it is supposed to be pulling back from. */
  bbExtreme?: number;
  /** Require Bollinger bandwidth >= this fraction of price — no dead squeezes. */
  bbWidthMin?: number;
  /** Skip longs with Stochastic %K above this (shorts below 100 - this). */
  stochExtreme?: number;
  /** Require price on the trade's side of session VWAP. */
  requireVwapSide?: boolean;
  /** Require the Lorentzian classifier to agree with the side (it is currently
   *  only annotated onto the note). */
  requireLc?: boolean;
  /** Require price inside the volume-profile value area — no chasing outside it. */
  requireValueArea?: boolean;
  /** Require a recent liquidity sweep pointing the same way as the trade. */
  requireSweep?: boolean;
}
export const DEFAULT_THRESHOLDS: SetupThresholds = { adxFloor: 20, rsiLow: 35, rsiHigh: 70 };

/**
 * The pure setup decision — shared by the live scanner and the backtester so
 * the two can never drift apart.
 *   long  = uptrend (sma20>sma50, ADX>floor, +DI>-DI) + pullback (RSI band) + MACD turning up
 *   short = mirror image.
 * Lorentzian Classification, when present, is reported as a confidence cue
 * (✓ agrees / — diverges) but no longer blocks the setup.
 */
export function decideSetup(s: ScanSnapshot, t: SetupThresholds = DEFAULT_THRESHOLDS): { side: "long" | "short" | null; note: string } {
  const { sma20: s20, sma50: s50, rsi: r, adx: adxVal, plusDI: pDI, minusDI: mDI, macdHist: hist, atr: atrVal } = s;

  // Sequential gates — each failure reports the specific reason (for "no setup" logs).
  if (adxVal == null || s20 == null || s50 == null || r == null || pDI == null || mDI == null) {
    return { side: null, note: "no setup · insufficient data" };
  }
  if (adxVal <= t.adxFloor) {
    return { side: null, note: `no setup · weak trend (ADX ${adxVal.toFixed(0)} ≤ ${t.adxFloor})` };
  }
  const up = s20 > s50 && pDI > mDI;
  const down = s20 < s50 && mDI > pDI;
  if (!up && !down) {
    return { side: null, note: `no setup · trend not aligned (SMA/DI mixed, ADX ${adxVal.toFixed(0)})` };
  }
  if (r < t.rsiLow || r > t.rsiHigh) {
    return { side: null, note: `no setup · RSI ${r.toFixed(0)} outside ${t.rsiLow}-${t.rsiHigh}` };
  }
  if (up && !(hist == null || hist > -Math.abs((atrVal ?? 1) * 0.1))) {
    return { side: null, note: `no setup · MACD turning down (long blocked, RSI ${r.toFixed(0)})` };
  }

  const side: "long" | "short" = up ? "long" : "short";
  const veto = confluenceVeto(s, side, t);
  if (veto) return { side: null, note: `no setup · ${veto}` };

  const base = `${side === "long" ? "uptrend" : "downtrend"} pullback · ADX ${adxVal.toFixed(0)} · RSI ${r.toFixed(0)}`;
  if (s.lc) {
    const lcAgrees =
      side === "long" ? s.lc.signal === 1 && s.lc.kernelBullish : s.lc.signal === -1 && s.lc.kernelBearish;
    return { side, note: `${base} · LC ${lcAgrees ? "✓" : "—"} (${s.lc.prediction > 0 ? "+" : ""}${s.lc.prediction})` };
  }
  return { side, note: base };
}

/**
 * The optional confluence gates, applied only after the base setup has fired.
 * Each returns the reason it blocked the trade, or null to let it through; a
 * gate whose indicator is missing abstains rather than blocking, so a symbol
 * with short history is not silently filtered out of every backtest.
 */
function confluenceVeto(s: ScanSnapshot, side: "long" | "short", t: SetupThresholds): string | null {
  const long = side === "long";

  if (t.bbExtreme != null && s.bbPercentB != null) {
    const limit = long ? t.bbExtreme : 1 - t.bbExtreme;
    if (long ? s.bbPercentB > limit : s.bbPercentB < limit) {
      return `BB %B ${s.bbPercentB.toFixed(2)} past ${limit.toFixed(2)}`;
    }
  }
  if (t.bbWidthMin != null && s.bbWidth != null && s.bbWidth < t.bbWidthMin) {
    return `BB width ${(s.bbWidth * 100).toFixed(2)}% under ${(t.bbWidthMin * 100).toFixed(2)}%`;
  }
  if (t.stochExtreme != null && s.stochK != null) {
    const limit = long ? t.stochExtreme : 100 - t.stochExtreme;
    if (long ? s.stochK > limit : s.stochK < limit) {
      return `Stoch %K ${s.stochK.toFixed(0)} past ${limit.toFixed(0)}`;
    }
  }
  if (t.requireVwapSide && s.vwapDevPct != null && (long ? s.vwapDevPct < 0 : s.vwapDevPct > 0)) {
    return `wrong side of VWAP (${(s.vwapDevPct * 100).toFixed(2)}%)`;
  }
  if (t.requireLc && s.lc) {
    const agrees = long ? s.lc.signal === 1 && s.lc.kernelBullish : s.lc.signal === -1 && s.lc.kernelBearish;
    if (!agrees) return `LC disagrees (${s.lc.prediction > 0 ? "+" : ""}${s.lc.prediction})`;
  }
  if (t.requireValueArea && s.vpPos != null && s.vpPos !== 0) {
    return `price ${s.vpPos > 0 ? "above" : "below"} the value area`;
  }
  if (t.requireSweep && s.sweep !== side) {
    return s.sweep ? `liquidity sweep points ${s.sweep}` : "no recent liquidity sweep";
  }
  return null;
}

/** One-line indicator context for "no setup" diagnostics on the strategy path. */
function snapshotDiag(s: ScanSnapshot): string {
  const parts: string[] = [];
  if (s.adx != null) parts.push(`ADX ${s.adx.toFixed(0)}`);
  if (s.rsi != null) parts.push(`RSI ${s.rsi.toFixed(0)}`);
  if (s.sma50 != null && s.price) parts.push(s.price > s.sma50 ? "above SMA50" : "below SMA50");
  return parts.join(" · ") || "no data";
}

/**
 * Scan one symbol. Returns a directional setup or `side: null` when nothing lines up.
 * Setup logic (intentionally simple, tune later):
 *   long  = uptrend (sma20>sma50, ADX>20, +DI>-DI) + pullback (RSI 35–70) + MACD turning up
 *   short = mirror image.
 * ADX floor relaxed 25→20 and RSI band widened 40–60 → 35–70 (2026-06-19) for
 * more frequent day-trade setups; see the thresholds above decideSetup.
 */
export async function scanSymbol(
  symbol: string,
  range: Range = "3mo", // 3mo of 1h bars (~400) gives the LC classifier real training depth
  interval: Interval = "1h",
  strategyKey?: string,
): Promise<ScanResult> {
  const resp = await fetchCandles(symbol, range, interval);
  const candles = resp.candles;
  symbol = resp.symbol; // carry the symbol forward from the fetch response
  const closes = candles.map((c) => c.c);
  const price = resp.price ?? closes.at(-1) ?? 0;

  const s20 = last(sma(closes, 20));
  const s50 = last(sma(closes, 50));
  const r = last(rsi(closes, 14));
  const { histogram } = macd(closes);
  const hist = last(histogram);
  const atrArr = atr(candles, 14);
  const atrVal = last(atrArr);
  const { adx: adxArr, plusDI, minusDI } = adx(candles, 14);
  const adxVal = last(adxArr);
  const pDI = last(plusDI);
  const mDI = last(minusDI);
  const { upper: bbUpper, middle: bbMiddle, lower: bbLower } = bollinger(closes, 20, 2);
  const bbU = last(bbUpper);
  const bbM = last(bbMiddle);
  const bbL = last(bbLower);
  const bbPercentB = bbU != null && bbL != null && bbU !== bbL ? (price - bbL) / (bbU - bbL) : null;
  const bbWidth = bbU != null && bbL != null && bbM ? (bbU - bbL) / bbM : null;
  const { k: stochKArr, d: stochDArr } = stochastic(candles, 14, 3, 3);
  const stochK = last(stochKArr);
  const stochD = last(stochDArr);
  const vwapArr = anchoredVWAP(candles, anchorFor(candles));
  const vwap = last(vwapArr);
  const vwapDevPct = vwap != null && vwap !== 0 ? (price - vwap) / vwap : null;

  const snapshot: ScanSnapshot = {
    price, sma20: s20, sma50: s50, rsi: r, adx: adxVal, plusDI: pDI, minusDI: mDI, macdHist: hist, atr: atrVal,
    bbPercentB, bbWidth, stochK, stochD, vwapDevPct,
    lc: lorentzianLast(candles),
    ...structureFields(candles, candles.length - 1, price),
  };

  // Entry decision: the chosen registry strategy on the full history, or the
  // built-in trend-pullback (default). Strategy modules are evaluated at the
  // latest bar so live entries match what the Backtest Lab measured.
  let side: "long" | "short" | null;
  let note: string;
  const strat = strategyKey && strategyKey !== "trend-pullback"
    ? getStrategy(strategyKey) ?? await getResearchStrategy(strategyKey)
    : null;
  if (strat) {
    const sig = strat.build(candles)(candles.length - 1);
    side = sig?.side ?? null;
    note = sig ? `${strat.label}: ${sig.note}` : `no setup · ${strat.label} no signal · ${snapshotDiag(snapshot)}`;
  } else {
    ({ side, note } = decideSetup(snapshot));
  }

  // Annotate with the most recent confirmed up-leg for the structure analyst.
  const leg = findRecentUpLeg(candles, 80, 3);
  if (leg) note += ` · swing ${leg.low.toFixed(2)}→${leg.high.toFixed(2)}`;

  return {
    symbol,
    timeframe: interval,
    side,
    price,
    atr: atrVal,
    snapshot,
    note,
    candles: candles.slice(-60),
    preferredExit: strat?.preferredExit,
  };
}
