// Shared Yahoo Finance candle fetcher (free, unauthenticated chart endpoint).
// Extended from stock-tracker with intraday intervals for the Scanner loop.

import type { Candle } from "./indicators";

export const ALLOWED_RANGES = [
  "1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "max",
] as const;
export const ALLOWED_INTERVALS = [
  "1m", "5m", "15m", "30m", "60m", "1h", "1d", "1wk",
] as const;
export type Range = (typeof ALLOWED_RANGES)[number];
export type Interval = (typeof ALLOWED_INTERVALS)[number];

export interface CandleResponse {
  symbol: string;
  range: Range;
  interval: Interval;
  currency?: string;
  exchangeName?: string;
  price?: number;
  candles: Candle[];
}

interface YahooChartResult {
  timestamp?: number[];
  meta?: { currency?: string; exchangeName?: string; regularMarketPrice?: number };
  indicators?: {
    quote?: {
      open?: (number | null)[];
      high?: (number | null)[];
      low?: (number | null)[];
      close?: (number | null)[];
      volume?: (number | null)[];
    }[];
    adjclose?: { adjclose?: (number | null)[] }[];
  };
}

/**
 * Turn a raw `/v8/finance/chart` payload into split- and dividend-adjusted
 * candles. Split out from the fetch so the adjustment is testable without a
 * network call, mirroring `parseAlpacaBars`.
 */
export function parseYahooChart(
  json: unknown,
  symbol: string,
  range: Range,
  interval: Interval,
): CandleResponse {
  const result = (json as { chart?: { result?: YahooChartResult[] } })?.chart?.result?.[0];
  if (!result) {
    throw new Error("no data for symbol");
  }

  const timestamps: number[] = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};
  const opens: (number | null)[] = q.open ?? [];
  const highs: (number | null)[] = q.high ?? [];
  const lows: (number | null)[] = q.low ?? [];
  const closes: (number | null)[] = q.close ?? [];
  const volumes: (number | null)[] = q.volume ?? [];
  // The `quote` arrays above are RAW prices. Across a split they jump by the split
  // ratio, so a 20:1 split reads as a -95% one-day return and a lookback window
  // spanning it reports a catastrophic loss for a stock that in fact went up.
  // `adjclose` is the same close series corrected for splits and dividends, so
  // adjclose/close is exactly the factor that maps raw to adjusted. Applying it to
  // every OHLC field back-adjusts the whole series, and at the most recent bar the
  // factor is 1 — live and recent prices are untouched.
  const adjCloses: (number | null)[] = result.indicators?.adjclose?.[0]?.adjclose ?? [];

  const candles: Candle[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (c == null) continue;
    // Intraday intervals carry no adjclose; factor 1 leaves those bars as-is.
    const adj = adjCloses[i];
    const f = adj != null && c !== 0 ? adj / c : 1;
    candles.push({
      t: timestamps[i],
      o: (opens[i] ?? c) * f,
      h: (highs[i] ?? c) * f,
      l: (lows[i] ?? c) * f,
      c: c * f,
      // A split multiplies share count by the same amount it divides the price by,
      // so dividing volume by the factor keeps price * volume the real dollar
      // volume. The factor also carries dividend adjustment, which does not change
      // share count — that leaves a small drift, immaterial to volume's only
      // consumer here (a top-N liquidity ranking) and orders of magnitude smaller
      // than the split error it removes.
      v: f === 0 ? 0 : Math.round((volumes[i] ?? 0) / f),
    });
  }

  return {
    symbol,
    range,
    interval,
    currency: result.meta?.currency,
    exchangeName: result.meta?.exchangeName,
    // The live quote is a real, present-day price and is never adjusted.
    price: result.meta?.regularMarketPrice ?? candles.at(-1)?.c,
    candles,
  };
}

export async function fetchYahooCandles(
  symbol: string,
  range: Range = "1mo",
  interval: Interval = "1h",
): Promise<CandleResponse> {
  // includeAdjustedClose is what makes the split correction below possible; without
  // it Yahoo returns raw prices only. Daily and weekly bars carry it, intraday ones
  // do not.
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?interval=${interval}&range=${range}&includeAdjustedClose=true`;

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Accept: "application/json",
    },
    // Scanner needs fresh data; keep a short cache window.
    next: { revalidate: 30 },
  });

  if (!res.ok) {
    throw new Error(`yahoo upstream ${res.status}`);
  }

  return parseYahooChart(await res.json(), symbol, range, interval);
}

/**
 * Like fetchYahooCandles, but if a bare ticker isn't found, retry with the Thai
 * ".BK" suffix (so a user can type "JMART" instead of "JMART.BK"). The returned
 * `symbol` reflects whatever actually resolved.
 */
export async function fetchYahooCandlesSmart(
  symbol: string,
  range: Range = "1mo",
  interval: Interval = "1h",
): Promise<CandleResponse> {
  try {
    return await fetchYahooCandles(symbol, range, interval);
  } catch (e) {
    // Only retry plain alphabetic tickers (no suffix/operator chars) → try SET.
    if (/^[A-Za-z][A-Za-z0-9]{0,5}$/.test(symbol)) {
      try {
        return await fetchYahooCandles(`${symbol}.BK`, range, interval);
      } catch {
        /* fall through to original error */
      }
    }
    throw e;
  }
}
