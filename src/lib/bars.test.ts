import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPlaceholderBar, sanitizeSeries, FROZEN_VOLUME_FRACTION,
  medianBarSpacingDays, isDailySeries, MAX_DAILY_BAR_SPACING, MIN_DAILY_BAR_SPACING,
  isIntradaySeries, INTRADAY_SPACING_TOLERANCE,
} from "./bars";
import type { Candle } from "@/lib/indicators";

// Why the shape rule alone is not enough
// --------------------------------------
// 2026-08-30: MO's weekly series carried a bar with O=H=L=C=72.070 on 9,000
// shares, against a 29.6M average — 0.03% of a normal week. isPlaceholderBar
// passed it through, correctly by its own contract: a zero-range bar WITH volume
// can be a real limit-up halt, and that decision is deliberate (panel.test.ts).
// SAGE caught this one by hand.
//
// What separates the two cases is not visible in a single bar. A halt still
// trades in the same order of magnitude as a normal session; filler prints a
// token quantity or none. So the shape rule keeps its single-bar contract and
// the series-level pass, which can see what "typical" means for this symbol,
// makes the call.

const DAY = 86_400;
const bar = (t: number, c: number, v: number): Candle => ({ t, o: c - 1, h: c + 1, l: c - 2, c, v });
const flat = (t: number, c: number, v: number): Candle => ({ t, o: c, h: c, l: c, c, v });

/** A normal series with `n` real sessions at ~29.6M shares, MO's actual average. */
const normal = (n: number): Candle[] => Array.from({ length: n }, (_, i) => bar(i * DAY, 70 + i * 0.1, 29_600_000));

test("isPlaceholderBar keeps its single-bar contract unchanged", () => {
  // The series pass below is the new behaviour; this predicate must not start
  // guessing about halts on its own, because it is called with no context.
  assert.equal(isPlaceholderBar(flat(0, 72.07, 9_000)), false, "no context to judge 9k by");
  assert.equal(isPlaceholderBar(flat(0, 72.07, 0)), true);
});

test("a flat bar on a token fraction of the symbol's usual volume is dropped", () => {
  // MO's actual numbers: 9,000 against a 29.6M average.
  const rows = [...normal(20), flat(20 * DAY, 72.07, 9_000), ...normal(10)];
  const { candles, dropped } = sanitizeSeries(rows);
  assert.equal(dropped, 1);
  assert.ok(!candles.some((b) => b.v === 9_000));
});

test("a flat bar that actually traded is kept — that is a halt, not filler", () => {
  // The whole reason isPlaceholderBar refuses to judge this shape alone. A
  // limit-up session prints normal size; dropping it would delete a real event.
  const rows = [...normal(20), flat(20 * DAY, 72.07, 25_000_000), ...normal(10)];
  assert.equal(sanitizeSeries(rows).dropped, 0);
});

test("the cutoff is far enough below normal size that no real session reaches it", () => {
  // 1% of typical: the MO bar clears it by 30x, and a halt would have to trade
  // a hundredth of a normal week to be mistaken for filler.
  assert.equal(FROZEN_VOLUME_FRACTION, 0.01);
  const typical = 29_600_000;
  const rows = (v: number) => [...normal(20), flat(20 * DAY, 72.07, v), ...normal(10)];
  assert.equal(sanitizeSeries(rows(typical * 0.011)).dropped, 0, "just above the line stays");
  assert.equal(sanitizeSeries(rows(typical * 0.009)).dropped, 1, "just below the line goes");
});

test("a thin session that still moved is never dropped", () => {
  // Low volume alone is a quiet week, not a fabricated bar. Only the flat shape
  // plus token volume together are the filler signature.
  const rows = [...normal(20), bar(20 * DAY, 72.07, 9_000), ...normal(10)];
  assert.equal(sanitizeSeries(rows).dropped, 0);
});

