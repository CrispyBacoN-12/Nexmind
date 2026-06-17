import { test } from "node:test";
import assert from "node:assert/strict";
import { computeOptionStats, settlementValue, type OptionPosition } from "./optionStats";

function p(over: Partial<OptionPosition> = {}): OptionPosition {
  return { id: 1, underlying: "AAPL", type: "call", strike: 100, status: "open", contracts: 1, premiumPaid: 5, realizedPnl: 0, ...over };
}

test("settlementValue: intrinsic per share for call and put", () => {
  assert.equal(settlementValue("call", 100, 120), 20);
  assert.equal(settlementValue("call", 100, 80), 0);
  assert.equal(settlementValue("put", 100, 80), 20);
  assert.equal(settlementValue("put", 100, 120), 0);
});

test("computeOptionStats: equity = cash + market value; unrealized = MV - cost", () => {
  const positions = [p({ id: 1, contracts: 2, premiumPaid: 5 })]; // cost = 2*100*5 = 1000
  const s = computeOptionStats(positions, () => 7, 4000);          // MV = 2*100*7 = 1400
  assert.equal(s.marketValue, 1400);
  assert.equal(s.equity, 5400);
  assert.equal(s.unrealizedPnl, 400);
});

test("computeOptionStats: realizedPnl sums all positions; sold excluded from MV", () => {
  const positions = [p({ id: 1, status: "open", contracts: 1, premiumPaid: 5, realizedPnl: 0 }), p({ id: 2, status: "closed", contracts: 0, realizedPnl: 300 })];
  const s = computeOptionStats(positions, () => 5, 1000);
  assert.equal(s.realizedPnl, 300);
  assert.equal(s.marketValue, 500); // only the open one: 1*100*5
});

test("computeOptionStats: missing premium falls back to premiumPaid and is flagged", () => {
  const positions = [p({ id: 1, underlying: "AAPL", type: "call", strike: 100, contracts: 1, premiumPaid: 5 })];
  const s = computeOptionStats(positions, () => null, 0);
  assert.equal(s.marketValue, 500); // 1*100*premiumPaid 5
  assert.equal(s.unrealizedPnl, 0);
  assert.deepEqual(s.missingPremiums, ["AAPL call 100"]);
});
