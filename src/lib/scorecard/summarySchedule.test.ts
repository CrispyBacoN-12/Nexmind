import test from "node:test";
import assert from "node:assert/strict";
import { latestClosedSession, summaryDue } from "./summarySchedule";

const at = (iso: string) => Date.parse(iso);

test("latestClosedSession: a session counts only once its close is past the SIP delay", () => {
  assert.equal(latestClosedSession(at("2026-11-06T21:15:59Z")), "2026-11-05"); // Fri 16:15:59 ET
  assert.equal(latestClosedSession(at("2026-11-06T21:16:00Z")), "2026-11-06"); // Fri 16:16 ET
});

test("latestClosedSession: during a session it is the session before", () => {
  assert.equal(latestClosedSession(at("2026-11-06T15:39:00Z")), "2026-11-05"); // Fri 10:39 ET
});

test("latestClosedSession: a weekend and Monday before the close stay on Friday", () => {
  assert.equal(latestClosedSession(at("2026-11-07T12:00:00Z")), "2026-11-06"); // Sat
  assert.equal(latestClosedSession(at("2026-11-09T00:30:00Z")), "2026-11-06"); // Sun 19:30 ET
  assert.equal(latestClosedSession(at("2026-11-09T12:00:00Z")), "2026-11-06"); // Mon 07:00 ET
});

test("latestClosedSession: the evening after a close, before midnight ET", () => {
  assert.equal(latestClosedSession(at("2026-11-10T03:00:00Z")), "2026-11-09"); // Mon 22:00 ET
});

test("latestClosedSession: the close moves with daylight saving", () => {
  assert.equal(latestClosedSession(at("2026-07-01T20:15:59Z")), "2026-06-30");
  assert.equal(latestClosedSession(at("2026-07-01T20:16:00Z")), "2026-07-01");
});

test("summaryDue: sends once per closed session", () => {
  const now = at("2026-11-07T00:00:00Z"); // latest closed session is 2026-11-06
  assert.equal(summaryDue(now, ""), true, "never sent");
  assert.equal(summaryDue(now, "2026-11-04"), true, "older session sent, catches up");
  assert.equal(summaryDue(now, "2026-11-06"), false, "already sent");
  assert.equal(summaryDue(now, "2026-11-09"), false, "a newer mark never re-sends");
});
