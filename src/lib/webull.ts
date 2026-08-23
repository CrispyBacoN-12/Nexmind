// Webull market-data provider — same CandleResponse shape as alpaca.ts/
// yahoo.ts so the router is provider-agnostic. Data-only, and necessarily so:
// Webull is not usable as an execution venue from here (see below).
//
// Signs against the sandbox/UAT host with the shared WEBULL_PAPER_APP_KEY/
// SECRET pair, not the production WEBULL_APP_KEY/SECRET pair — verified
// (scripts/webull-sandbox-smoke-test.mts) that GET /openapi/market-data/stock/bars
// returns real market data on sandbox with plain AK/SK signing, no
// x-access-token exchange required. Production requires that exchange to be
// approved in the Webull mobile app per session, which doesn't suit an
// unattended fetch path; sandbox needs no such approval.
//
// Why there is no order path here: the sandbox host serves only market-data
// plus /openapi/account/list — every /openapi/trade/* route 404s at its
// gateway. Those routes do exist on production (api.webull.co.th), but there
// they answer INVALID_TOKEN without an x-access-token, i.e. they need the
// same per-session mobile approval. A shadow paper-trade path used to live
// in webull/paperTrade.ts + webull/symbols.ts; it never placed a single
// order because it targeted Webull's legacy app API (/api/paper/order/*,
// /api/openapi/quote/symbol-search), which does not exist on the OpenAPI
// gateway at all. It was removed rather than ported, for the reason above.
//
// Note for any future port: a symbol-search call is not needed — the bars
// response already carries tickerId/instrument_id on every row.
import type { Candle } from "./indicators";
import type { CandleResponse, Range, Interval } from "./yahoo";
import { signedFetch } from "./webull/auth";

/** Map our Interval to Webull's Timespan enum name (the wire value the SDK
 *  sends is the enum member's name, e.g. "D", "M60" — not its numeric code). */
export function intervalToWebullTimespan(interval: Interval): string {
  switch (interval) {
    case "1m": return "M1";
    case "5m": return "M5";
    case "15m": return "M15";
    case "30m": return "M30";
    case "60m": return "M60";
    case "1h": return "M60";
    case "1d": return "D";
    case "1wk": return "W";
    default: {
      const _exhaustive: never = interval;
      throw new Error(`webull: unsupported interval ${_exhaustive}`);
    }
  }
}

/** Bar count to request for a Range at a given Interval — same day-count/
 *  bars-per-day model as mt5.ts's rangeToBarCount, capped at 1200 (the
 *  live API's enforced max for GET /openapi/market-data/stock/bars — a
 *  count above that returns a 417 ILLEGAL_PARAMETER, verified against the
 *  sandbox). */
export function rangeToWebullCount(range: Range, interval: Interval): number {
  const days: Record<Range, number> = {
    "1d": 1, "5d": 5, "1mo": 31, "3mo": 93, "6mo": 186,
    "1y": 366, "2y": 731, "5y": 1827, "max": 7305,
  };
  const barsPerDay: Record<Interval, number> = {
    "1m": 390, "5m": 78, "15m": 26, "30m": 13, "60m": 7, "1h": 7, "1d": 1, "1wk": 1 / 7,
  };
  return Math.min(1200, Math.max(1, Math.ceil(days[range] * barsPerDay[interval])));
}

interface WebullBar {
  time: string; // ISO-8601, e.g. "2026-08-14T04:00:00.000+0000"
  open: string; high: string; low: string; close: string; volume: string;
  // "" (daily/weekly bars) or "RTH" (intraday bars) = regular hours; any
  // other non-empty value (verified against the live API: only "RTH" shows
  // up in practice, but Webull's own docs list pre/after-market tags too) =
  // extended hours.
  trading_session?: string;
}

const REGULAR_SESSION_TAGS = new Set(["", "RTH"]);

/** Pure transform from a Webull bars response (a bare JSON array, per the
 *  live API) to CandleResponse. Drops any bar tagged with an extended-hours
 *  trading_session so the output is RTH-only regardless of what the request
 *  parameters achieved, and sorts ascending by time. Throws when there are
 *  no RTH bars so the router can fall back. */
export function parseWebullBars(json: unknown, symbol: string, range: Range, interval: Interval): CandleResponse {
  const raw = Array.isArray(json) ? (json as WebullBar[]) : [];
  const rth = raw.filter((b) => REGULAR_SESSION_TAGS.has(b.trading_session ?? ""));
  if (rth.length === 0) throw new Error("webull: no RTH bars for symbol");
  const candles: Candle[] = rth
    .map((b) => ({
      t: Math.floor(Date.parse(b.time) / 1000),
      o: Number(b.open), h: Number(b.high), l: Number(b.low), c: Number(b.close), v: Number(b.volume) || 0,
    }))
    .sort((a, b) => a.t - b.t);
  return { symbol, range, interval, provider: "webull", price: candles.at(-1)?.c, candles };
}

const CATEGORY = "US_STOCK";
const DATA_HOST = () => process.env.WEBULL_PAPER_BASE_URL || "https://th-api.uat.webullbroker.com";

/** Fetch candles from Webull. Throws on missing credentials, non-OK status,
 *  or an empty RTH bar set — callers fall back to Alpaca/Yahoo. */
export async function fetchWebullCandles(symbol: string, range: Range = "1mo", interval: Interval = "1h"): Promise<CandleResponse> {
  const appKey = process.env.WEBULL_PAPER_APP_KEY;
  const appSecret = process.env.WEBULL_PAPER_APP_SECRET;
  if (!appKey || !appSecret) {
    throw new Error("webull: missing WEBULL_PAPER_APP_KEY / WEBULL_PAPER_APP_SECRET");
  }
  const res = await signedFetch("/openapi/market-data/stock/bars", {
    baseUrl: DATA_HOST(),
    method: "GET",
    appKey,
    appSecret,
    params: {
      symbol,
      category: CATEGORY,
      timespan: intervalToWebullTimespan(interval),
      count: String(rangeToWebullCount(range, interval)),
    },
  });
  if (!res.ok) throw new Error(`webull upstream ${res.status}`);
  return parseWebullBars(await res.json(), symbol, range, interval);
}
