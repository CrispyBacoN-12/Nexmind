import test from "node:test";
import assert from "node:assert/strict";

import type { Candle } from "@/lib/indicators";

import { gapRisk, GAP_MIN_SESSIONS } from "./gapRisk";

const DAY = 86_400;

/** Flat bars with a constant 2-dollar range: TR = 2, so ATR settles at exactly 2. */
function flat(n: number, price = 100): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    t: 1_700_000_000 + i * DAY, o: price, h: price + 1, l: price - 1, c: price, v: 1_000,
  }));
}

test("no gaps at all reads zero, with no worst date", () => {
  const g = gapRisk(flat(120));
  assert.ok(g);
  assert.equal(g.worstStops, 0);
  assert.equal(g.worstDate, null);
  assert.equal(g.worstLossR, 1);
  assert.equal(g.overOneStop, 0);
});

test("a gap down is measured in prior-evening stops: 6 dollars vs 1.5 x ATR 2 is 2 stops, 3R worst case", () => {
  const bars = flat(120);
  bars[100] = { ...bars[100], o: 94, h: 95, l: 93, c: 94 };
  const g = gapRisk(bars);
  assert.ok(g);
  assert.ok(Math.abs(g.worstStops - 2) < 1e-12);
  assert.ok(Math.abs(g.worstLossR - 3) < 1e-12);
  assert.equal(g.worstDate, new Date(bars[100].t * 1000).toISOString().slice(0, 10));
  assert.equal(g.overOneStop, 1);
  assert.equal(g.overHalfStop, 1);
});

test("the denominator is ATR_{t-1}: the gap bar's own wide range does not shrink its reading", () => {
  const bars = flat(120);
  // A huge range on the gap bar would inflate ATR_t, not ATR_{t-1}.
  bars[100] = { ...bars[100], o: 94, h: 130, l: 70, c: 94 };
  const g = gapRisk(bars);
  assert.ok(g);
  assert.ok(Math.abs(g.worstStops - 2) < 1e-12);
});

test("gaps UP are not risk to a long", () => {
  // Everything from bar 100 on sits at 110, so there is no way back down to gap.
  const bars = [...flat(100), ...flat(20, 110).map((b, i) => ({ ...b, t: 1_700_000_000 + (100 + i) * DAY }))];
  const g = gapRisk(bars);
  assert.ok(g);
  assert.equal(g.worstStops, 0);
});

test("too little history is null, not a worst case from a handful of nights", () => {
  assert.equal(gapRisk(flat(GAP_MIN_SESSIONS)), null);
  assert.equal(gapRisk(null), null);
  assert.equal(gapRisk([]), null);
});
