// Central market-data entry point. Tries Webull first when configured, then
// Alpaca, then falls back to Yahoo on any error (or immediately when a
// provider isn't configured).

import { fetchAlpacaCandles, fetchAlpacaCandlesBatch } from "./alpaca";
import { fetchWebullCandles } from "./webull";
import { fetchYahooCandles, type CandleResponse, type Range, type Interval } from "./yahoo";

/** Pure decision: try Alpaca only when both credentials are present. */
export function shouldTryAlpaca(env: { ALPACA_KEY?: string; ALPACA_SECRET?: string }): boolean {
  return Boolean(env.ALPACA_KEY && env.ALPACA_SECRET);
}

/** Pure decision: try Webull only when both credentials are present. Checks
 *  the sandbox (WEBULL_PAPER_*) pair, since that's what fetchWebullCandles
 *  actually signs with — see webull.ts for why. */
export function shouldTryWebull(env: { WEBULL_PAPER_APP_KEY?: string; WEBULL_PAPER_APP_SECRET?: string }): boolean {
  return Boolean(env.WEBULL_PAPER_APP_KEY && env.WEBULL_PAPER_APP_SECRET);
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
  const webullEnv = { WEBULL_PAPER_APP_KEY: process.env.WEBULL_PAPER_APP_KEY, WEBULL_PAPER_APP_SECRET: process.env.WEBULL_PAPER_APP_SECRET };
  if (shouldTryWebull(webullEnv)) {
    try {
      return await fetchWebullCandles(symbol, range, interval);
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
      return await fetchAlpacaCandles(symbol, range, interval);
    } catch (e) {
      // Expected for non-equity symbols (futures/crypto/forex) Alpaca's stock feed
      // doesn't serve — fall back to Yahoo. Log one concise line, not a stack.
      console.warn(`marketData: Alpaca miss for ${symbol} (${e instanceof Error ? e.message : e}); using Yahoo`);
    }
  }
  const yahooResp = await withRetry(() => fetchYahooCandles(symbol, range, interval));
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

  const webullEnv = { WEBULL_PAPER_APP_KEY: process.env.WEBULL_PAPER_APP_KEY, WEBULL_PAPER_APP_SECRET: process.env.WEBULL_PAPER_APP_SECRET };
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
