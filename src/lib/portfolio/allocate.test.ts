import assert from "node:assert/strict";
import { test } from "node:test";

import { allocateSlots, type AllocationContext, type RankedCandidate } from "./allocate";

const ctx = (over: Partial<AllocationContext> = {}): AllocationContext => ({
  today: "2026-09-25",
  slots: [],
  navHistory: [{ date: "2026-09-25", nav: 100_000 }],
  regime: { spyClose: 110, spySma200: 100 },
  correlationOf: () => 0.1,
  ...over,
});
const c = (ticker: string, score: number, sector: RankedCandidate["sector"] = "Energy"): RankedCandidate => ({
  ticker, score, sector, baseShares: 10, entry: 100, stop: 90, worstLossR: 1.5,
});

test("fills free slots highest score first, ticker breaking ties", () => {
  const cands = [
    c("B", 5, "Energy"), c("A", 5, "Utilities"), c("C", 9, "Materials"),
    c("D", 1, "Financials"), c("E", 3, "Industrials"), c("F", 2, "Health Care"),
  ];
  const out = allocateSlots(ctx(), cands);
  assert.deepEqual(out.accepted.map((a) => a.ticker), ["C", "A", "B", "E", "F"]);
  assert.deepEqual(out.rejected.map((r) => [r.ticker, r.blockedBy]), [["D", ["CAPACITY", "REGIME"]]]);
});

test("a name accepted earlier in the session counts against later ones", () => {
  // Three Energy names: the third hits the 2-per-sector cap.
  const out = allocateSlots(ctx(), [c("X", 3), c("Y", 2), c("Z", 1)]);
  assert.deepEqual(out.accepted.map((a) => a.ticker), ["X", "Y"]);
  assert.deepEqual(out.rejected[0].blockedBy, ["SECTOR"]);
});

test("correlation is checked against names filled this session", () => {
  const corr = (a: string, b: string) => ([a, b].sort().join() === "P,Q" ? 0.9 : 0.1);
  const out = allocateSlots(ctx({ correlationOf: corr }), [c("P", 2, "Energy"), c("Q", 1, "Utilities")]);
  assert.deepEqual(out.accepted.map((a) => a.ticker), ["P"]);
  assert.deepEqual(out.rejected[0].blockedBy, ["CORRELATION"]);
});

test("strict: a missing NAV log rejects everything rather than guessing", () => {
  const out = allocateSlots(ctx({ navHistory: [] }), [c("A", 1)]);
  assert.equal(out.accepted.length, 0);
  assert.deepEqual(out.rejected[0].blockedBy, ["DRAWDOWN", "GAP_HEAT"]);
});
