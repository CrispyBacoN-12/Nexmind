// Deterministic support/resistance + trade levels from a price series. Pure, so
// the invest advisor can show chart-derived levels alongside the AI's suggestion.

import { atr, type Candle } from "@/lib/indicators";

export interface TechLevels {
  price: number;
  support: number | null;     // nearest pivot low below price
  resistance: number | null;  // nearest pivot high above price
  stop: number | null;        // below support, ATR-buffered
  target: number | null;      // resistance (first objective)
  rr: number | null;          // reward:risk from current price
  atr: number | null;
}

const lastNonNull = (arr: (number | null)[]): number | null => {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i];
  return null;
};

/** Pivot highs/lows: bars whose high/low is the strict extreme of the +/-w window. */
function pivots(candles: Candle[], w: number): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = w; i < candles.length - w; i++) {
    let isHigh = true, isLow = true;
    for (let k = 1; k <= w; k++) {
      if (candles[i - k].h >= candles[i].h || candles[i + k].h >= candles[i].h) isHigh = false;
      if (candles[i - k].l <= candles[i].l || candles[i + k].l <= candles[i].l) isLow = false;
    }
    if (isHigh) highs.push(candles[i].h);
    if (isLow) lows.push(candles[i].l);
  }
  return { highs, lows };
}

export function computeLevels(candles: Candle[], price: number, pivotWindow = 3): TechLevels {
  const empty: TechLevels = { price, support: null, resistance: null, stop: null, target: null, rr: null, atr: null };
  if (candles.length === 0 || !(price > 0)) return empty;

  const { highs, lows } = pivots(candles, pivotWindow);
  // Nearest pivot above/below the current price (null when price is at the extreme).
  const resistance = highs.filter((h) => h > price).sort((a, b) => a - b)[0] ?? null;
  const support = lows.filter((l) => l < price).sort((a, b) => b - a)[0] ?? null;

  const a = lastNonNull(atr(candles, 14));
  const buffer = (a ?? price * 0.03) * 0.5;
  const stop = support != null ? support - buffer : null;
  const target = resistance;

  const risk = stop != null ? price - stop : null;
  const reward = target != null ? target - price : null;
  const rr = risk != null && risk > 0 && reward != null ? reward / risk : null;

  return { price, support, resistance, stop, target, rr, atr: a };
}
