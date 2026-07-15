// Pure candlestick reversal-pattern detectors. Each `is*` function answers
// "does the pattern complete at bar i?" — geometry only, gated by
// `priorTrend` so a shape only counts as a *reversal* when it follows the
// trend it's supposed to reverse (mirrors the SMA50 trend filters already
// used by Dip Buy / Rip Sell / Liquidity Sweep in strategies.ts).

import type { Candle } from "@/lib/indicators";

export type TrendDirection = "up" | "down" | "flat";

function bodySize(c: Candle): number { return Math.abs(c.c - c.o); }
function candleRange(c: Candle): number { return c.h - c.l; }
function upperWick(c: Candle): number { return c.h - Math.max(c.o, c.c); }
function lowerWick(c: Candle): number { return Math.min(c.o, c.c) - c.l; }
function isBullishCandle(c: Candle): boolean { return c.c > c.o; }
function isBearishCandle(c: Candle): boolean { return c.c < c.o; }
function avg(xs: number[]): number { return xs.reduce((s, x) => s + x, 0) / xs.length; }

/**
 * Trend of the `lookback` bars ending at index i, via a split-window average
 * slope (first half vs second half of the window). Returns "flat" both when
 * there isn't enough history (i - lookback < 0) and when the slope is inside
 * a +/-0.15% dead zone — deliberately conservative, since every detector
 * below treats "flat" the same as "wrong direction" (no reversal context).
 */
export function priorTrend(bars: Candle[], i: number, lookback = 10): TrendDirection {
  if (i < 0 || i - lookback < 0) return "flat";
  const window = bars.slice(i - lookback, i + 1).map((b) => b.c);
  const mid = Math.floor(window.length / 2);
  const firstAvg = avg(window.slice(0, mid));
  const secondAvg = avg(window.slice(mid));
  if (firstAvg === 0) return "flat";
  const change = (secondAvg - firstAvg) / firstAvg;
  const EPS = 0.0015;
  if (change > EPS) return "up";
  if (change < -EPS) return "down";
  return "flat";
}

/** Small body in the upper part of the range, lower wick >= 2x body, upper
 *  wick <= 0.3x body, following a downtrend. */
export function isHammer(bars: Candle[], i: number): boolean {
  const c = bars[i];
  if (candleRange(c) <= 0) return false;
  const body = bodySize(c);
  if (body <= 0) return false;
  if (lowerWick(c) < 2 * body) return false;
  if (upperWick(c) > 0.3 * body) return false;
  return priorTrend(bars, i - 1, 10) === "down";
}

/** Mirror of Hammer: small body in the lower part of the range, upper wick
 *  >= 2x body, lower wick <= 0.3x body, following an uptrend. */
export function isShootingStar(bars: Candle[], i: number): boolean {
  const c = bars[i];
  if (candleRange(c) <= 0) return false;
  const body = bodySize(c);
  if (body <= 0) return false;
  if (upperWick(c) < 2 * body) return false;
  if (lowerWick(c) > 0.3 * body) return false;
  return priorTrend(bars, i - 1, 10) === "up";
}

/** Bearish candle followed by a bullish candle whose body fully engulfs it
 *  (opens at/below the prior close, closes at/above the prior open), after
 *  a downtrend. */
export function isBullishEngulfing(bars: Candle[], i: number): boolean {
  if (i < 1) return false;
  const prev = bars[i - 1], cur = bars[i];
  if (!isBearishCandle(prev) || !isBullishCandle(cur)) return false;
  if (cur.o > prev.c || cur.c < prev.o) return false;
  if (bodySize(cur) <= bodySize(prev)) return false;
  return priorTrend(bars, i - 2, 10) === "down";
}

/** Mirror of Bullish Engulfing: bullish candle followed by a bearish candle
 *  that engulfs it, after an uptrend. */
export function isBearishEngulfing(bars: Candle[], i: number): boolean {
  if (i < 1) return false;
  const prev = bars[i - 1], cur = bars[i];
  if (!isBullishCandle(prev) || !isBearishCandle(cur)) return false;
  if (cur.o < prev.c || cur.c > prev.o) return false;
  if (bodySize(cur) <= bodySize(prev)) return false;
  return priorTrend(bars, i - 2, 10) === "up";
}

/** Long bearish candle, then a bullish candle that gaps down (opens at/below
 *  the prior close) and closes above the prior body's midpoint but below the
 *  prior open — a partial, not full, engulf — after a downtrend. */
