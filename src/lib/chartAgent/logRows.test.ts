// Tests for toLogRows: the mapping from decided setups to ChartSetup rows.

import test from "node:test";
import assert from "node:assert/strict";
import type { Review } from "@/lib/chartAgent/review";
import type { Levels, Setup } from "@/lib/chartAgent/types";
import { toLogRows, type LogStatus } from "@/lib/chartAgent/logRows";

const LEVELS: Levels = {
  pPOC: 101,
  pVAH: 103,
  pVAL: 98,
  PDH: 104,
  PDL: 97,
  PMH: null,
  PML: null,
  dPOC: 100.5,
};

function setup(ticker: string, withT2: boolean): Setup {
  return {
    ticker,
    entry: 99,
    stop: 96.9,
    t1: { price: 102.15, names: ["pPOC"], r: 1.5 },
    t2: withT2 ? { price: 105.3, names: ["PDH"], r: 3 } : null,
    sweptLevels: ["PDL", "pVAL"],
    sweepBar: { t: 1_761_920_400, o: 99, h: 99.5, l: 97, c: 98.8, v: 1000 },
    tags: [],
    levels: LEVELS,
    dataAsOf: "2026-10-31T14:35:00.000Z",
  };
}

const KEPT: Review = { status: "kept", reading: "อ่านดี", reason: null };
const REJECTED: Review = { status: "rejected", reading: null, reason: "โครงสร้างอ่อน" };
const STRIPPED: Review = { status: "stripped", reading: null, reason: "ตัดออก: มีคำทำนาย" };

function d(ticker: string, withT2: boolean, review: Review, status: LogStatus) {
  return { setup: setup(ticker, withT2), review, status };
}

test("one shown, one rejected, one capped become three rows", () => {
  const rows = toLogRows(
    "run-1",
    [d("AAA", true, KEPT, "shown"), d("BBB", false, REJECTED, "ai_rejected"), d("CCC", true, KEPT, "capped")],
    "cli",
  );
  assert.deepEqual(
    rows.map((r) => [r.ticker, r.status]),
    [
      ["AAA", "shown"],
      ["BBB", "ai_rejected"],
      ["CCC", "capped"],
    ],
  );
  for (const r of rows) {
    assert.equal(r.runId, "run-1");
    assert.equal(r.aiBackend, "cli");
  }
});

test("t2 and r2 are null when the setup has no second target", () => {
  const [a, b] = toLogRows("r", [d("AAA", true, KEPT, "shown"), d("BBB", false, KEPT, "shown")], "cli");
  assert.equal(a.t2, 105.3);
  assert.equal(a.r2, 3);
  assert.equal(b.t2, null);
  assert.equal(b.r2, null);
  assert.equal(b.t1, 102.15);
  assert.equal(b.r1, 1.5);
});

test("aiRejectReason is set only on the ai_rejected row", () => {
  const rows = toLogRows(
    "r",
    [d("AAA", true, KEPT, "shown"), d("BBB", true, REJECTED, "ai_rejected"), d("CCC", true, STRIPPED, "guard_stripped")],
    "cli",
  );
  assert.equal(rows[0].aiRejectReason, null);
  assert.equal(rows[1].aiRejectReason, "โครงสร้างอ่อน");
  assert.equal(rows[2].aiRejectReason, null);
});

test("aiReading copies review.reading for every status", () => {
  const rows = toLogRows("r", [d("AAA", true, KEPT, "shown"), d("BBB", true, REJECTED, "ai_rejected")], "cli");
  assert.equal(rows[0].aiReading, "อ่านดี");
  assert.equal(rows[1].aiReading, null);
});

test("price fields, levels, sweptLevels and times carry over", () => {
  const [r] = toLogRows("r", [d("AAA", true, KEPT, "shown")], "cli");
  assert.equal(r.entry, 99);
  assert.equal(r.stop, 96.9);
  assert.deepEqual(r.sweptLevels, ["PDL", "pVAL"]);
  assert.deepEqual(r.levels, LEVELS);
  assert.equal(r.dataAsOf, "2026-10-31T14:35:00.000Z");
  assert.equal(r.sweepBarAt, new Date(1_761_920_400 * 1000).toISOString());
});

test("no decided setups give no rows", () => {
  assert.deepEqual(toLogRows("r", [], "cli"), []);
});
