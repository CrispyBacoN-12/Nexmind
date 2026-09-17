// The whole point of this module is that two surfaces print the SAME string, so
// these are string tests on purpose. The one thing they guard above all others:
// "unknown" and "none scheduled" must never collapse into each other. A dead API
// key that reads as "no earnings coming" is the failure this project keeps
// catching in other forms, and here it would be one ?? away.

import { test } from "node:test";
import assert from "node:assert/strict";

import { daysBetween, earningsPhrase } from "./earningsPhrase";

test("daysBetween: counts whole calendar days and signs them", () => {
  assert.equal(daysBetween("2026-09-10", "2026-09-13"), 3);
  assert.equal(daysBetween("2026-09-10", "2026-09-10"), 0);
  assert.equal(daysBetween("2026-09-10", "2026-09-07"), -3);
  // Across a month boundary and a DST shift, which is why the arithmetic is in UTC.
  assert.equal(daysBetween("2026-10-30", "2026-11-03"), 4);
  assert.equal(daysBetween("not a date", "2026-09-13"), null);
});

test("earningsPhrase: a known date carries the session and the distance", () => {
  const s = earningsPhrase({ date: "2026-09-13", hour: "amc" }, "2026-09-10");
  assert.match(s, /2026-09-13/);
  assert.match(s, /หลังตลาดปิด/);
  assert.match(s, /3 วัน/);
});

test("earningsPhrase: an unrecognised session tag is passed through, not dropped", () => {
  assert.match(earningsPhrase({ date: "2026-09-13", hour: "xyz" }, "2026-09-10"), /xyz/);
});

test("earningsPhrase: a missing lookup and a missing date say different things", () => {
  const noLookup = earningsPhrase(null, "2026-09-10");
  const noneFound = earningsPhrase({ date: null, hour: null, note: "no report scheduled in the next 120 days" }, "2026-09-10");
  assert.match(noLookup, /^ไม่ทราบ/);
  assert.match(noLookup, /ยังไม่ได้ค้นหา/);
  assert.match(noneFound, /^ไม่ทราบ/);
  assert.match(noneFound, /no report scheduled/);
  assert.notEqual(noLookup, noneFound);
});

test("earningsPhrase: a null date always says WHY, even with no note recorded", () => {
  assert.match(earningsPhrase({ date: null, hour: null }, "2026-09-10"), /ไม่ทราบ — ไม่ได้บันทึกเหตุผลไว้/);
});

test("earningsPhrase: a date behind the as-of date is labelled as already reported", () => {
  assert.match(earningsPhrase({ date: "2026-09-07", hour: "bmo" }, "2026-09-10"), /ประกาศไปแล้ว 3 วัน/);
});

test("earningsPhrase: the as-of date itself is not reported as zero days away", () => {
  assert.match(earningsPhrase({ date: "2026-09-10", hour: null }, "2026-09-10"), /ตรงกับวันที่การ์ดนี้อ้างอิงพอดี/);
});
