// The cross-sectional loop walks a shared calendar of trading days rather than
// each symbol's own bar array, so that "rank everything eligible today" is a
// well-defined operation. Daily bars arrive stamped at different times of day
// depending on the provider, so every timestamp is collapsed to a UTC day key
// before anything is compared.
import type { Candle } from "@/lib/indicators";

const DAY_SECONDS = 86_400;

/** Collapse an epoch-second timestamp to the UTC calendar day it falls in. */
export function dayKey(t: number): number {
  return Math.floor(t / DAY_SECONDS);
}

export interface AlignedUniverse {
  /** Sorted union of every day any symbol has a bar for. */
  days: number[];
  /** symbol -> (day key -> index into that symbol's candle array). */
  index: Map<string, Map<number, number>>;
}

export function alignUniverse(bars: Map<string, Candle[]>): AlignedUniverse {
  const daySet = new Set<number>();
  const index = new Map<string, Map<number, number>>();

  for (const [symbol, candles] of bars) {
    const perDay = new Map<number, number>();
    candles.forEach((candle, i) => {
      const key = dayKey(candle.t);
      daySet.add(key);
      perDay.set(key, i); // later bar on the same day wins
    });
    index.set(symbol, perDay);
  }

  return { days: [...daySet].sort((a, b) => a - b), index };
}
