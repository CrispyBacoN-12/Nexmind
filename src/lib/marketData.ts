// Central market-data entry point. Tries Alpaca first when configured, then
// Webull, then falls back to Yahoo on any error (or immediately when a
// provider isn't configured). Every response is run through sanitizeResponse
// before a caller sees it.
//
// Alpaca leads because the order was measured, not assumed — see providerOrder.

import { fetchAlpacaCandles, fetchAlpacaCandlesBatch } from "./alpaca";
import { fetchWebullCandles } from "./webull";
import { fetchYahooCandles, type CandleResponse, type Range, type Interval } from "./yahoo";
import { sanitizeSeries } from "./bars";

/** Pure decision: try Alpaca only when both credentials are present. */
export function shouldTryAlpaca(env: { ALPACA_KEY?: string; ALPACA_SECRET?: string }): boolean {
  return Boolean(env.ALPACA_KEY && env.ALPACA_SECRET);
}

/** Pure decision: try Webull only when both credentials are present. Checks
 *  the production (WEBULL_APP_*) pair, since that is what fetchWebullCandles
 *  signs with — see webull.ts for why the sandbox pair is no longer used. The
 *  access token is not checked here: it is fetched (and refreshed) per call,
 *  and its absence surfaces as an ordinary provider miss. */
export function shouldTryWebull(env: { WEBULL_APP_KEY?: string; WEBULL_APP_SECRET?: string }): boolean {
  return Boolean(env.WEBULL_APP_KEY && env.WEBULL_APP_SECRET);
}

export type Provider = "alpaca" | "webull" | "yahoo";

/**
 * Pure: which providers to try, in order. Yahoo is always last and always
 * present — it needs no credentials and is the floor the chain rests on.
 *
 * WHY ALPACA LEADS, AND WHY THIS IS NOT A PREFERENCE
 *
 * Webull used to be first. It never threw, so Alpaca was never reached, and
 * what it returned was wrong. Measured 2026-08-30 against Alpaca on the same
 * symbols and the same dates (Alpaca and Yahoo agree with each other to the
 * cent):
 *
 *   closes differing by >1% on the 2y daily overlap
 *     SPY   462/465  99.4%      AAPL  433/500  86.6%
 *     KO    355/498  71.3%      NVDA  283/488  58.0%      MSFT  127/439  28.9%
 *
 * SPY is not a mis-adjustment, it is a splice: real SPY until 2021-12-22, then a
 * different instrument in the $16-33 band for 84% of the series, then real SPY
 * again from 2026-04-14 (x0.046 down, x20.27 back up). That series is what
 * disabled the market gate. Two of the desk's four open positions were worse
 * still — AZO's "2y" pull is mostly 2019-2022 with a hole from 2022-07 to
 * 2026-06, and KMX simply ends at 2024-12, with no bar for the last 20 months.
 *
 * Every one of those numbers was measured against Webull's SANDBOX host, which
 * webull.ts pointed at until 2026-08-30. Sandbox serves a partially refreshed
 * fixture set, so the splices above are fixture artefacts, not Webull's real
 * prices; the production host, which webull.ts now signs against, matched
 * Alpaca to the cent on all 50 symbols that were re-tested. The order is left
 * as-is anyway: Alpaca is measured-good, first is the slot that matters, and
 * demoting the newly-fixed provider costs nothing while it proves itself.
 *
 * Webull is kept in the chain rather than deleted: it is the only provider here
 * that is also the broker, and the three guards downstream of this order —
 * sanitizeResponse, the staleness check below, and gateSlots' plausibility
 * check — catch the shapes that hurt. With Alpaca healthy it is never reached
 * for a US equity. If it should be removed outright, that is a decision to take
 * explicitly, not by leaving it first.
 */
export function providerOrder(env: {
  ALPACA_KEY?: string; ALPACA_SECRET?: string;
  WEBULL_APP_KEY?: string; WEBULL_APP_SECRET?: string;
}): Provider[] {
  const order: Provider[] = [];
  if (shouldTryAlpaca(env)) order.push("alpaca");
  if (shouldTryWebull(env)) order.push("webull");
  order.push("yahoo");
  return order;
}

