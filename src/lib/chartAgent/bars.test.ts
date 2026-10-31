import test from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import { etClock } from "@/lib/scanAgent/session";
import { splitSessions } from "./bars";

// A bar starting at the given UTC instant; prices are irrelevant to the split.
function bar(iso: string): Candle {
  return { t: Date.parse(iso) / 1000, o: 10, h: 11, l: 9, c: 10, v: 100 };
}

test("etClock reads New York wall time, across DST", () => {
  // 2026-10-30 is EDT (UTC-4): 13:30Z is the 09:30 open.
  assert.deepEqual(etClock(Date.parse("2026-10-30T13:30:00Z") / 1000), {
    date: "2026-10-30",
    minutes: 570,
  });
  // 2026-12-01 is EST (UTC-5): the same 13:30Z is 08:30, still pre-market.
  assert.deepEqual(etClock(Date.parse("2026-12-01T13:30:00Z") / 1000), {
    date: "2026-12-01",
    minutes: 510,
  });
});

test("splitSessions separates previous regular, pre-market and regular bars", () => {
  const fri = bar("2026-10-30T13:30:00Z"); // 09:30 ET
  const friLate = bar("2026-10-30T19:55:00Z"); // 15:55 ET, last regular bar
  const friPost = bar("2026-10-30T21:00:00Z"); // 17:00 ET, post-market
  const monPre = bar("2026-11-02T13:00:00Z"); // 08:00 ET (EST, DST ended 11-01)
  const monOpen = bar("2026-11-02T14:30:00Z"); // 09:30 ET
  const monNext = bar("2026-11-02T14:35:00Z"); // 09:35 ET
  const s = splitSessions(
    [fri, friLate, friPost, monPre, monOpen, monNext],
    "2026-11-02",
  );
  assert.equal(s.previousDate, "2026-10-30");
  assert.deepEqual(s.previous, [fri, friLate]); // post-market bar dropped
  assert.deepEqual(s.premarket, [monPre]);
  assert.deepEqual(s.regular, [monOpen, monNext]);
});

test("the bar starting at 16:00 ET is post-market, 09:30 ET is regular", () => {
  const lastRegular = bar("2026-10-30T19:55:00Z"); // 15:55 ET
  const close = bar("2026-10-30T20:00:00Z"); // 16:00 ET
  const s = splitSessions([lastRegular, close], "2026-11-02");
  assert.deepEqual(s.previous, [lastRegular]);
});

test("previous session is the latest earlier date with bars, not yesterday", () => {
  // Thanksgiving 2026-11-26 has no bars: the previous session is the 25th.
  const wed = bar("2026-11-25T15:00:00Z"); // 10:00 ET
  const fri = bar("2026-11-27T15:00:00Z"); // 10:00 ET
  const s = splitSessions([wed, fri], "2026-11-27");
  assert.equal(s.previousDate, "2026-11-25");
  assert.deepEqual(s.previous, [wed]);
  assert.deepEqual(s.regular, [fri]);
});

test("a date whose only earlier bars are pre-market does not count as previous", () => {
  const earlyOnly = bar("2026-11-25T13:00:00Z"); // 08:00 ET, pre-market only
  const real = bar("2026-11-24T15:00:00Z"); // 10:00 ET
  const today = bar("2026-11-27T15:00:00Z");
  const s = splitSessions([real, earlyOnly, today], "2026-11-27");
  assert.equal(s.previousDate, "2026-11-24");
});

test("no earlier regular bars gives previousDate null and an empty previous", () => {
  const today = bar("2026-11-02T14:30:00Z");
  const s = splitSessions([today], "2026-11-02");
  assert.equal(s.previousDate, null);
  assert.deepEqual(s.previous, []);
  assert.deepEqual(s.regular, [today]);
});
