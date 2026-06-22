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

const ALPACA_DATA_BASE = "https://data.alpaca.markets/v2/stocks";

const toCandle = (b: AlpacaBar): Candle => ({
  t: Math.floor(Date.parse(b.t) / 1000), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0,
});

/** Pure transform of a multi-symbol bars response ({ bars: { SYM: [...] } }) into
 *  a per-symbol CandleResponse map. Symbols with no bars are omitted. */
export function parseAlpacaBatch(
  json: unknown,
  range: Range,
  interval: Interval,
): Map<string, CandleResponse> {
  const bySym = (json as { bars?: Record<string, AlpacaBar[]> })?.bars ?? {};
  const out = new Map<string, CandleResponse>();
  for (const [symbol, bars] of Object.entries(bySym)) {
    if (!bars || bars.length === 0) continue;
    const candles = bars.map(toCandle);
    out.set(symbol, { symbol, range, interval, price: candles.at(-1)?.c, candles });
  }
  return out;
}

/**
 * Fetch candles from Alpaca's IEX (free) feed. Throws when no key is set, on a
 * non-OK response, or when the body has no bars — callers fall back to Yahoo.
 */
export async function fetchAlpacaCandles(
  symbol: string,
  range: Range = "1mo",
  interval: Interval = "1h",
): Promise<CandleResponse> {
  const key = process.env.ALPACA_KEY;
  const secret = process.env.ALPACA_SECRET;
  if (!key || !secret) {
    throw new Error("alpaca: missing ALPACA_KEY / ALPACA_SECRET");
  }

  const start = new Date(Date.now() - rangeToLookbackMs(range)).toISOString();
  const end = new Date().toISOString();
  const params = new URLSearchParams({
    timeframe: intervalToTimeframe(interval),
    start,
    end,
    feed: "iex",
    limit: "10000",
    sort: "asc",
  });
  const url = `${ALPACA_DATA_BASE}/${encodeURIComponent(symbol)}/bars?${params}`;

  const res = await fetch(url, {
    headers: {
      "APCA-API-KEY-ID": key,
      "APCA-API-SECRET-KEY": secret,
      Accept: "application/json",
    },
    // Match the Yahoo fetcher's short cache window to bound request volume.
    next: { revalidate: 30 },
  });

  if (!res.ok) {
    throw new Error(`alpaca upstream ${res.status}`);
  }

  const json = await res.json();
  return parseAlpacaBars(json, symbol, range, interval);
}

/**
 * Fetch candles for many symbols in one (paginated) request — Alpaca's
 * multi-symbol bars endpoint. Returns a per-symbol CandleResponse map; symbols
 * with no data are simply absent. Throws when no key is set (caller falls back).
 */
export async function fetchAlpacaCandlesBatch(
  symbols: string[],
  range: Range = "1mo",
  interval: Interval = "1d",
): Promise<Map<string, CandleResponse>> {
  const key = process.env.ALPACA_KEY;
  const secret = process.env.ALPACA_SECRET;
  if (!key || !secret) throw new Error("alpaca: missing ALPACA_KEY / ALPACA_SECRET");
  if (symbols.length === 0) return new Map();

  const start = new Date(Date.now() - rangeToLookbackMs(range)).toISOString();
  const end = new Date().toISOString();
  const headers = { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret, Accept: "application/json" };

  // Accumulate bars per symbol across pages.
  const merged: Record<string, AlpacaBar[]> = {};
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      symbols: symbols.join(","),
      timeframe: intervalToTimeframe(interval),
      start, end, feed: "iex", limit: "10000", sort: "asc",
    });
    if (pageToken) params.set("page_token", pageToken);
    const res = await fetch(`${ALPACA_DATA_BASE}/bars?${params}`, { headers, next: { revalidate: 30 } });
    if (!res.ok) throw new Error(`alpaca batch upstream ${res.status}`);
    const json = (await res.json()) as { bars?: Record<string, AlpacaBar[]>; next_page_token?: string | null };
    for (const [sym, bars] of Object.entries(json.bars ?? {})) {
      (merged[sym] ??= []).push(...(bars ?? []));
    }
    pageToken = json.next_page_token ?? undefined;
  } while (pageToken);

  return parseAlpacaBatch({ bars: merged }, range, interval);
}
