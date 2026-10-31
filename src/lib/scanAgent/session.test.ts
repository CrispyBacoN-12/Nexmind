import test from "node:test";
import assert from "node:assert/strict";
import { marketPhase, sessionDates, etSessionCloseMs } from "./session";

test("pre-market, open and after-close on a weekday", () => {
  // 2026-10-30 is a Friday in EDT (UTC-4): 08:00 ET, 10:00 ET, 17:00 ET.
  assert.equal(marketPhase(Date.parse("2026-10-30T12:00:00Z")), "pre");
  assert.equal(marketPhase(Date.parse("2026-10-30T14:00:00Z")), "open");
  assert.equal(marketPhase(Date.parse("2026-10-30T21:00:00Z")), "closed");
});

test("a Saturday is closed and its session is Friday", () => {
  const now = Date.parse("2026-10-31T15:00:00Z");
  assert.equal(marketPhase(now), "closed");
  assert.deepEqual(sessionDates(now), {
    session: "2026-10-30",
    previous: "2026-10-29",
  });
});

test("before 04:00 ET on a Monday the session is the Friday before", () => {
  // 2026-11-02 07:00Z is 02:00 EST (DST ended 2026-11-01).
  const now = Date.parse("2026-11-02T07:00:00Z");
  assert.equal(sessionDates(now).session, "2026-10-30");
});

test("etSessionCloseMs respects DST", () => {
  assert.equal(
    etSessionCloseMs("2026-10-30"),
    Date.parse("2026-10-30T20:00:00Z"),
  );
  assert.equal(
    etSessionCloseMs("2026-11-02"),
    Date.parse("2026-11-02T21:00:00Z"),
  );
});
