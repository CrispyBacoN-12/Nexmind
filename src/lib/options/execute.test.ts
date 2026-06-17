import { test } from "node:test";
import assert from "node:assert/strict";
import { closePnl, clampContracts } from "./execute";

test("closePnl: contracts × 100 × (exitPremium − premiumPaid)", () => {
  assert.equal(closePnl(2, 5, 7), 2 * 100 * 2);     // +400
  assert.equal(closePnl(1, 5, 1), 1 * 100 * -4);    // -400
});

test("clampContracts: floor(cash / (100 × premium)); 0 when premium<=0 or no cash", () => {
  assert.equal(clampContracts(5, 1000, 12), 0); // wants 5, floor(1000/1200)=0 -> min(5,0)=0
  assert.equal(clampContracts(5, 6000, 12), 5); // floor(6000/1200)=5 -> min(5,5)=5
  assert.equal(clampContracts(5, 5000, 12), 4); // floor(5000/1200)=4
  assert.equal(clampContracts(5, 1000, 0), 0);
});
