import { test } from "node:test";
import assert from "node:assert/strict";
import { isPlaceholderBar, sanitizeSeries, FROZEN_VOLUME_FRACTION } from "./bars";
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
