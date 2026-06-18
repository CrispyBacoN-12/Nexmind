// Shared Yahoo Finance candle fetcher (free, unauthenticated chart endpoint).
// Extended from stock-tracker with intraday intervals for the Scanner loop.

import type { Candle } from "./indicators";

export const ALLOWED_RANGES = [
  "1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "max",
] as const;
export const ALLOWED_INTERVALS = [
  "5m", "15m", "30m", "60m", "1h", "1d", "1wk",
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

export async function fetchYahooCandles(
  symbol: string,
  range: Range = "1mo",
  interval: Interval = "1h",
): Promise<CandleResponse> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?interval=${interval}&range=${range}`;

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

  const json = await res.json();
  const result = json?.chart?.result?.[0];
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

  const candles: Candle[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (c == null) continue;
    candles.push({
      t: timestamps[i],
      o: opens[i] ?? c,
      h: highs[i] ?? c,
      l: lows[i] ?? c,
      c,
      v: volumes[i] ?? 0,
    });
  }

  return {
    symbol,
    range,
    interval,
    currency: result.meta?.currency,
    exchangeName: result.meta?.exchangeName,
    price: result.meta?.regularMarketPrice ?? candles.at(-1)?.c,
    candles,
  };
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
