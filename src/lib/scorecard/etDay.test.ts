import test from "node:test";
import assert from "node:assert/strict";
import { etDayBoundsMs } from "./etDay";

test("etDayBoundsMs: EST day is 05:00Z to 05:00Z", () => {
  const b = etDayBoundsMs("2026-11-03");
  assert.equal(new Date(b.startMs).toISOString(), "2026-11-03T05:00:00.000Z");
  assert.equal(new Date(b.endMs).toISOString(), "2026-11-04T05:00:00.000Z");
});

test("etDayBoundsMs: EDT day is 04:00Z to 04:00Z", () => {
  const b = etDayBoundsMs("2026-07-01");
  assert.equal(new Date(b.startMs).toISOString(), "2026-07-01T04:00:00.000Z");
  assert.equal(new Date(b.endMs).toISOString(), "2026-07-02T04:00:00.000Z");
});

test("etDayBoundsMs: DST change days are 23 and 25 hours long", () => {
  const spring = etDayBoundsMs("2026-03-08"); // 05:00Z -> 04:00Z next day
  assert.equal((spring.endMs - spring.startMs) / 3_600_000, 23);
  const fall = etDayBoundsMs("2026-11-01"); // 04:00Z -> 05:00Z next day
  assert.equal((fall.endMs - fall.startMs) / 3_600_000, 25);
});