export function isPiercingLine(bars: Candle[], i: number): boolean {
  if (i < 1) return false;
  const prev = bars[i - 1], cur = bars[i];
  if (!isBearishCandle(prev) || !isBullishCandle(cur)) return false;
  if (bodySize(prev) <= 0) return false;
  const prevMid = (prev.o + prev.c) / 2;
  if (cur.o > prev.c) return false;
  if (cur.c <= prevMid || cur.c >= prev.o) return false;
  return priorTrend(bars, i - 2, 10) === "down";
}

/** Mirror of Piercing Line: long bullish candle, then a bearish candle that
 *  gaps up and closes below the prior body's midpoint but above the prior
 *  open, after an uptrend. */
export function isDarkCloudCover(bars: Candle[], i: number): boolean {
  if (i < 1) return false;
  const prev = bars[i - 1], cur = bars[i];
  if (!isBullishCandle(prev) || !isBearishCandle(cur)) return false;
  if (bodySize(prev) <= 0) return false;
  const prevMid = (prev.o + prev.c) / 2;
  if (cur.o < prev.c) return false;
  if (cur.c >= prevMid || cur.c <= prev.o) return false;
  return priorTrend(bars, i - 2, 10) === "up";
}

/** Long bearish candle, a small-bodied "star" that gaps below its body, then
 *  a bullish candle closing back above the first candle's midpoint, after a
 *  downtrend. */
export function isMorningStar(bars: Candle[], i: number): boolean {
  if (i < 2) return false;
  const first = bars[i - 2], star = bars[i - 1], third = bars[i];
  if (!isBearishCandle(first) || !isBullishCandle(third)) return false;
  const firstBody = bodySize(first);
  if (firstBody <= 0) return false;
  if (bodySize(star) > 0.5 * firstBody) return false;
  if (Math.max(star.o, star.c) >= Math.min(first.o, first.c)) return false;
  if (third.c <= (first.o + first.c) / 2) return false;
  return priorTrend(bars, i - 3, 10) === "down";
}

/** Mirror of Morning Star: long bullish candle, a small-bodied star gapping
 *  above its body, then a bearish candle closing back below the first
 *  candle's midpoint, after an uptrend. */
export function isEveningStar(bars: Candle[], i: number): boolean {
  if (i < 2) return false;
  const first = bars[i - 2], star = bars[i - 1], third = bars[i];
  if (!isBullishCandle(first) || !isBearishCandle(third)) return false;
  const firstBody = bodySize(first);
  if (firstBody <= 0) return false;
  if (bodySize(star) > 0.5 * firstBody) return false;
  if (Math.min(star.o, star.c) <= Math.max(first.o, first.c)) return false;
  if (third.c >= (first.o + first.c) / 2) return false;
  return priorTrend(bars, i - 3, 10) === "up";
}

/** Three consecutive bullish candles, each closing higher than the last,
 *  each opening inside the previous candle's body, each with a small upper
 *  wick (strong closes near the high), after a downtrend. */
export function isThreeWhiteSoldiers(bars: Candle[], i: number): boolean {
  if (i < 2) return false;
  const [a, b, c] = [bars[i - 2], bars[i - 1], bars[i]];
  for (const k of [a, b, c]) {
    if (!isBullishCandle(k)) return false;
    const body = bodySize(k);
    if (body <= 0 || upperWick(k) > 0.3 * body) return false;
  }
  if (!(b.c > a.c && c.c > b.c)) return false;
  if (!(b.o > a.o && b.o < a.c)) return false;
  if (!(c.o > b.o && c.o < b.c)) return false;
  return priorTrend(bars, i - 3, 10) === "down";
}

/** Mirror of Three White Soldiers: three consecutive bearish candles, each
 *  closing lower, each opening inside the previous candle's body, each with
 *  a small lower wick, after an uptrend. */
export function isThreeBlackCrows(bars: Candle[], i: number): boolean {
  if (i < 2) return false;
  const [a, b, c] = [bars[i - 2], bars[i - 1], bars[i]];
  for (const k of [a, b, c]) {
    if (!isBearishCandle(k)) return false;
    const body = bodySize(k);
    if (body <= 0 || lowerWick(k) > 0.3 * body) return false;
  }
  if (!(b.c < a.c && c.c < b.c)) return false;
  if (!(b.o < a.o && b.o > a.c)) return false;
  if (!(c.o < b.o && c.o > b.c)) return false;
  return priorTrend(bars, i - 3, 10) === "up";
}
