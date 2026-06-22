// Central market-data entry point. Prefers Alpaca when configured and falls
// back to Yahoo on any error (or immediately when no Alpaca key is set).

import { fetchAlpacaCandles, fetchAlpacaCandlesBatch } from "./alpaca";
import { fetchYahooCandles, type CandleResponse, type Range, type Interval } from "./yahoo";

/** Pure decision: try Alpaca only when both credentials are present. */
export function shouldTryAlpaca(env: { ALPACA_KEY?: string; ALPACA_SECRET?: string }): boolean {
  return Boolean(env.ALPACA_KEY && env.ALPACA_SECRET);
}

/**
 * Fetch candles from the best available provider. Alpaca first when
 * configured; Yahoo as the fallback (and the only provider when no key is set).
 */
export async function fetchCandles(
  symbol: string,
  range: Range = "1mo",
  interval: Interval = "1h",
): Promise<CandleResponse> {
  const env = {
    ALPACA_KEY: process.env.ALPACA_KEY,
    ALPACA_SECRET: process.env.ALPACA_SECRET,
  };
  if (shouldTryAlpaca(env)) {
    try {
      return await fetchAlpacaCandles(symbol, range, interval);
    } catch (e) {
      // Expected for non-equity symbols (futures/crypto/forex) Alpaca's stock feed
      // doesn't serve — fall back to Yahoo. Log one concise line, not a stack.
      console.warn(`marketData: Alpaca miss for ${symbol} (${e instanceof Error ? e.message : e}); using Yahoo`);
    }
  }
  return fetchYahooCandles(symbol, range, interval);
}

/**
 * Fetch candles for many symbols at once. Uses Alpaca's batch endpoint (one or a
 * few requests for the whole list) when configured, then fills any symbol Alpaca
 * didn't return (non-equities, errors) individually via Yahoo. Returns a map;
 * unfetchable symbols are omitted.
 */
export async function fetchCandlesBatch(
  symbols: string[],
  range: Range = "1mo",
  interval: Interval = "1d",
): Promise<Map<string, CandleResponse>> {
  const env = { ALPACA_KEY: process.env.ALPACA_KEY, ALPACA_SECRET: process.env.ALPACA_SECRET };
  const out = new Map<string, CandleResponse>();

  if (shouldTryAlpaca(env)) {
    try {
      for (const [sym, resp] of await fetchAlpacaCandlesBatch(symbols, range, interval)) out.set(sym, resp);
    } catch (e) {
      console.warn(`marketData: Alpaca batch failed (${e instanceof Error ? e.message : e}); using Yahoo per-symbol`);
    }
  }

  // Fill whatever Alpaca didn't return (non-equities, gaps) one at a time via Yahoo.
  for (const sym of symbols) {
    if (out.has(sym)) continue;
    try { out.set(sym, await fetchYahooCandles(sym, range, interval)); } catch { /* skip */ }
  }
  return out;
}
