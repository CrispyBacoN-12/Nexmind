import test from "node:test";
import assert from "node:assert/strict";
import { parseEconEvents, eventsForSession } from "./econ";

test("keeps only high-importance US events and formats Thai time", () => {
  const events = parseEconEvents({
    status: "ok",
    result: [
      { title: "CPI", country: "US", date: "2026-10-30T12:30:00.000Z", importance: 1 },
      { title: "Minor", country: "US", date: "2026-10-30T14:00:00.000Z", importance: 0 },
      { title: "ECB Rate", country: "EU", date: "2026-10-30T12:15:00.000Z", importance: 1 },
    ],
  });
  assert.deepEqual(events, [{ title: "CPI", at: "2026-10-30T12:30:00.000Z", thaiTime: "19:30" }]);
});

test("filters to the session's New York date", () => {
  const events = [
    { title: "Late", at: "2026-10-31T01:00:00Z", thaiTime: "08:00" }, // 21:00 ET on the 30th
    { title: "Next day", at: "2026-10-31T13:30:00Z", thaiTime: "20:30" },
  ];
  assert.deepEqual(eventsForSession(events, "2026-10-30").map((e) => e.title), ["Late"]);
  assert.deepEqual(eventsForSession(events, "2026-10-31").map((e) => e.title), ["Next day"]);
});

test("a body without result throws", () => {
  assert.throws(() => parseEconEvents({ status: "ok" }), /result/);
  assert.throws(() => parseEconEvents(null), /result/);
});
