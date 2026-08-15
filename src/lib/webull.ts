// Webull market-data provider — same CandleResponse shape as alpaca.ts/
// yahoo.ts so the router is provider-agnostic. Data-only: never touches
// Webull's PaperTrade order APIs (see webull/paperTrade.ts for that).
import type { Candle } from "./indicators";
import type { CandleResponse, Range, Interval } from "./yahoo";
import { signedFetch } from "./webull/auth";
import { getTickerId } from "./webull/symbols";

/** Map our Interval to Webull's bar-history "type" parameter (confirm the
 *  exact enum values against the live API reference before the first
 *  sandbox call). */
export function intervalToWebullType(interval: Interval): string {
  switch (interval) {
    case "5m": return "m5";
    case "15m": return "m15";
    case "30m": return "m30";
    case "60m": return "m60";
    case "1h": return "m60";
    case "1d": return "d1";
    case "1wk": return "w1";
    default: {
      const _exhaustive: never = interval;
      throw new Error(`webull: unsupported interval ${_exhaustive}`);
    }
  }
}

/** Bar count to request for a Range at a given Interval — same day-count/
 *  bars-per-day model as mt5.ts's rangeToBarCount, capped at 2000. */
export function rangeToWebullCount(range: Range, interval: Interval): number {
  const days: Record<Range, number> = {
    "1d": 1, "5d": 5, "1mo": 31, "3mo": 93, "6mo": 186,
    "1y": 366, "2y": 731, "5y": 1827, "max": 7305,
  };
  const barsPerDay: Record<Interval, number> = {
    "5m": 78, "15m": 26, "30m": 13, "60m": 7, "1h": 7, "1d": 1, "1wk": 1 / 7,
  };
  return Math.min(2000, Math.max(1, Math.ceil(days[range] * barsPerDay[interval])));
}

interface WebullBar { timestamp: number; open: number; high: number; low: number; close: number; volume: number; isExtendedHours?: boolean }

/** Pure transform from a Webull bar-history response to CandleResponse.
 *  Drops any bar flagged extended-hours so the output is RTH-only regardless
 *  of what the request parameters achieved, and sorts ascending by time.
 *  Throws when there are no RTH bars so the router can fall back. */
export function parseWebullBars(json: unknown, symbol: string, range: Range, interval: Interval): CandleResponse {
  const raw = (json as { data?: WebullBar[] })?.data ?? [];
  const rth = raw.filter((b) => !b.isExtendedHours);
  if (rth.length === 0) throw new Error("webull: no RTH bars for symbol");
  const candles: Candle[] = rth
    .map((b) => ({ t: Math.floor(b.timestamp), o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume ?? 0 }))
    .sort((a, b) => a.t - b.t);
  return { symbol, range, interval, price: candles.at(-1)?.c, candles };
}

const DATA_HOST = () => process.env.WEBULL_BASE_URL || "https://quotes-api.webullbroker.com"; // confirm host against the live API reference

/** Fetch candles from Webull. Throws on missing credentials, non-OK status,
 *  or an empty RTH bar set — callers fall back to Alpaca/Yahoo. */
export async function fetchWebullCandles(symbol: string, range: Range = "1mo", interval: Interval = "1h"): Promise<CandleResponse> {
  if (!process.env.WEBULL_APP_KEY || !process.env.WEBULL_APP_SECRET) {
    throw new Error("webull: missing WEBULL_APP_KEY / WEBULL_APP_SECRET");
  }
  const tickerId = await getTickerId(symbol);
  const res = await signedFetch("/api/openapi/quote/kline", {
    baseUrl: DATA_HOST(),
    method: "GET",
    params: {
      tickerId: String(tickerId),
      type: intervalToWebullType(interval),
      count: String(rangeToWebullCount(range, interval)),
      // Adjusted, RTH-only bars — matches the convention Alpaca/Yahoo already
      // return; exact param names need confirming against the live docs.
      extendTrading: "0",
      adjustType: "1",
    },
  });
  if (!res.ok) throw new Error(`webull upstream ${res.status}`);
  return parseWebullBars(await res.json(), symbol, range, interval);
}
