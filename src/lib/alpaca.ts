// Alpaca market-data provider. Returns the same CandleResponse shape as the
// Yahoo fetcher so the rest of the app is provider-agnostic. Data-only:
// this never touches Alpaca's order/account APIs.

import type { Candle } from "./indicators";
import type { CandleResponse, Range, Interval } from "./yahoo";

const DAY_MS = 86_400_000;

/** Map our Interval to an Alpaca v2 timeframe string. */
export function intervalToTimeframe(interval: Interval): string {
  switch (interval) {
    case "1m": return "1Min";
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
    provider: "alpaca",
    price: candles.at(-1)?.c,
    candles,
  };
}

const ALPACA_DATA_BASE = "https://data.alpaca.markets/v2/stocks";

/**
 * Alpaca defaults to `adjustment=raw`, which reports prices exactly as they
 * traded — so a 20:1 split shows up as a -95% overnight return and any lookback
 * spanning it is nonsense. `all` applies both split and dividend adjustment,
 * giving the same total-return series as Yahoo's adjclose. Backtests need this;
 * so does anything measuring a return over more than a few weeks.
 */
const ADJUSTMENT = "all";

/**
 * `iex` returns only trades that crossed the IEX exchange — a few percent of
 * volume — so its history is full of holes: AAPL's IEX daily bars start
 * 2020-07-27, and MPWR has a single 100-share print in Jan 2019 and then nothing
 * until that same date. Any return measured across a hole spans months, not a
 * day, which is how a 127% "one-day move" appears in a clean-looking cache.
 * `sip` is the consolidated tape: every symbol probed returns an identical
 * 1,914-bar history from 2019-01-02 with no gaps.
 *
 * Set ALPACA_FEED to override (e.g. back to `iex` on a key without SIP
 * entitlement). There is deliberately no silent per-request downgrade: a
 * fallback to `iex` would quietly restore the gapped data that this default
 * exists to avoid. A key lacking SIP gets a hard upstream error, and
 * marketData's router backfills from Yahoo with a warning.
 */
const feed = () => process.env.ALPACA_FEED ?? "sip";

/**
 * On the free plan Alpaca refuses SIP data newer than ~15 minutes, and it
 * refuses the WHOLE request when `end` reaches into that window —
 * `403 subscription does not permit querying recent SIP data` — so asking for
 * `end = now` returns nothing at all rather than a truncated series. Hold `end`
 * back past the boundary. The cost is that the newest bar can be up to 16
 * minutes stale; a caller that needs real-time prices should set
 * ALPACA_FEED=iex and accept the gappy history that comes with it.
 */
const SIP_DELAY_MS = 16 * 60_000;
const endTime = () =>
  new Date(Date.now() - (feed() === "sip" ? SIP_DELAY_MS : 0)).toISOString();

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
    out.set(symbol, { symbol, range, interval, provider: "alpaca", price: candles.at(-1)?.c, candles });
  }
  return out;
}

/**
 * Fetch candles from Alpaca (see `feed` above for which tape). Throws when no
 * key is set, on a non-OK response, or when the body has no bars — callers fall
 * back to Yahoo.
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
  const end = endTime();
  const headers = {
    "APCA-API-KEY-ID": key,
    "APCA-API-SECRET-KEY": secret,
    Accept: "application/json",
  };

  // Alpaca caps each page at `limit` bars and returns a next_page_token when
  // more remain. Follow the token to the end so long ranges (multi-year 1h)
  // come back complete instead of truncated at the first page.
  const allBars: AlpacaBar[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      timeframe: intervalToTimeframe(interval),
      start,
      end,
      feed: feed(),
      limit: "10000",
      sort: "asc",
      adjustment: ADJUSTMENT,
    });
    if (pageToken) params.set("page_token", pageToken);
    const url = `${ALPACA_DATA_BASE}/${encodeURIComponent(symbol)}/bars?${params}`;

    const res = await fetch(url, {
      headers,
      // Match the Yahoo fetcher's short cache window to bound request volume.
      next: { revalidate: 30 },
    });
    if (!res.ok) {
      throw new Error(`alpaca upstream ${res.status}`);
    }
    const json = (await res.json()) as { bars?: AlpacaBar[]; next_page_token?: string | null };
    if (json.bars) allBars.push(...json.bars);
    pageToken = json.next_page_token ?? undefined;
  } while (pageToken);

  return parseAlpacaBars({ bars: allBars }, symbol, range, interval);
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
  const end = endTime();
  const headers = { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret, Accept: "application/json" };
  const CHUNK = 100; // Alpaca rejects very long symbol lists — chunk the request.

  const merged: Record<string, AlpacaBar[]> = {};
  for (let i = 0; i < symbols.length; i += CHUNK) {
    const chunk = symbols.slice(i, i + CHUNK);
    // Retry once on a transient failure (network/5xx); a 4xx is a bad symbol so
    // retrying won't help — skip and let the router backfill from Yahoo.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const chunkBars: Record<string, AlpacaBar[]> = {};
      try {
        let pageToken: string | undefined;
        do {
          const params = new URLSearchParams({
            symbols: chunk.join(","),
            timeframe: intervalToTimeframe(interval),
            start, end, feed: feed(), limit: "10000", sort: "asc",
            adjustment: ADJUSTMENT,
          });
          if (pageToken) params.set("page_token", pageToken);
          const res = await fetch(`${ALPACA_DATA_BASE}/bars?${params}`, { headers, next: { revalidate: 30 } });
          if (!res.ok) throw new Error(`alpaca batch upstream ${res.status}`);
          const json = (await res.json()) as { bars?: Record<string, AlpacaBar[]>; next_page_token?: string | null };
          for (const [sym, bars] of Object.entries(json.bars ?? {})) (chunkBars[sym] ??= []).push(...(bars ?? []));
          pageToken = json.next_page_token ?? undefined;
        } while (pageToken);
        for (const [sym, bars] of Object.entries(chunkBars)) (merged[sym] ??= []).push(...bars);
        break; // chunk done
      } catch (e) {
        const is4xx = e instanceof Error && /upstream 4\d\d/.test(e.message);
        if (attempt === 2 || is4xx) {
          console.warn(`alpaca batch: chunk ${i / CHUNK} failed (${e instanceof Error ? e.message : e}); those symbols fall back to Yahoo`);
          break;
        }
        await new Promise((r) => setTimeout(r, 500)); // brief pause before retry
      }
    }
  }

  return parseAlpacaBatch({ bars: merged }, range, interval);
}
