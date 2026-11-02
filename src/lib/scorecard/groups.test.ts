import test from "node:test";
import assert from "node:assert/strict";
import { aiVerdictSample, beatsControl, groupOf, summarize } from "./groups";
import type { Outcome } from "./types";

const out = (over: Partial<Outcome>): Outcome => ({
  status: "closed", fillAt: 1, fill: 100, exitAt: 2, exitPrice: 101, exitReason: "time", r: 0.5, sessionsHeld: 1, ...over,
});

test("groupOf maps each status", () => {
  assert.equal(groupOf({ status: "ai_rejected", aiReading: "x" }), "vetoed");
  assert.equal(groupOf({ status: "ai_rejected", aiReading: null }), "vetoed");
  assert.equal(groupOf({ status: "guard_stripped", aiReading: null }), "stripped");
  assert.equal(groupOf({ status: "shown", aiReading: "x" }), "kept");
  assert.equal(groupOf({ status: "capped", aiReading: "x" }), "kept");
});

test("groupOf: shown or capped with null aiReading is unread, never kept", () => {
  assert.equal(groupOf({ status: "shown", aiReading: null }), "unread");
  assert.equal(groupOf({ status: "capped", aiReading: null }), "unread");
});

test("summarize ignores open and not_filled and computes win and T1 shares", () => {
  const s = summarize([
    out({ r: 1, exitReason: "t1" }),
    out({ r: -1, exitReason: "stop" }),
    out({ r: 0.2, exitReason: "time" }),
    out({ r: -0.1, exitReason: "time" }),
    out({ status: "open", r: null, exitReason: null }),
    out({ status: "not_filled", r: null, exitReason: null }),
    out({ status: "no_data", r: null, exitReason: null }),
  ]);
  assert.equal(s.n, 4);
  assert.ok(Math.abs(s.meanR! - 0.025) < 1e-12);
  assert.equal(s.winPct, 0.5);
  assert.equal(s.t1Pct, 0.25);
});

test("summarize is all null when nothing closed", () => {
  assert.deepEqual(summarize([out({ status: "open", r: null })]), { n: 0, meanR: null, winPct: null, t1Pct: null });
  assert.deepEqual(summarize([]), { n: 0, meanR: null, winPct: null, t1Pct: null });
});

type Row = { createdAt: Date; group: "kept" | "vetoed" | "stripped" | "unread"; hold: Outcome; windowElapsed: boolean; id: number };
const rows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i, createdAt: new Date(2026, 0, 1, 0, i), group: "kept", hold: out({}), windowElapsed: true,
  }));

test("aiVerdictSample takes the earliest 300 by createdAt from 305 kept rows", () => {
  const all = rows(305).reverse(); // unsorted input
  all.push({ ...rows(1)[0], id: 999, createdAt: new Date(2025, 0, 1), group: "vetoed" });
  const { sample, ready } = aiVerdictSample(all);
  assert.equal(sample.length, 300);
  assert.equal(sample[0].id, 0);
  assert.equal(sample[299].id, 299);
  assert.ok(!sample.some((r) => r.id === 999));
  assert.equal(ready, true);
});

test("aiVerdictSample is not ready with an open row or an unelapsed window", () => {
  const a = rows(300);
  a[150].hold = out({ status: "open", r: null });
  assert.equal(aiVerdictSample(a).ready, false);
  const b = rows(300);
  b[299].windowElapsed = false;
  assert.equal(aiVerdictSample(b).ready, false);
});

test("aiVerdictSample is not ready under 300 rows", () => {
  const r = aiVerdictSample(rows(299));
  assert.equal(r.sample.length, 299);
  assert.equal(r.ready, false);
});

test("aiVerdictSample skips not_filled and no_data kept rows", () => {
  const a = rows(301);
  a[0].hold = out({ status: "not_filled", r: null });
  a[1].hold = out({ status: "no_data", r: null });
  const { sample, ready } = aiVerdictSample(a);
  assert.equal(sample.length, 299);
  assert.ok(!sample.some((r) => r.id === 0 || r.id === 1));
  assert.equal(ready, false);
  const b = rows(302);
  b[0].hold = out({ status: "not_filled", r: null });
  const c = aiVerdictSample(b);
  assert.equal(c.sample.length, 300);
  assert.equal(c.sample[0].id, 1);
  assert.equal(c.ready, true);
});

test("beatsControl is strict", () => {
  const c = { runs: 3, avgRs: [0, 0.05, 0.1], median: 0.05, p95: 0.1 };
  assert.equal(beatsControl(0.1, c), false);
  assert.equal(beatsControl(0.1000001, c), true);
});
