import test from "node:test";
import assert from "node:assert/strict";

import { sizeShares } from "./sizing";

test("the worked example: both caps bind at 2 shares and the real risk is 0.72%", () => {
  const r = sizeShares({ entry: 180, slDistance: 9, capital: 2500, maxSlots: 5, riskPct: 1 });
  assert.equal(r.riskShares, 2);
  assert.equal(r.affordableShares, 2);
  assert.equal(r.shares, 2);
  assert.deepEqual(r.boundBy, ["risk", "affordability"]);
  assert.equal(r.slotBudget, 500);
  assert.equal(r.riskUsdTarget, 25);
  assert.equal(r.actualRiskUsd, 18);
  assert.ok(Math.abs(r.actualRiskPct - 0.72) < 1e-9);
});

test("risk alone binds when the share price is small", () => {
  const r = sizeShares({ entry: 10, slDistance: 9, capital: 2500, maxSlots: 5, riskPct: 1 });
  assert.equal(r.riskShares, 2);
  assert.equal(r.affordableShares, 50);
  assert.equal(r.shares, 2);
  assert.deepEqual(r.boundBy, ["risk"]);
});

test("affordability alone binds when the stop is tight and the share is dear", () => {
  const r = sizeShares({ entry: 180, slDistance: 0.5, capital: 2500, maxSlots: 5, riskPct: 1 });
  assert.equal(r.riskShares, 50);
  assert.equal(r.affordableShares, 2);
  assert.equal(r.shares, 2);
  assert.deepEqual(r.boundBy, ["affordability"]);
  assert.equal(r.actualRiskUsd, 1);
});

test("zero shares because one share costs more than the slot budget, and it says so", () => {
  const r = sizeShares({ entry: 600, slDistance: 9, capital: 2500, maxSlots: 5, riskPct: 1 });
  assert.equal(r.affordableShares, 0);
  assert.equal(r.shares, 0);
  assert.equal(r.actualRiskUsd, 0);
  assert.match(r.reason, /slot budget/);
  assert.match(r.reason, /\$600\.00/);
});

test("zero shares because one share risks more than the whole risk budget, and it says so", () => {
  const r = sizeShares({ entry: 100, slDistance: 30, capital: 2500, maxSlots: 5, riskPct: 1 });
  assert.equal(r.riskShares, 0);
  assert.equal(r.shares, 0);
  assert.match(r.reason, /risk budget/);
  assert.match(r.reason, /\$30\.00/);
});

test("a non-positive stop distance is refused with a reason, not silently zeroed", () => {
  const r = sizeShares({ entry: 180, slDistance: 0, capital: 2500, maxSlots: 5, riskPct: 1 });
  assert.equal(r.shares, 0);
  assert.deepEqual(r.boundBy, []);
  assert.match(r.reason, /stop distance/i);
});

test("a non-positive slot count is refused with a reason", () => {
  const r = sizeShares({ entry: 180, slDistance: 9, capital: 2500, maxSlots: 0, riskPct: 1 });
  assert.equal(r.shares, 0);
  assert.match(r.reason, /slot/i);
});

test("no input can produce a fractional share", () => {
  for (const entry of [1.07, 33.33, 180, 999.99]) {
    for (const slDistance of [0.07, 1.3, 9, 44.4]) {
      for (const capital of [500, 2500, 137.5]) {
        for (const maxSlots of [1, 3, 5, 7]) {
          const r = sizeShares({ entry, slDistance, capital, maxSlots, riskPct: 1 });
          assert.ok(Number.isInteger(r.shares), `fractional shares for ${entry}/${slDistance}/${capital}/${maxSlots}`);
          assert.ok(Number.isInteger(r.riskShares));
          assert.ok(Number.isInteger(r.affordableShares));
          assert.ok(r.shares >= 0);
          assert.ok(r.reason.length > 0);
        }
      }
    }
  }
});