test("a series with no traded volume at all falls back to the shape rule alone", () => {
  // Every bar zero-volume means there is no "typical" to compare against.
  // Scaling off zero would drop the entire series.
  const rows = [bar(0, 70, 0), bar(DAY, 71, 0), flat(2 * DAY, 71, 0)];
  const { candles, dropped } = sanitizeSeries(rows);
  assert.equal(dropped, 1, "only the zero-volume flat bar, by shape");
  assert.equal(candles.length, 2);
});

test("typical size is judged by the median, so a long filler run cannot drag the bar down", () => {
  // PARA has 652 consecutive placeholder sessions. An average taken over those
  // would collapse toward zero and let the next filler print through.
  const rows = [
    ...normal(10),
    ...Array.from({ length: 30 }, (_, i) => flat((10 + i) * DAY, 72.07, 0)),
    flat(40 * DAY, 72.07, 9_000),
    ...normal(5),
  ];
  assert.equal(sanitizeSeries(rows).dropped, 31);
});

test("an empty series is unchanged", () => {
  assert.deepEqual(sanitizeSeries([]), { candles: [], dropped: 0 });
});

// ---- bar spacing ----
//
// A different failure from everything above: not a bad bar inside a good series,
// but a series that is the wrong RESOLUTION end to end. Yahoo answers
// `interval=1d` over a long range with weekly or monthly aggregates, and every
// one of those bars is well-formed — real open, real high, real volume, correctly
// adjusted. sanitizeSeries passes all of them because there is nothing wrong with
// any of them individually. Only the spacing between them says what they are.

/** `n` bars `stepDays` apart, all otherwise normal. */
const spaced = (n: number, stepDays: number): Candle[] =>
  Array.from({ length: n }, (_, i) => bar(i * stepDays * DAY, 70 + i, 29_600_000));

test("medianBarSpacingDays reads the typical gap, not the widest one", () => {
  assert.equal(medianBarSpacingDays(spaced(50, 1)), 1);
  assert.equal(medianBarSpacingDays(spaced(50, 7)), 7);
  // Too short to have a spacing at all — null, not 0, because 0 would read as
  // "bars on top of each other" and pass the daily check.
  assert.equal(medianBarSpacingDays([]), null);
  assert.equal(medianBarSpacingDays(spaced(1, 1)), null);
});

test("a real market closure cannot move the median", () => {
  // The September 2001 four-session closure is one gap in four thousand. If a
  // single wide gap could flip the verdict, the check would reject genuine
  // history for having had a real event in it.
  const rows = spaced(4000, 1);
  const shifted = rows.map((b, i) => (i >= 2000 ? { ...b, t: b.t + 6 * DAY } : b));
  assert.equal(medianBarSpacingDays(shifted), 1);
  assert.equal(isDailySeries(shifted), true);
});

test("isDailySeries rejects the interval Yahoo silently downgrades to", () => {
  // Weekly bars land at 7 and monthly near 30; MAX_DAILY_BAR_SPACING sits at 4,
  // in the empty space above a weekend and far below either.
  assert.equal(isDailySeries(spaced(200, 7)), false, "weekly");
  assert.equal(isDailySeries(spaced(200, 30)), false, "monthly");
  assert.equal(isDailySeries(spaced(200, 91)), false, "quarterly");
  assert.equal(isDailySeries(spaced(200, 1)), true);
  // The threshold has to clear a weekend with room to spare, or a thinly traded
  // name that only prints a few days a week gets thrown out as weekly data.
  assert.ok(MAX_DAILY_BAR_SPACING > 3 && MAX_DAILY_BAR_SPACING < 7);
  assert.equal(isDailySeries(spaced(200, 3)), true, "a market that only prints Mon/Wed/Fri is still daily-resolution");
});

test("isDailySeries rejects everything BELOW a day too, not just above", () => {
  // The upper bound alone is half a check: every one of these has a median
  // spacing <= 4 and none of them is a daily series.
  assert.equal(isDailySeries(spaced(200, 1 / 24)), false, "hourly");
  assert.equal(isDailySeries(spaced(200, 1 / 96)), false, "15-minute");
  assert.equal(isDailySeries(spaced(200, 0)), false, "duplicate timestamps");
  assert.ok(MIN_DAILY_BAR_SPACING > 1 / 24 && MIN_DAILY_BAR_SPACING < 1);
});

