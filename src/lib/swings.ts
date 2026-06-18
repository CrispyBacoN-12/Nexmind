// Swing-leg (pivot) detection — used by the HAWK structure analyst.
// Copied from the stock-tracker project.

import type { Candle } from "./indicators";

export interface SwingLeg {
  high: number;
  low: number;
  highT: number;
  lowT: number;
  highIdx: number;
  lowIdx: number;
}

/**
 * Find the most recent pivot-confirmed up-leg (swing low → swing high) inside
 * the lookback window ending at `currentIdx` (defaults to the last candle).
 * Returns null when no valid up-leg is found.
 */
export function findRecentUpLeg(
  candles: Candle[],
  lookback: number,
  pivotWindow: number,
  currentIdx?: number,
): SwingLeg | null {
  const n = candles.length;
  if (n === 0) return null;
  const idx = currentIdx ?? n - 1;
  const start = Math.max(0, idx - lookback);
  const scanFrom = start + pivotWindow;
  const scanTo = idx - pivotWindow;
  if (scanFrom > scanTo) return null;

  let lastHigh: { idx: number; price: number } | null = null;
  let lastLow: { idx: number; price: number } | null = null;

  for (let i = scanFrom; i <= scanTo; i++) {
    let isHigh = true;
    let isLow = true;
    for (let k = 1; k <= pivotWindow; k++) {
      if (candles[i - k].h >= candles[i].h || candles[i + k].h >= candles[i].h) isHigh = false;
      if (candles[i - k].l <= candles[i].l || candles[i + k].l <= candles[i].l) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) lastHigh = { idx: i, price: candles[i].h };
    if (isLow) lastLow = { idx: i, price: candles[i].l };
  }

  if (!lastHigh || !lastLow || lastLow.idx >= lastHigh.idx) return null;

  return {
    high: lastHigh.price,
    low: lastLow.price,
    highT: candles[lastHigh.idx].t,
    lowT: candles[lastLow.idx].t,
    highIdx: lastHigh.idx,
    lowIdx: lastLow.idx,
  };
}
