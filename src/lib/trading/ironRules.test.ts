import { test } from "node:test";
import assert from "node:assert/strict";
import { applyIronRules, riskReward, type ProposedTrade, type AccountState } from "./ironRules";

const baseAcc: AccountState = {
  maxLotPerTrade: 0.5,
  maxSpread: 0.5,
  minRiskReward: 1.5,
};

const goodLong: ProposedTrade = { symbol: "XAUUSD", side: "long", entry: 2350, sl: 2340, tp1: 2370, lot: 0.1, spread: 0.2 };

test("riskReward computes side-aware ratio", () => {
  assert.equal(riskReward(goodLong), 2); // reward 20 / risk 10
  const short: ProposedTrade = { ...goodLong, side: "short", entry: 2350, sl: 2360, tp1: 2330 };
  assert.equal(riskReward(short), 2);
});

test("riskReward returns 0 for inverted levels", () => {
  assert.equal(riskReward({ ...goodLong, tp1: 2345 }), 0); // reward negative
  assert.equal(riskReward({ ...goodLong, sl: 2355 }), 0); // risk negative for a long
});

test("a clean trade passes", () => {
  const v = applyIronRules(goodLong, baseAcc);
  assert.equal(v.passed, true);
  assert.deepEqual(v.failures, []);
});

test("low R:R is rejected", () => {
  const v = applyIronRules({ ...goodLong, tp1: 2355 }, baseAcc); // R:R 0.5
  assert.equal(v.passed, false);
  assert.match(v.failures[0], /R:R/);
});

test("oversized lot is rejected", () => {
  const v = applyIronRules({ ...goodLong, lot: 1.0 }, baseAcc);
  assert.equal(v.passed, false);
  assert.ok(v.failures.some((f) => /lot/.test(f)));
});

test("wide spread is rejected", () => {
  const v = applyIronRules({ ...goodLong, spread: 1.0 }, baseAcc);
  assert.equal(v.passed, false);
  assert.ok(v.failures.some((f) => /spread/.test(f)));
});

test("kill switch blocks all new trades", () => {
  const v = applyIronRules(goodLong, { ...baseAcc, killSwitch: true });
  assert.equal(v.passed, false);
  assert.ok(v.failures.some((f) => /kill switch/.test(f)));
});

test("max open positions blocks when at the cap", () => {
  const v = applyIronRules(goodLong, { ...baseAcc, openPositions: 5, maxOpenPositions: 5 });
  assert.equal(v.passed, false);
  assert.ok(v.failures.some((f) => /max open positions/.test(f)));
});

test("below the position cap still passes", () => {
  const v = applyIronRules(goodLong, { ...baseAcc, openPositions: 4, maxOpenPositions: 5 });
  assert.equal(v.passed, true);
});

test("applyIronRules: global trading halt blocks every new trade", () => {
  const t = { symbol: "AAPL", side: "long" as const, entry: 100, sl: 98, tp1: 106, lot: 0.1 };
  const acc = {
    maxLotPerTrade: 0.2, minRiskReward: 1.5, globalTradingHalt: true,
  };
  const v = applyIronRules(t, acc);
  assert.equal(v.passed, false);
  assert.ok(v.failures.some((f) => /global trading halt/i.test(f)));
});
