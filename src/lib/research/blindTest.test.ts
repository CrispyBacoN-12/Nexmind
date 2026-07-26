import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateHoldout } from "./blindTest";
import type { BacktestSummary } from "@/lib/backtest/engine";

function summary(overrides: Partial<BacktestSummary> = {}): BacktestSummary {
  return {
    trades: 50,
    wins: 30,
    losses: 20,
    winRate: 60,
    totalPnl: 500,
    avgR: 0.3,
    expectancy: 10,
    profitFactor: 1.5,
    maxDrawdownPct: -5,
    sharpeRatio: 1,
    sortinoRatio: 1,
    totalCostsUsd: 10,
    ...overrides,
  };
}

test("evaluateHoldout: passes when both halves are positive with enough trades", () => {
  const v = evaluateHoldout(summary({ expectancy: 8 }), summary({ trades: 50, expectancy: 10 }));
  assert.equal(v.passed, true);
  assert.deepEqual(v.reasons, []);
});

test("evaluateHoldout: fails on too few held-out trades", () => {
  const v = evaluateHoldout(summary({ expectancy: 8 }), summary({ trades: 12, expectancy: 10 }));
  assert.equal(v.passed, false);
  assert.ok(v.reasons.some((r) => /too few held-out trades/.test(r)));
});

test("evaluateHoldout: fails when held-out expectancy is not positive", () => {
  const v = evaluateHoldout(summary({ expectancy: 8 }), summary({ trades: 50, expectancy: -2 }));
  assert.equal(v.passed, false);
  assert.ok(v.reasons.some((r) => /held-out expectancy is not positive/.test(r)));
});

test("evaluateHoldout: fails on an inverted train/test split", () => {
  // in-sample net-negative, held-out looks positive - the combo-gold pattern.
  const v = evaluateHoldout(summary({ expectancy: -5 }), summary({ trades: 50, expectancy: 10 }));
  assert.equal(v.passed, false);
  assert.ok(v.reasons.some((r) => /inverted train\/test split/.test(r)));
});

test("evaluateHoldout: a negative held-out result is not also flagged as inverted", () => {
  const v = evaluateHoldout(summary({ expectancy: -5 }), summary({ trades: 50, expectancy: -1 }));
  assert.equal(v.passed, false);
  assert.equal(v.reasons.length, 1);
  assert.ok(/held-out expectancy is not positive/.test(v.reasons[0]));
});
