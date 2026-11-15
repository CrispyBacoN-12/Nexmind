// Tests for decideSetups: the shared status decision.

import test from "node:test";
import assert from "node:assert/strict";
import type { Review } from "@/lib/chartAgent/review";
import type { Setup } from "@/lib/chartAgent/types";
import { decideSetups } from "@/lib/chartAgent/decide";

function setup(ticker: string): Setup {
  return {
    ticker,
    entry: 99,
    stop: 96.9,
    t1: { price: 102.15, names: ["pPOC"], r: 1.5 },
    t2: null,
    sweptLevels: ["PDL"],
    sweepBar: { t: 1_761_920_400, o: 99, h: 99.5, l: 97, c: 98.8, v: 1000 },
    tags: [],
    levels: {
      pPOC: 101, pVAH: 103, pVAL: 98, PDH: 104, PDL: 97, PMH: null, PML: null, dPOC: 100.5,
    },
    dataAsOf: "2026-10-31T14:35:00.000Z",
  };
}

const KEPT: Review = { status: "kept", reading: "อ่านดี", reason: null };
const REJECTED: Review = { status: "rejected", reading: null, reason: "โครงสร้างอ่อน" };
const STRIPPED: Review = { status: "stripped", reading: null, reason: "ตัดออก: มีคำทำนาย" };

test("keeps input order and caps after 5 eligible", () => {
  const names = ["A", "B", "C", "D", "E", "F", "G"];
  const reviews = new Map(names.map((n) => [n, KEPT]));
  const out = decideSetups(names.map(setup), reviews);
  assert.deepEqual(out.map((o) => o.setup.ticker), names);
  assert.deepEqual(out.map((o) => o.status), [
    "shown", "shown", "shown", "shown", "shown", "capped", "capped",
  ]);
});

test("rejected and stripped do not use a shown slot", () => {
  const names = ["R", "A", "B", "C", "D", "E", "S", "G"];
  const reviews = new Map<string, Review>(names.map((n) => [n, KEPT]));
  reviews.set("R", REJECTED);
  reviews.set("S", STRIPPED);
  const out = decideSetups(names.map(setup), reviews);
  assert.deepEqual(out.map((o) => o.status), [
    "ai_rejected", "shown", "shown", "shown", "shown", "shown", "guard_stripped", "capped",
  ]);
});

test("a missing review is unread and still eligible", () => {
  const out = decideSetups([setup("X")], new Map());
  assert.equal(out[0].status, "shown");
  assert.equal(out[0].review.status, "unread");
  assert.equal(out[0].review.reading, null);
  assert.equal(out[0].review.reason, "AI ไม่ได้อ่าน");
});