/**
 * Pure: drop the bars no session actually traded, and re-quote from what is left.
 *
 * The research panel has dropped these since 2026-08-25 (lib/bars.ts); the live
 * path never got the same guard, which is where 5 of SAGE's 6 vetoes went — it
 * was rejecting setups over frozen prints in the weekly series rather than over
 * anything about the setup. A single 2y daily pull carries up to 181 of them.
 *
 * `price` is recomputed rather than carried over: if the last bar was a
 * placeholder, the response's quote was a price nobody traded at, and that quote
 * is what sizing and the facts sheet read.
 */
export function sanitizeResponse(resp: CandleResponse): CandleResponse {
  const { candles, dropped } = sanitizeSeries(resp.candles);
  if (!dropped) return resp;
  return { ...resp, candles, price: candles.at(-1)?.c };
}

/**
 * Pure: does a response cover at least `minDays` of calendar span?
 *
 * Providers truncate silently. Webull caps every request at 1200 bars
 * (`rangeToWebullCount`), so a 5y/1h request comes back a perfectly valid,
 * non-empty 256-day series with nothing to distinguish it from real data —
 * and the caller that asked for five years accepts it. A caller that needs
 * *depth* rather than just *bars* has to state that, or it silently validates
 * on a fraction of the history it asked for.
 */
export function coversDays(candles: { t: number }[], minDays: number): boolean {
  if (minDays <= 0) return true;
  if (!candles.length) return false;
  return (candles[candles.length - 1].t - candles[0].t) / 86400 >= minDays;
}

/**
 * Pure: how old the newest bar may be before the series is treated as frozen.
 *
 * coversDays measures *span* — last minus first. It cannot see a series that
 * simply stopped. That gap is not hypothetical: sandbox Webull returned 15 of
 * 50 large caps frozen 46 days back with 400+ days of span behind them, so
 * coversDays(700) passed and the desk priced RTX at 127.50 against a real
 * 211.71. Span and recency are different questions and both have to be asked.
 *
 * The thresholds are set to what a healthy provider can legitimately produce,
 * with room to spare, because the cost of a false positive is one fallback and
 * the cost of a false negative is trading on a fixture:
 *   - sub-weekly: a Friday close read on the Tuesday of a holiday week is 4
 *     days old; 6 leaves margin for a longer closure.
 *   - weekly: bars are stamped at the start of their week, so the newest
 *     legitimate one is already ~7 days old before the next prints; 16 covers
 *     that plus a holiday and still catches the 46-day case by a wide margin.
 */
export function maxBarAgeDays(interval: Interval): number {
  return interval === "1wk" ? 16 : 6;
}

/** Pure: has this series stopped updating? An empty series counts as stale —
 *  there is nothing recent in it either. */
