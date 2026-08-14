// Central market-data entry point. For MT5-bridge symbols (spot gold/silver,
// forex crosses), tries the local MT5 terminal first since it's the only
// provider with real spot XAUUSD/forex data; falls back to Alpaca (equities)
// then Yahoo on any error (or immediately when a provider isn't configured).

import { fetchAlpacaCandles, fetchAlpacaCandlesBatch } from "./alpaca";
import { fetchMt5Candles } from "./mt5";
import { fetchWebullCandles } from "./webull";
import { fetchYahooCandles, type CandleResponse, type Range, type Interval } from "./yahoo";

/** Pure decision: try Alpaca only when both credentials are present. */
export function shouldTryAlpaca(env: { ALPACA_KEY?: string; ALPACA_SECRET?: string }): boolean {
  return Boolean(env.ALPACA_KEY && env.ALPACA_SECRET);
}

/** Pure decision: try Webull only when both credentials are present. */
export function shouldTryWebull(env: { WEBULL_APP_KEY?: string; WEBULL_APP_SECRET?: string }): boolean {
  return Boolean(env.WEBULL_APP_KEY && env.WEBULL_APP_SECRET);
}

// Symbols the MT5 bridge should be tried for — spot gold/silver plus any
// 6-letter forex cross (EURUSD, GBPJPY, ...). Alpaca's stock feed and Yahoo
// don't carry real spot rates for these. Watchlists store the bare MT5 ticker
// directly ("XAUUSD", "EURUSD") — the Yahoo-style forms below are kept only
// as a defensive alias in case one is typed/imported by hand.
// Extend via MT5_SYMBOLS (comma list) for broker-specific bare tickers (e.g.
// a suffixed "XAUUSDM").
const MT5_DEFAULT_SYMBOLS = new Set(["XAUUSD", "XAGUSD"]);
const FOREX_PATTERN = /^[A-Z]{6}$/;
const YAHOO_FOREX_PATTERN = /^([A-Z]{6})=X$/;
const YAHOO_FUTURES_TO_MT5: Record<string, string> = { "GC=F": "XAUUSD", "SI=F": "XAGUSD" };

/** Pure decision: resolve `symbol` to the MT5 ticker to query, or null if MT5 doesn't apply. */
export function toMt5Ticker(symbol: string, extra: string[] = []): string | null {
  const s = symbol.toUpperCase();
  if (YAHOO_FUTURES_TO_MT5[s]) return YAHOO_FUTURES_TO_MT5[s];
  const forexAlias = s.match(YAHOO_FOREX_PATTERN);
  if (forexAlias) return forexAlias[1];
  if (MT5_DEFAULT_SYMBOLS.has(s) || FOREX_PATTERN.test(s) || extra.includes(s)) return s;
  return null;
}

/** Pure decision: should `symbol` be tried against the local MT5 bridge first? */
export function isMt5Symbol(symbol: string, extra: string[] = []): boolean {
  return toMt5Ticker(symbol, extra) !== null;
}

// Reverse of the above, for the Alpaca/Yahoo fallback when MT5 is unreachable:
// neither provider knows a bare "XAUUSD"/"EURUSD" ticker, so translate back to
// the form they *do* understand. Gold/silver fall back to Yahoo's continuous
// futures contract (GC=F/SI=F) rather than "XAUUSD=X" — oanda.ts's cross-check
// found Yahoo's synthetic spot-forex gold feed diverges from real spot during
// volatile moves, while the futures feed tracks it closely.
const MT5_TO_YAHOO_FUTURES: Record<string, string> = { XAUUSD: "GC=F", XAGUSD: "SI=F" };

/** Pure decision: ticker to use for the Alpaca/Yahoo fallback, given the MT5 ticker (if any) tried first. */
export function toFallbackTicker(symbol: string, mt5Ticker: string | null): string {
  if (!mt5Ticker) return symbol;
  if (MT5_TO_YAHOO_FUTURES[mt5Ticker]) return MT5_TO_YAHOO_FUTURES[mt5Ticker];
  if (FOREX_PATTERN.test(mt5Ticker)) return `${mt5Ticker}=X`;
  return symbol;
}

