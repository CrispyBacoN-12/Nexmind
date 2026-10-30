import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import { baseRate, BASE_RATE_HORIZON, BASE_RATE_MIN_ENTRIES } from "./baseRate";

const DAY = 86_400;
const T0 = Date.parse("2024-01-01T00:00:00Z") / 1000;

/** Bars with a fixed true range of 2 around a close path. ATR settles at 2, so 1R = 3. */
function path(closes: number[]): Candle[] {
  return closes.map((c, i) => ({ t: T0 + i * DAY, o: c, h: c + 1, l: c - 1, c, v: 1000 }));
}

const flat = (n: number) => path(Array.from({ length: n }, () => 100));

test("too little history is null, never a percentage off a handful of entries", () => {
  assert.equal(baseRate(flat(50)), null);
  assert.equal(baseRate(null), null);
  // Exactly one short of the floor.
  assert.equal(baseRate(flat(14 + BASE_RATE_HORIZON + BASE_RATE_MIN_ENTRIES - 1)), null);
});

test("a flat tape that never reaches stop or target is all open", () => {
  const r = baseRate(flat(300));
  assert.ok(r);
  for (const row of r.rows) {
    assert.equal(row.openPct, 100);
    assert.equal(row.targetFirstPct, 0);
  }
});

test("a steady rise reaches 1R first; a steady fall stops out first", () => {
  const up = baseRate(path(Array.from({ length: 300 }, (_, i) => 100 + i * 2)));
  const down = baseRate(path(Array.from({ length: 300 }, (_, i) => 1000 - i * 2)));
  assert.ok(up && down);
  assert.equal(up.rows[0].targetFirstPct, 100);
  assert.equal(down.rows[0].stopFirstPct, 100);
  assert.ok(up.buyHoldPct > 0 && down.buyHoldPct < 0);
});

test("percentages sum to 100 and the break-even line is 1/(1+R)", () => {
  const closes = Array.from({ length: 400 }, (_, i) => 100 + 6 * Math.sin(i / 3));
  const r = baseRate(path(closes));
  assert.ok(r);
  for (const row of r.rows) {
    assert.ok(Math.abs(row.targetFirstPct + row.stopFirstPct + row.openPct - 100) < 1e-9);
    assert.ok(Math.abs(row.breakEvenPct - 100 / (1 + row.r)) < 1e-9);
  }
  // A farther target can only be reached first as often as a nearer one, or less.
  for (let k = 1; k < r.rows.length; k++) assert.ok(r.rows[k].targetFirstPct <= r.rows[k - 1].targetFirstPct + 1e-9);
});

test("a session touching both stop and target counts as stop first", () => {
  const closes = Array.from({ length: 200 }, () => 100);
  const candles = path(closes);
  // One wide bar near the end of the sample: low far below, high far above.
  candles[150] = { ...candles[150], h: 200, l: 1 };
  const r = baseRate(candles);
  assert.ok(r);
  assert.ok(r.sameBarBoth > 0);
  assert.ok(r.rows[0].stopFirstPct > 0);
});

test("entries whose window runs past the last bar are dropped", () => {
  const n = 300;
  const r = baseRate(flat(n));
  assert.ok(r);
  // ATR first exists at index 14; the last entry must leave a full horizon.
  assert.equal(r.entries, n - BASE_RATE_HORIZON - 14);
});
