import { test } from "node:test";
import assert from "node:assert/strict";
import { monthKey, monthEndIndices } from "./monthEnds";

/** Day key for a UTC date, matching `dayKey` in crossSectional/calendar. */
function key(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000 / 86_400);
}

test("monthKey separates months and joins days within one", () => {
  assert.equal(monthKey(key("2021-08-02")), monthKey(key("2021-08-31")));
  assert.notEqual(monthKey(key("2021-08-31")), monthKey(key("2021-09-01")));
  // Year rollover must not collide: December and the following January differ.
  assert.notEqual(monthKey(key("2021-12-31")), monthKey(key("2022-01-03")));
});

test("monthEndIndices flags the last trading day of each month", () => {
  const days = ["2021-08-30", "2021-08-31", "2021-09-01", "2021-09-30", "2021-10-01"].map(key);
  // Index 1 is the last August day, index 3 the last September day.
  assert.deepEqual(monthEndIndices(days), [1, 3]);
});

test("the final day is never a month end, which is what drops the partial period", () => {
  // 2026-08-14 is where the cached data stops. Its month is still in progress,
  // and a rebalance there would have no later rebalance to exit into, so the
  // trailing fortnight must not become a 59th observation.
  const days = ["2026-06-29", "2026-06-30", "2026-07-31", "2026-08-14"].map(key);
  assert.deepEqual(monthEndIndices(days), [1, 2]);
});

test("a month with a single trading day still produces one end", () => {
  const days = ["2021-08-31", "2021-09-15", "2021-10-04"].map(key);
  assert.deepEqual(monthEndIndices(days), [0, 1]);
});
