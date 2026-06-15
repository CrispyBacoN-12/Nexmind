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
      console.error(`marketData: Alpaca failed for ${symbol}, falling back to Yahoo —`, e);
    }
  }
  return fetchYahooCandles(symbol, range, interval);
}