export function isStale(candles: { t: number }[], interval: Interval, nowSec: number): boolean {
  const last = candles.at(-1);
  if (!last) return true;
  return (nowSec - last.t) / 86400 > maxBarAgeDays(interval);
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
 *
 * `minDays` makes a *truncated* provider response count as a miss rather than
 * a success, so the fallback chain is tried instead of silently returning less
 * history than was asked for. Yahoo is last, so its response is returned even
 * when short — a genuinely young listing has no deeper history anywhere, and
 * the caller can tell the difference by measuring the span itself.
 */
export async function fetchCandles(
  symbol: string,
  range: Range = "1mo",
  interval: Interval = "1h",
  minDays = 0,
): Promise<CandleResponse> {
  const order = providerOrder({
    ALPACA_KEY: process.env.ALPACA_KEY, ALPACA_SECRET: process.env.ALPACA_SECRET,
    WEBULL_APP_KEY: process.env.WEBULL_APP_KEY, WEBULL_APP_SECRET: process.env.WEBULL_APP_SECRET,
  });
  let lastErr: unknown;

  for (const [i, provider] of order.entries()) {
    const isLast = i === order.length - 1;
    try {
      const raw = provider === "alpaca" ? await fetchAlpacaCandles(symbol, range, interval)
        : provider === "webull" ? await fetchWebullCandles(symbol, range, interval)
        : await withRetry(() => fetchYahooCandles(symbol, range, interval));
      const resp = sanitizeResponse({ ...raw, symbol });
      // The last provider's answer is returned even when short: a genuinely
      // young listing has no deeper history anywhere, and the caller can tell
      // the difference by measuring the span itself.
      if (isLast) return resp;
      if (isStale(resp.candles, interval, Math.floor(Date.now() / 1000))) {
        const lastT = resp.candles.at(-1)?.t;
        const age = lastT ? ((Date.now() / 1000 - lastT) / 86400).toFixed(0) : "n/a";
        console.warn(`marketData: ${provider} returned a stale ${symbol} ${range}/${interval} (newest bar ${age}d old); trying ${order[i + 1]}`);
        continue;
      }
      if (coversDays(resp.candles, minDays)) return resp;
      console.warn(`marketData: ${provider} truncated ${symbol} ${range}/${interval} to ${resp.candles.length} bars (< ${minDays}d); trying ${order[i + 1]}`);
    } catch (e) {
      lastErr = e;
      if (isLast) break;
      // Expected for non-equity symbols (futures/crypto/forex) Alpaca's stock
      // feed doesn't serve. Log one concise line, not a stack.
      console.warn(`marketData: ${provider} miss for ${symbol} (${e instanceof Error ? e.message : e}); trying ${order[i + 1]}`);
    }
  }
  throw lastErr ?? new Error(`marketData: no provider returned ${symbol} ${range}/${interval}`);
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
 * Fetch candles for many symbols at once. Alpaca's batch endpoint first (one
 * request for the whole list), then Webull for whatever it did not return —
 * concurrency-limited, since Webull has no batch endpoint — then Yahoo one at a
 * time for anything neither answered (non-equities, errors). Returns a map;
 * unfetchable symbols are omitted.
 *
 * Same provider order and the same sanitising as fetchCandles, for the same
 * measured reason (providerOrder). This path takes no `minDays`, so a truncated
 * response is still accepted here — callers that need depth use fetchCandles.
 */
export async function fetchCandlesBatch(
  symbols: string[],
  range: Range = "1mo",
  interval: Interval = "1d",
): Promise<Map<string, CandleResponse>> {
  const out = new Map<string, CandleResponse>();
  const order = providerOrder({
    ALPACA_KEY: process.env.ALPACA_KEY, ALPACA_SECRET: process.env.ALPACA_SECRET,
    WEBULL_APP_KEY: process.env.WEBULL_APP_KEY, WEBULL_APP_SECRET: process.env.WEBULL_APP_SECRET,
  });

  // A frozen series is left unset so the next provider gets a turn — the same
  // rule fetchCandles applies, and the reason webull.ts no longer points at
  // sandbox. Yahoo is the floor and is accepted unconditionally below.
  const nowSec = Math.floor(Date.now() / 1000);
  const accept = (sym: string, resp: CandleResponse, provider: string) => {
    const clean = sanitizeResponse(resp);
    if (isStale(clean.candles, interval, nowSec)) {
      console.warn(`marketData: ${provider} returned a stale ${sym} ${range}/${interval}; leaving it to the next provider`);
      return;
    }
    out.set(sym, clean);
  };

  if (order.includes("alpaca")) {
    try {
      for (const [sym, resp] of await fetchAlpacaCandlesBatch(symbols, range, interval)) accept(sym, resp, "alpaca");
    } catch (e) {
      console.warn(`marketData: Alpaca batch failed (${e instanceof Error ? e.message : e}); using Webull/Yahoo per-symbol`);
    }
  }

  if (order.includes("webull")) {
    const remaining = symbols.filter((s) => !out.has(s));
    const fetched = await mapWithConcurrency(remaining, WEBULL_BATCH_CONCURRENCY, (sym) => fetchWebullCandles(sym, range, interval));
    fetched.forEach((resp, i) => { if (resp) accept(remaining[i], resp, "webull"); });
  }

  // Fill whatever Alpaca/Webull didn't return (non-equities, gaps) one at a time via Yahoo.
  for (const sym of symbols) {
    if (out.has(sym)) continue;
    try { out.set(sym, sanitizeResponse(await fetchYahooCandles(sym, range, interval))); } catch { /* skip */ }
  }
  return out;
}
