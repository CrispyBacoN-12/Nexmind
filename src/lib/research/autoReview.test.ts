import { test } from "node:test";
import assert from "node:assert/strict";
import { autoReviewStatus, MIN_TRADES, MIN_PROFIT_FACTOR } from "./autoReview";
import type { BacktestSummary } from "@/lib/backtest/engine";

function summary(overrides: Partial<BacktestSummary> = {}): BacktestSummary {
  return {
    trades: MIN_TRADES,
    wins: MIN_TRADES,
    losses: 0,
    winRate: 100,
    totalPnl: 100,
    avgR: 1,
    expectancy: 5,
    profitFactor: MIN_PROFIT_FACTOR,
    maxDrawdownPct: 1,
    sharpeRatio: 1,
    sortinoRatio: 1,
    totalCostsUsd: 0,
    ...overrides,
  };
}

test("autoReviewStatus rejects a safety-flagged candidate regardless of stats", () => {
  assert.equal(autoReviewStatus(summary({ profitFactor: 10, trades: 500 }), true), "rejected");
});

test("autoReviewStatus rejects too few trades", () => {
  assert.equal(autoReviewStatus(summary({ trades: MIN_TRADES - 1 }), false), "rejected");
});

test("autoReviewStatus rejects a low profit factor", () => {
  assert.equal(autoReviewStatus(summary({ profitFactor: MIN_PROFIT_FACTOR - 0.01 }), false), "rejected");
});

test("autoReviewStatus approves a null profit factor (zero losing trades)", () => {
  assert.equal(autoReviewStatus(summary({ profitFactor: null, losses: 0 }), false), "approved");
});

test("autoReviewStatus approves a candidate that clears every bar", () => {
  assert.equal(autoReviewStatus(summary({ trades: MIN_TRADES, profitFactor: MIN_PROFIT_FACTOR }), false), "approved");
});

test("autoReviewStatus rejects a legacy losing strategy with no profitFactor field at all", () => {
  // Rows from before profitFactor existed in BacktestSummary have the key
  // missing entirely (undefined), not set to null - must not be treated as
  // "zero losing trades" and pass through.
  const legacy = summary({ trades: 25, expectancy: -20.69, totalPnl: -517.28 });
  delete (legacy as Partial<BacktestSummary>).profitFactor;
  assert.equal(autoReviewStatus(legacy, false), "rejected");
});

test("autoReviewStatus approves a legacy profitable strategy with no profitFactor field", () => {
  const legacy = summary({ trades: 30, expectancy: 0.796, totalPnl: 23.88 });
  delete (legacy as Partial<BacktestSummary>).profitFactor;
  assert.equal(autoReviewStatus(legacy, false), "approved");
});
