// Webull market-data provider — same CandleResponse shape as alpaca.ts/
// yahoo.ts so the router is provider-agnostic. Data-only by decision: orders
// stay manual, and nothing here touches /openapi/trade/*.
//
// Signs against PRODUCTION (WEBULL_BASE_URL + WEBULL_APP_KEY/SECRET) with an
// x-access-token from webull/webullToken.ts.
//
// It used to sign against the sandbox/UAT host instead, on the grounds that
// production's token needs a tap in the Webull mobile app "per session" and so
// could not suit an unattended fetch path. Measured 2026-08-30, that premise
// was wrong: a token lives 15 days and refreshes without a second approval, so
// one human tap seeds it and webullToken.ts rolls it forward from there.
//
// Staying on sandbox was not the safe option it looked like. Its bars are a
// partially refreshed fixture set: of 50 large caps, 15 came back stale — nine
// frozen at 2026-07-15, and PM/CSX/HON/LOW/AXP frozen since 2024-09..2025-01 —
// with price errors from 1.3% to 39.8% (RTX 127.50 against a real 211.71).
// None of them threw, and all of them passed coversDays, because that measures
// span and not recency. Production returned the correct close for every one.
//
// Why there is still no order path here: /openapi/trade/* does exist on
// production and a NORMAL token may well satisfy it, but that is untested and
// deliberately out of scope. A shadow paper-trade path used to live in
// webull/paperTrade.ts + webull/symbols.ts; it never placed a single order
// because it targeted Webull's legacy app API (/api/paper/order/*,
// /api/openapi/quote/symbol-search), which does not exist on the OpenAPI
// gateway at all. It was removed rather than ported.
//
// Note for any future port: a symbol-search call is not needed — the bars
// response already carries tickerId/instrument_id on every row.
import type { Candle } from "./indicators";
import type { CandleResponse, Range, Interval } from "./yahoo";
import { signedFetch } from "./webull/auth";
import { getWebullAccessToken } from "./webull/webullToken";

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
 *  bars-per-day model as mt5.ts's rangeToBarCount, capped at 1200.
 *
 *  Re-verified against PRODUCTION on 2026-08-31, since the original number came
 *  from the sandbox host and sandbox serves fixture data: 1200 returns 200, and
 *  1201 returns `417 ILLEGAL_PARAMETER "The count ranges is 1 to 1200."`. The
 *  cap is real, but 417 alone does not identify it — see webullUpstreamError. */
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
const DATA_HOST = () => process.env.WEBULL_BASE_URL || "https://api.webull.co.th";

/**
 * Turn a non-OK Webull response into an error a log line can be read from.
 *
 * The status alone is not enough, because 417 is overloaded. Verified against
 * production on 2026-08-31:
 *
 *   417 INVALID_SYMBOL     "The symbol does not exist in the category."
 *   417 ILLEGAL_PARAMETER  "The count ranges is 1 to 1200."
 *
 * Those are opposite situations — a delisted ticker we should stop asking for,
 * versus a request we built wrong — and `webull upstream 417` was the whole of
 * what the router logged for either. That cost a wrong diagnosis: EA and DFS
 * (both delisted) 417'd during a weekly sweep and the provider chain was read as
 * globally broken, while CSX, MO, KO and AZO were answering 200 throughout.
 *
 * Never throws. It runs on the failure path, where a second error thrown while
 * describing the first is how the first one disappears.
 */
export function webullUpstreamError(status: number, body: string): string {
  const base = `webull upstream ${status}`;
  const text = body.trim();
  if (!text) return base;
  let detail = text;
  try {
    const j = JSON.parse(text) as { error_code?: unknown; message?: unknown };
    const parts = [j.error_code, j.message].filter((x) => typeof x === "string" && x);
    if (parts.length) detail = parts.join(": ");
  } catch {
    // Not JSON — an HTML error page or a gateway blob. Report it as-is; the
    // truncation below is what keeps it to one line.
  }
  return `${base} ${detail.slice(0, 200)}`;
}

/** Fetch candles from Webull. Throws on missing credentials, an unavailable
 *  access token, non-OK status, or an empty RTH bar set — callers fall back to
 *  Yahoo (and reach this only after Alpaca has missed; see providerOrder in
 *  marketData.ts). */
export async function fetchWebullCandles(symbol: string, range: Range = "1mo", interval: Interval = "1h"): Promise<CandleResponse> {
  const appKey = process.env.WEBULL_APP_KEY;
  const appSecret = process.env.WEBULL_APP_SECRET;
  if (!appKey || !appSecret) {
    throw new Error("webull: missing WEBULL_APP_KEY / WEBULL_APP_SECRET");
  }
  const res = await signedFetch("/openapi/market-data/stock/bars", {
    baseUrl: DATA_HOST(),
    method: "GET",
    appKey,
    appSecret,
    accessToken: await getWebullAccessToken(),
    params: {
      symbol,
      category: CATEGORY,
      timespan: intervalToWebullTimespan(interval),
      count: String(rangeToWebullCount(range, interval)),
    },
  });
  if (!res.ok) throw new Error(webullUpstreamError(res.status, await res.text().catch(() => "")));
  return parseWebullBars(await res.json(), symbol, range, interval);
}
