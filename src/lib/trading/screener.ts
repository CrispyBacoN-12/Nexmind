// Narrows a large, heterogeneous universe (e.g. sp500's ~500 names) down to a
// shortlist worth scanning with the systematic ATR-ladder strategies. Those
// strategies were validated (blind out-of-sample) on liquid, moderately
// volatile names — this screen keeps the universe in that same regime instead
// of letting per-stock idiosyncrasies (illiquidity, penny-stock noise, binary
// earnings-gap risk) dilute or invalidate the pooled edge.
import { fetchCandlesBatch } from "@/lib/marketData";
import { atr, adx, type Candle } from "@/lib/indicators";
import { type Range, type Interval } from "@/lib/yahoo";
import { BANK_STOCKS } from "@/lib/trading/universe";

export interface ScreenCriteria {
  /** Below this, price noise/tick-size effects dominate technical levels. */
  minPrice: number;
  /** Mean(close * volume) over the lookback — a lot of size must be able to
   *  fill near the touch price without the strategy's own orders moving it. */
  minAvgDollarVolume: number;
  /** ATR14 as % of price. Too low and the tight 1.2x/1.5x ATR ladder sits
   *  inside spread + slippage; there's no real room for the trade to work. */
  minAtrPct: number;
  /** Too high and single-day moves (often earnings/news gaps) blow through
   *  both the stop and target intrabar — a technical SL can't contain that. */
  maxAtrPct: number;
  /** Symbols to reject outright regardless of their metrics (e.g. bank stocks —
   *  see BANK_STOCKS for why the whole sector is excluded by default). */
  excludeSymbols: string[];
}

export const DEFAULT_SCREEN_CRITERIA: ScreenCriteria = {
  minPrice: 10,
  minAvgDollarVolume: 50_000_000,
  // 1.0 let low-beta defensives (utilities, staples, REITs — COST, DUK, PG,
  // KO, JNJ, WM all sat between 1.6-2.2%) through; raised past that whole
  // cluster so the ladder only sees names with real daily range to work with.
  minAtrPct: 2.5,
  maxAtrPct: 6.0,
  excludeSymbols: BANK_STOCKS,
};

export interface ScreenResult {
  symbol: string;
  price: number | null;
  avgDollarVolume: number | null;
  atrPct: number | null;
  adx: number | null;
  passed: boolean;
  reason?: string;
}

function lastNonNull(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i];
  return null;
}

function evaluate(symbol: string, candles: Candle[], criteria: ScreenCriteria, volumeLookback: number): ScreenResult {
  if (criteria.excludeSymbols.includes(symbol)) return { symbol, price: null, avgDollarVolume: null, atrPct: null, adx: null, passed: false, reason: "excluded (bank sector)" };
  if (candles.length < 30) return { symbol, price: null, avgDollarVolume: null, atrPct: null, adx: null, passed: false, reason: "insufficient history" };

  const price = candles[candles.length - 1].c;
  const window = candles.slice(-volumeLookback);
  const avgDollarVolume = window.reduce((s, c) => s + c.c * c.v, 0) / window.length;
  const atrVal = lastNonNull(atr(candles, 14));
  const atrPct = atrVal != null ? (atrVal / price) * 100 : null;
  const adxVal = lastNonNull(adx(candles, 14).adx);

  if (price < criteria.minPrice) return { symbol, price, avgDollarVolume, atrPct, adx: adxVal, passed: false, reason: `price $${price.toFixed(2)} < min $${criteria.minPrice}` };
  if (avgDollarVolume < criteria.minAvgDollarVolume) return { symbol, price, avgDollarVolume, atrPct, adx: adxVal, passed: false, reason: `avg $vol ${(avgDollarVolume / 1e6).toFixed(1)}M < min ${(criteria.minAvgDollarVolume / 1e6).toFixed(0)}M` };
  if (atrPct == null) return { symbol, price, avgDollarVolume, atrPct, adx: adxVal, passed: false, reason: "ATR unavailable" };
  if (atrPct < criteria.minAtrPct) return { symbol, price, avgDollarVolume, atrPct, adx: adxVal, passed: false, reason: `ATR% ${atrPct.toFixed(2)} < min ${criteria.minAtrPct}` };
  if (atrPct > criteria.maxAtrPct) return { symbol, price, avgDollarVolume, atrPct, adx: adxVal, passed: false, reason: `ATR% ${atrPct.toFixed(2)} > max ${criteria.maxAtrPct}` };

  return { symbol, price, avgDollarVolume, atrPct, adx: adxVal, passed: true };
}

/**
 * Fetch + score a whole universe against liquidity/volatility criteria.
 * Returns every symbol (pass or fail) with the reason, sorted by dollar
 * volume descending among passers so the shortlist can just be `.filter(r => r.passed)`.
 */
export async function screenUniverse(
  symbols: string[],
  criteria: ScreenCriteria = DEFAULT_SCREEN_CRITERIA,
  range: Range = "3mo",
  interval: Interval = "1d",
  volumeLookback = 20,
): Promise<ScreenResult[]> {
  const toFetch = symbols.filter((s) => !criteria.excludeSymbols.includes(s));
  const data = await fetchCandlesBatch(toFetch, range, interval);
  const results: ScreenResult[] = symbols.map((symbol) => {
    if (criteria.excludeSymbols.includes(symbol)) return { symbol, price: null, avgDollarVolume: null, atrPct: null, adx: null, passed: false, reason: "excluded (bank sector)" };
    const resp = data.get(symbol);
    if (!resp) return { symbol, price: null, avgDollarVolume: null, atrPct: null, adx: null, passed: false, reason: "fetch failed" };
    return evaluate(symbol, resp.candles, criteria, volumeLookback);
  });
  results.sort((a, b) => {
    if (a.passed !== b.passed) return a.passed ? -1 : 1;
    return (b.avgDollarVolume ?? 0) - (a.avgDollarVolume ?? 0);
  });
  return results;
}
