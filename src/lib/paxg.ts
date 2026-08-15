// PAXG/USDT spot-gold proxy via Binance's public klines endpoint — no API key,
// no account, no country restriction (unlike OANDA/Finnhub, which this project
// hit KYC/paywall dead ends on). PAXG is a 1oz-gold-backed token that tracks
// spot XAU/USD closely, used here as an independent cross-check against
// Yahoo's GC=F futures feed. Data-only: never touches Binance's trading API.

import type { Candle } from "./indicators";
import type { CandleResponse, Range, Interval } from "./yahoo";

const BINANCE_BASE = "https://api.binance.com/api/v3/klines";
const SYMBOL = "PAXGUSDT";
const DAY_MS = 86_400_000;

/** Map our Interval to a Binance kline interval string. */
export function intervalToBinanceInterval(interval: Interval): string {
  switch (interval) {
    case "5m": return "5m";
    case "15m": return "15m";
    case "30m": return "30m";
    case "60m": return "1h";
    case "1h": return "1h";
    case "1d": return "1d";
    case "1wk": return "1w";
    default: {
      const _exhaustive: never = interval;
      throw new Error(`paxg: unsupported interval ${_exhaustive}`);
    }
  }
}

/** Lookback window (ms) for a Range, used to compute the Binance `startTime`. */
function rangeToLookbackMs(range: Range): number {
  const days: Record<Range, number> = {
    "1d": 1, "5d": 5, "1mo": 31, "3mo": 93, "6mo": 186,
    "1y": 366, "2y": 731, "5y": 1827, "max": 7305, // ~20y
  };
  return days[range] * DAY_MS;
}

// Binance kline row: [openTime, open, high, low, close, volume, closeTime, ...]
type BinanceKline = [number, string, string, string, string, string, ...unknown[]];

/**
 * Fetch PAXG/USDT candles from Binance's public (unauthenticated) klines
 * endpoint. Binance caps a single request at 1000 candles — fine for the
 * ad-hoc cross-checks this is built for, not a general backfill tool.
 */
export async function fetchPaxgCandles(
  range: Range = "1mo",
  interval: Interval = "1h",
): Promise<CandleResponse> {
  const startTime = Date.now() - rangeToLookbackMs(range);
  const params = new URLSearchParams({
    symbol: SYMBOL,
    interval: intervalToBinanceInterval(interval),
    startTime: String(startTime),
    limit: "1000",
  });

  const res = await fetch(`${BINANCE_BASE}?${params}`, { next: { revalidate: 30 } });
  if (!res.ok) throw new Error(`paxg upstream ${res.status}`);

  const rows = (await res.json()) as BinanceKline[];
  if (!rows || rows.length === 0) throw new Error("paxg: no candles");

  const candles: Candle[] = rows.map((r) => ({
    t: Math.floor(r[0] / 1000),
    o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]),
    v: Number(r[5]),
  }));

  return {
    symbol: SYMBOL,
    range,
    interval,
    price: candles.at(-1)?.c,
    candles,
  };
}
