// SCANNER — the no-AI market watcher. Computes indicators on free Yahoo candles
// and emits a candidate setup only when conditions align. Cheap: no AI calls.

import { fetchYahooCandlesSmart, type Interval, type Range } from "@/lib/yahoo";
import { sma, rsi, macd, atr, adx, type Candle } from "@/lib/indicators";
import { findRecentUpLeg } from "@/lib/swings";
import { lorentzianLast, type LCState } from "@/lib/lc/lorentzian";

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

/**
 * The pure setup decision — shared by the live scanner and the backtester so
 * the two can never drift apart.
 *   long  = uptrend (sma20>sma50, ADX>25, +DI>-DI) + healthy pullback (RSI 40–60) + MACD turning up
 *   short = mirror image.
 * Confluence: when a Lorentzian Classification state is present in the snapshot,
 * the LC signal AND kernel direction must agree with the rule-based side.
 */
export function decideSetup(s: ScanSnapshot): { side: "long" | "short" | null; note: string } {
  const { sma20: s20, sma50: s50, rsi: r, adx: adxVal, plusDI: pDI, minusDI: mDI, macdHist: hist, atr: atrVal } = s;

  const trending = adxVal != null && adxVal > 25;
  if (trending && s20 != null && s50 != null && r != null && pDI != null && mDI != null) {
    const up = s20 > s50 && pDI > mDI;
    const down = s20 < s50 && mDI > pDI;
    let side: "long" | "short" | null = null;
    if (up && r >= 40 && r <= 60 && (hist == null || hist > -Math.abs((atrVal ?? 1) * 0.1))) side = "long";
    else if (down && r >= 40 && r <= 60) side = "short";

    if (side) {
      const base = `${side === "long" ? "uptrend" : "downtrend"} pullback · ADX ${adxVal.toFixed(0)} · RSI ${r.toFixed(0)}`;
      if (s.lc) {
        const lcAgrees =
          side === "long" ? s.lc.signal === 1 && s.lc.kernelBullish : s.lc.signal === -1 && s.lc.kernelBearish;
        if (!lcAgrees) {
          return { side: null, note: `${base} · LC disagrees (${s.lc.prediction > 0 ? "+" : ""}${s.lc.prediction})` };
        }
        return { side, note: `${base} · LC ${s.lc.prediction > 0 ? "+" : ""}${s.lc.prediction} ✓` };
      }
      return { side, note: base };
    }
  }
  return { side: null, note: "no setup" };
}

/**
 * Scan one symbol. Returns a directional setup or `side: null` when nothing lines up.
 * Setup logic (intentionally simple, tune later):
 *   long  = uptrend (sma20>sma50, ADX>25, +DI>-DI) + healthy pullback (RSI 40–60) + MACD turning up
 *   short = mirror image.
 * ADX floor raised 20→25 (2026-06-12): fewer, stronger-trend setups — each one
 * costs 3-4 AI calls, so the scanner gate is the main quota lever.
 */
export async function scanSymbol(
  symbol: string,
  range: Range = "3mo", // 3mo of 1h bars (~400) gives the LC classifier real training depth
  interval: Interval = "1h",
): Promise<ScanResult> {
  const resp = await fetchYahooCandlesSmart(symbol, range, interval);
  const candles = resp.candles;
  symbol = resp.symbol; // use the resolved symbol (e.g. JMART → JMART.BK)
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

  let { side, note } = decideSetup(snapshot);

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
