// Candles -> the two market facts the gates read: the correlation of the
// candidate with each held name, and SPY against its SMA200. Pure.
//
// Unlike the advisor card's pearsonCorrelation (which zips by trailing index),
// this pairs returns BY DATE: a gate that blocks a trade must not be computed
// from two series that are a session apart.

import { sma, type Candle } from "@/lib/indicators";
import { MAX_TREND_EXTENSION } from "@/lib/market/marketGate";
import { TREND_PERIOD } from "@/lib/market/regime";

/** Sessions of paired daily returns behind a correlation reading. */
export const CORRELATION_WINDOW = 60;
/** Fewer shared return days than this reads as unknown. */
export const MIN_CORRELATION_DAYS = 40;

const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

/** Close-to-close returns keyed by the date of the later bar. */
function returnsByDate(candles: Candle[]): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].c;
    if (prev > 0 && Number.isFinite(candles[i].c)) out.set(day(candles[i].t), candles[i].c / prev - 1);
  }
  return out;
}

/**
 * Pearson correlation over the last `window` dates on which BOTH series have a
 * return. null when fewer than MIN_CORRELATION_DAYS are shared or either side
 * has no variance.
 */
export function dateAlignedCorrelation(a: Candle[], b: Candle[], window = CORRELATION_WINDOW): number | null {
  const ra = returnsByDate(a);
  const rb = returnsByDate(b);
  const dates = [...ra.keys()].filter((d) => rb.has(d)).sort().slice(-window);
  if (dates.length < Math.min(MIN_CORRELATION_DAYS, window)) return null;
  const x = dates.map((d) => ra.get(d)!);
  const y = dates.map((d) => rb.get(d)!);
  const mx = x.reduce((s, v) => s + v, 0) / x.length;
  const my = y.reduce((s, v) => s + v, 0) / y.length;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < x.length; i++) {
    cov += (x[i] - mx) * (y[i] - my);
    vx += (x[i] - mx) ** 2;
    vy += (y[i] - my) ** 2;
  }
  return vx === 0 || vy === 0 ? null : cov / Math.sqrt(vx * vy);
}

/**
 * SPY's last close and SMA200, or null when the series is too short or
 * implausible (the same MAX_TREND_EXTENSION guard as the desk's market gate).
 * null makes the REGIME gate fail closed at WARN.
 */
export function regimeFromBenchmark(benchmark: Candle[] | null): { spyClose: number; spySma200: number } | null {
  if (!benchmark || benchmark.length < TREND_PERIOD) return null;
  const closes = benchmark.map((b) => b.c);
  const ma = sma(closes, TREND_PERIOD);
  const trend = ma[ma.length - 1];
  const close = closes[closes.length - 1];
  if (trend == null || !(trend > 0) || !(close > 0)) return null;
  if (Math.abs(close / trend - 1) > MAX_TREND_EXTENSION) return null;
  return { spyClose: close, spySma200: trend };
}