function mt5ExtraSymbols(): string[] {
  return (process.env.MT5_SYMBOLS ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

/** Retry an async fetch once on a transient failure (network blip / 5xx). */
async function withRetry<T>(fn: () => Promise<T>, attempts = 2, delayMs = 400): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

/**
 * Fetch candles from the best available provider. Alpaca first when
 * configured; Yahoo as the fallback (and the only provider when no key is set).
 * The Yahoo path is retried once so a transient "fetch failed" network blip
 * doesn't fail the whole scan tick.
 */
export async function fetchCandles(
  symbol: string,
  range: Range = "1mo",
  interval: Interval = "1h",
): Promise<CandleResponse> {
  const mt5Ticker = toMt5Ticker(symbol, mt5ExtraSymbols());
  if (mt5Ticker && process.env.MT5_BRIDGE_SECRET) {
    try {
      const resp = await fetchMt5Candles(mt5Ticker, range, interval);
      // Preserve the caller's original symbol so downstream code that matches
      // by watchlist symbol string is unaffected by the MT5 round-trip.
      return { ...resp, symbol };
    } catch (e) {
      console.warn(`marketData: MT5 miss for ${symbol} (${e instanceof Error ? e.message : e}); using Alpaca/Yahoo`);
    }
  }

  // Neither Alpaca nor Yahoo knows a bare MT5 ticker ("XAUUSD") — translate to
  // the equivalent they do (GC=F / EURUSD=X) so the fallback still works when
  // the bridge is down or MT5_BRIDGE_SECRET isn't configured on this machine.
  const fallbackTicker = toFallbackTicker(symbol, mt5Ticker);

  const webullEnv = { WEBULL_APP_KEY: process.env.WEBULL_APP_KEY, WEBULL_APP_SECRET: process.env.WEBULL_APP_SECRET };
  if (shouldTryWebull(webullEnv)) {
    try {
      return await fetchWebullCandles(fallbackTicker, range, interval);
    } catch (e) {
      console.warn(`marketData: Webull miss for ${symbol} (${e instanceof Error ? e.message : e}); using Alpaca/Yahoo`);
    }
  }

  const env = {
    ALPACA_KEY: process.env.ALPACA_KEY,
    ALPACA_SECRET: process.env.ALPACA_SECRET,
  };
  if (shouldTryAlpaca(env)) {
    try {
      return await fetchAlpacaCandles(fallbackTicker, range, interval);
    } catch (e) {
      // Expected for non-equity symbols (futures/crypto/forex) Alpaca's stock feed
      // doesn't serve — fall back to Yahoo. Log one concise line, not a stack.
      console.warn(`marketData: Alpaca miss for ${symbol} (${e instanceof Error ? e.message : e}); using Yahoo`);
    }
  }
  const yahooResp = await withRetry(() => fetchYahooCandles(fallbackTicker, range, interval));
  return { ...yahooResp, symbol };
}

/** Runs `fn` over `items` with at most `limit` concurrent in-flight calls.
 *  A failed item resolves to undefined rather than rejecting the whole pool. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<(R | undefined)[]> {
  const results: (R | undefined)[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try { results[i] = await fn(items[i]); } catch { results[i] = undefined; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const WEBULL_BATCH_CONCURRENCY = 8;

/**
 * Fetch candles for many symbols at once. Tries Webull (concurrency-limited,
 * since it has no batch endpoint) when configured, then Alpaca's batch
 * endpoint for whatever's left, then fills any symbol neither returned
 * (non-equities, errors) individually via Yahoo. Returns a map; unfetchable
 * symbols are omitted.
 */
export async function fetchCandlesBatch(
  symbols: string[],
  range: Range = "1mo",
  interval: Interval = "1d",
): Promise<Map<string, CandleResponse>> {
  const out = new Map<string, CandleResponse>();

  const webullEnv = { WEBULL_APP_KEY: process.env.WEBULL_APP_KEY, WEBULL_APP_SECRET: process.env.WEBULL_APP_SECRET };
  if (shouldTryWebull(webullEnv)) {
    const fetched = await mapWithConcurrency(symbols, WEBULL_BATCH_CONCURRENCY, (sym) => fetchWebullCandles(sym, range, interval));
    fetched.forEach((resp, i) => { if (resp) out.set(symbols[i], resp); });
  }

  const env = { ALPACA_KEY: process.env.ALPACA_KEY, ALPACA_SECRET: process.env.ALPACA_SECRET };
  if (shouldTryAlpaca(env)) {
    try {
      const remaining = symbols.filter((s) => !out.has(s));
      for (const [sym, resp] of await fetchAlpacaCandlesBatch(remaining, range, interval)) out.set(sym, resp);
    } catch (e) {
      console.warn(`marketData: Alpaca batch failed (${e instanceof Error ? e.message : e}); using Yahoo per-symbol`);
    }
  }

  // Fill whatever Webull/Alpaca didn't return (non-equities, gaps) one at a time via Yahoo.
  for (const sym of symbols) {
    if (out.has(sym)) continue;
    try { out.set(sym, await fetchYahooCandles(sym, range, interval)); } catch { /* skip */ }
  }
  return out;
}