test("a reverse-ordered series is not accepted as daily", () => {
  // sanitizeSeries filters bars, it does not order them, so newest-first really
  // can arrive here. Its gaps are all -1, which clears an upper bound of 4 and
  // would have been read as clean daily history.
  const newestFirst = [...spaced(200, 1)].reverse();
  assert.equal(medianBarSpacingDays(newestFirst), -1);
  assert.equal(isDailySeries(newestFirst), false);
});

test("a series with no spacing at all is not a daily series", () => {
  // Refusing to answer beats answering "yes" from one bar: an empty or
  // single-bar response is exactly what a wrong symbol returns, and the cache
  // builder must not write it as though it had been checked.
  assert.equal(isDailySeries([]), false);
  assert.equal(isDailySeries(spaced(1, 1)), false);
});

const MIN = 1 / 1440;

test("isIntradaySeries accepts the resolution it was asked about", () => {
  assert.equal(isIntradaySeries(spaced(500, 60 * MIN), 60), true, "H1");
  assert.equal(isIntradaySeries(spaced(500, 15 * MIN), 15), true, "M15");
  assert.equal(isIntradaySeries(spaced(500, 240 * MIN), 240), true, "H4");
});

test("isIntradaySeries rejects the ADJACENT timeframe, which is the whole point", () => {
  // An MT5 server with no history at the timeframe asked for does not error, it
  // answers shorter and coarser. The tightest step it can move is 2x — M15 to
  // M30 — so the band has to be narrower than that or the downgrade passes.
  assert.equal(isIntradaySeries(spaced(500, 30 * MIN), 15), false, "M15 served as M30");
  assert.equal(isIntradaySeries(spaced(500, 60 * MIN), 30), false, "M30 served as H1");
  assert.equal(isIntradaySeries(spaced(500, 240 * MIN), 60), false, "H1 served as H4");
  assert.equal(isIntradaySeries(spaced(500, 1), 60), false, "H1 served as D1");
  assert.ok(INTRADAY_SPACING_TOLERANCE.max < 2 && INTRADAY_SPACING_TOLERANCE.min > 0.5);
});

test("isIntradaySeries rejects a FINER series too", () => {
  // Asking for H1 and being handed M15 is just as wrong, and reads 0.25.
  assert.equal(isIntradaySeries(spaced(500, 15 * MIN), 60), false);
  assert.equal(isIntradaySeries(spaced(500, MIN), 15), false);
});

test("a 24/5 weekend gap cannot move the intraday verdict", () => {
  // Gold trades round the clock Monday to Friday and stops for ~49 hours. On H1
  // that is one gap in about 120, and the median does not notice it — which is
  // the reason this reads the median and not the mean.
  const rows = spaced(2400, 60 * MIN);
  const withWeekends = rows.map((b, i) =>
    ({ ...b, t: b.t + Math.floor(i / 120) * 49 * 3600 }));
  assert.equal(isIntradaySeries(withWeekends, 60), true);
});

test("isIntradaySeries refuses rather than guesses on degenerate input", () => {
  assert.equal(isIntradaySeries([], 60), false, "empty");
  assert.equal(isIntradaySeries(spaced(1, 60 * MIN), 60), false, "one bar");
  assert.equal(isIntradaySeries(spaced(500, 0), 60), false, "duplicate timestamps");
  assert.equal(isIntradaySeries([...spaced(500, 60 * MIN)].reverse(), 60), false, "newest-first");
  assert.equal(isIntradaySeries(spaced(500, 60 * MIN), 0), false, "no resolution asked about");
  assert.equal(isIntradaySeries(spaced(500, 60 * MIN), -60), false, "negative resolution");
});
