// Central market-data entry point. Prefers Alpaca when configured and falls
// back to Yahoo on any error (or immediately when no Alpaca key is set).

import { fetchAlpacaCandles } from "./alpaca";
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
