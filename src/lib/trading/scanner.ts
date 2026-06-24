// SCANNER — the no-AI market watcher. Computes indicators on market candles (via the marketData router)
// and emits a candidate setup only when conditions align. Cheap: no AI calls.

import { type Interval, type Range } from "@/lib/yahoo";
import { fetchCandles } from "@/lib/marketData";
import { sma, rsi, macd, atr, adx, type Candle } from "@/lib/indicators";
import { findRecentUpLeg } from "@/lib/swings";
import { lorentzianLast, type LCState } from "@/lib/lc/lorentzian";
import { getStrategy } from "./strategies";

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
  /** Lorentzian Classification state (confluence filter); null when history is too short. */
  lc?: LCState | null;
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
export interface SetupThresholds { adxFloor: number; rsiLow: number; rsiHigh: number }
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
  const base = `${side === "long" ? "uptrend" : "downtrend"} pullback · ADX ${adxVal.toFixed(0)} · RSI ${r.toFixed(0)}`;
  if (s.lc) {
    const lcAgrees =
      side === "long" ? s.lc.signal === 1 && s.lc.kernelBullish : s.lc.signal === -1 && s.lc.kernelBearish;
    return { side, note: `${base} · LC ${lcAgrees ? "✓" : "—"} (${s.lc.prediction > 0 ? "+" : ""}${s.lc.prediction})` };
  }
  return { side, note: base };
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

  const snapshot: ScanSnapshot = {
    price, sma20: s20, sma50: s50, rsi: r, adx: adxVal, plusDI: pDI, minusDI: mDI, macdHist: hist, atr: atrVal,
    lc: lorentzianLast(candles),
  };

  // Entry decision: the chosen registry strategy on the full history, or the
  // built-in trend-pullback (default). Strategy modules are evaluated at the
  // latest bar so live entries match what the Backtest Lab measured.
  let side: "long" | "short" | null;
  let note: string;
  const strat = strategyKey && strategyKey !== "trend-pullback" ? getStrategy(strategyKey) : null;
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
  };
}
