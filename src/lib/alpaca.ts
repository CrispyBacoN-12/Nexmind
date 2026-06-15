// Alpaca market-data provider. Returns the same CandleResponse shape as the
// Yahoo fetcher so the rest of the app is provider-agnostic. Data-only:
// this never touches Alpaca's order/account APIs.

import type { Candle } from "./indicators";
import type { CandleResponse, Range, Interval } from "./yahoo";

const DAY_MS = 86_400_000;

/** Map our Interval to an Alpaca v2 timeframe string. */
export function intervalToTimeframe(interval: Interval): string {
  switch (interval) {
    case "5m": return "5Min";
    case "15m": return "15Min";
    case "30m": return "30Min";
    case "60m": return "1Hour";
    case "1h": return "1Hour";
    case "1d": return "1Day";
    case "1wk": return "1Week";
    default: {
      const _exhaustive: never = interval;
      throw new Error(`alpaca: unsupported interval ${_exhaustive}`);
    }
  }
}

/** Lookback window (ms) for a Range, used to compute the Alpaca `start` time. */
export function rangeToLookbackMs(range: Range): number {
  const days: Record<Range, number> = {
    "1d": 1, "5d": 5, "1mo": 31, "3mo": 93, "6mo": 186,
    "1y": 366, "2y": 731, "5y": 1827, "max": 7305, // ~20y
  };
  return days[range] * DAY_MS;
}

interface AlpacaBar { t: string; o: number; h: number; l: number; c: number; v: number }

/**
 * Pure transform from an Alpaca bars response body to CandleResponse.
 * Throws when there are no bars so the router can fall back to Yahoo.
 */
export function parseAlpacaBars(
  json: unknown,
  symbol: string,
  range: Range,
  interval: Interval,
): CandleResponse {
  const bars = (json as { bars?: AlpacaBar[] })?.bars;
  if (!bars || bars.length === 0) {
    throw new Error("alpaca: no bars for symbol");
  }
  const candles: Candle[] = bars.map((b) => ({
    t: Math.floor(Date.parse(b.t) / 1000),
    o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0,
  }));
  return {
    symbol,
    range,
    interval,
    price: candles.at(-1)?.c,
    candles,
  };
}
