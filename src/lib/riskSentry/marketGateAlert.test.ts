import { test } from "node:test";
import assert from "node:assert/strict";
import type { GateDecision } from "@/lib/market/marketGate";
import { marketGateAlert } from "./marketGateAlert";

function gate(benchAbove: boolean | null): GateDecision {
  return { slots: 0, benchAbove, shortsAllowed: true, note: "test gate" };
}

test("above to below is a flip", () => {
  const r = marketGateAlert(gate(false), "above");
  assert.equal(r.flipped, true);
  assert.equal(r.from, "above");
  assert.equal(r.to, "below");
});

test("below to above is a flip", () => {
  const r = marketGateAlert(gate(true), "below");
  assert.equal(r.flipped, true);
  assert.equal(r.from, "below");
  assert.equal(r.to, "above");
});

test("above to above is not a flip", () => {
  assert.equal(marketGateAlert(gate(true), "above").flipped, false);
});

test("below to below is not a flip", () => {
  assert.equal(marketGateAlert(gate(false), "below").flipped, false);
});

test("unknown on either side never counts as a flip", () => {
  assert.equal(marketGateAlert(gate(null), "above").flipped, false, "reading BLIND is not a flip away from above");
  assert.equal(marketGateAlert(gate(true), "unknown").flipped, false, "a first-ever reading is not a flip from unknown");
  assert.equal(marketGateAlert(gate(null), "unknown").flipped, false);
});

test("a fresh install does not fire on its first run", () => {
  const r = marketGateAlert(gate(true), "unknown");
  assert.equal(r.flipped, false);
  assert.equal(r.to, "above");
});
