import { test } from "node:test";
import assert from "node:assert/strict";
import { sizeWithRL, type RLSession, type RLState, type RLSizingContext } from "./rlSizer";

const state: RLState = { proxyConfidence: 0.6, atr: 2, adx: 30, bbWidth: 0.02, exposurePct: 0, cashPct: 1, drawdownPct: 0 };
// slDistance=3, riskUsd=30 -> fullLot=10, so weight scaling is visible without
// every case hitting the maxLotPerTrade clamp.
const ctx: RLSizingContext = { entry: 2000, sl: 1997, riskUsd: 30, maxLotPerTrade: 5, minLot: 0.01 };

function mockSession(weight: number): RLSession {
  return { run: async () => weight };
}

test("sizeWithRL: full-conviction weight clamps to maxLotPerTrade", async () => {
  const result = await sizeWithRL(state, ctx, mockSession(1.0));
  assert.equal(result.available, true);
  assert.equal(result.vetoed, false);
  assert.equal(result.lot, 5); // fullLot=10 * 1.0 = 10, clamped to maxLotPerTrade=5
});

test("sizeWithRL: partial weight scales the lot proportionally below the clamp", async () => {
  const result = await sizeWithRL(state, ctx, mockSession(0.3));
  assert.equal(result.lot, 3); // fullLot=10 * 0.3 = 3, under maxLotPerTrade=5
});

test("sizeWithRL: weight that converts to a lot below minLot is a veto, not a round-up", async () => {
  const result = await sizeWithRL(state, ctx, mockSession(0.0001));
  assert.equal(result.available, true);
  assert.equal(result.vetoed, true);
  assert.equal(result.lot, 0);
});

test("sizeWithRL: out-of-range model output is clamped to 0..1 before conversion", async () => {
  const result = await sizeWithRL(state, ctx, mockSession(5.0));
  assert.equal(result.weight, 1);
});

test("sizeWithRL: NaN model output is treated as zero weight, not a crash", async () => {
  const result = await sizeWithRL(state, ctx, mockSession(NaN));
  assert.equal(result.weight, 0);
  assert.equal(result.vetoed, true);
});

test("sizeWithRL: a session that throws during inference reports available: false", async () => {
  const throwing: RLSession = { run: async () => { throw new Error("onnx runtime error"); } };
  const result = await sizeWithRL(state, ctx, throwing);
  assert.deepEqual(result, { available: false, weight: 0, lot: 0, vetoed: false });
});
