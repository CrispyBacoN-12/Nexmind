// The bars the chart draws, and the moving averages drawn over them.
//
// Why this is not just `candles.slice(-126)`: a 200-period mean needs 200 bars
// BEFORE the leftmost bar on screen. Computing it on the visible slice alone
// leaves the left two thirds of the SMA200 line missing, which reads as "the
// data starts here" rather than "the window starts here". So the route fetches
// two years, the means are computed over all of it, and only the last six
// months are handed to the client — ~12KB instead of ~35KB, with both lines
// complete from the first pixel.
//
// The moving averages are reference, not signal. Nothing in this project has
// ever tested an SMA cross into profit, and the card's no-edge claim stands
// over the chart exactly as it stands over the numbers.
//
// Pure.

import { sma, type Candle } from "@/lib/indicators";

/** Roughly six months of US sessions. */
export const CHART_VISIBLE_BARS = 126;
export const CHART_SMA_FAST = 50;
export const CHART_SMA_SLOW = 200;

/**
 * Sessions the route must ask for so that SMA200 is complete across the whole
 * visible window: 200 of history plus every bar on screen, with slack for
 * holidays. "2y" at 1d clears it.
 */
export const CHART_MIN_SESSIONS = CHART_SMA_SLOW + CHART_VISIBLE_BARS;

export interface ChartBar {
  /** Epoch SECONDS, as Candle.t. */
  t: number;
  /** YYYY-MM-DD, so the client never re-derives a date from a timestamp. */
  d: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  /** null until enough history has accumulated. Never a stand-in value. */
  sma50: number | null;
  sma200: number | null;
}

/**
 * Empty columns appended to the right of the last bar.
 *
 * The entry, stop and R levels are things the owner has not done yet, and a
 * horizontal line drawn only across history reads as a level that already
 * happened. The projection zone is where those lines are drawn solid: history
 * on the left, the decision on the right, with nothing invented in between —
 * the columns carry no prices at all.
 */
export const CHART_PROJECTION_BARS = 18;

/** A ChartBar, or an empty forward column carrying only a date. */
export interface ChartRow {
  t: number;
  d: string;
  o: number | null;
  h: number | null;
  l: number | null;
  c: number | null;
  v: number | null;
  sma50: number | null;
  sma200: number | null;
  /** false on the forward-projection columns. Nothing else distinguishes them. */
  real: boolean;
}

const DAY_SECONDS = 86_400;

/** Candle.t is epoch SECONDS, not milliseconds. */
function barDate(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 10);
}

/** Sunday is 0 and Saturday is 6. Exchange holidays are not modelled: these
 *  dates only label an empty zone, so a wrong one costs a tick label. */
function isWeekend(t: number): boolean {
  const day = new Date(t * 1000).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * The last `visibleBars` candles, each carrying moving averages computed over
 * the ENTIRE input. Pass the full fetched history, not a pre-sliced window.
 */
export function chartSeries(
  candles: Candle[],
  visibleBars: number = CHART_VISIBLE_BARS,
): ChartBar[] {
  if (candles.length === 0) return [];

  const closes = candles.map((b) => b.c);
  const fast = sma(closes, CHART_SMA_FAST);
  const slow = sma(closes, CHART_SMA_SLOW);

  const from = Math.max(0, candles.length - visibleBars);
  const rows: ChartBar[] = [];
  for (let i = from; i < candles.length; i++) {
    const b = candles[i];
    rows.push({
      t: b.t,
      d: barDate(b.t),
      o: b.o,
      h: b.h,
      l: b.l,
      c: b.c,
      v: b.v,
      sma50: fast[i],
      sma200: slow[i],
    });
  }
  return rows;
}

/**
 * The series with `n` empty weekday columns appended, so a level line has a
 * right-hand side to be drawn solid across.
 *
 * The appended columns are null in every price field on purpose. Carrying the
 * last close forward would draw a flat line into the future and assert
 * something the data does not say.
 */
export function withProjection(
  bars: ChartBar[],
  n: number = CHART_PROJECTION_BARS,
): ChartRow[] {
  const rows: ChartRow[] = bars.map((b) => ({ ...b, real: true }));
  if (rows.length === 0) return rows;

  let t = rows[rows.length - 1].t;
  for (let i = 0; i < n; i++) {
    do {
      t += DAY_SECONDS;
    } while (isWeekend(t));
    rows.push({
      t,
      d: barDate(t),
      o: null,
      h: null,
      l: null,
      c: null,
      v: null,
      sma50: null,
      sma200: null,
      real: false,
    });
  }
  return rows;
}
