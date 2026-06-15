import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStats, type ClosedTrade } from "./stats";

function trade(pnl: number, day: string, rMultiple: number | null = null, outcome: string | null = null): ClosedTrade {
  return { pnl, rMultiple, outcome, closedAt: new Date(day) };
}

test("computeStats: empty input returns zeros and nulls", () => {
  const s = computeStats([]);
  assert.equal(s.trades, 0);
  assert.equal(s.maxDrawdown, 0);
  assert.equal(s.maxDrawdownPct, null);
  assert.equal(s.sharpeRatio, null);
  assert.equal(s.sortinoRatio, null);
});

test("computeStats: single trade has no Sharpe/Sortino (needs 2+ days)", () => {
  const s = computeStats([trade(100, "2026-06-01")]);
  assert.equal(s.trades, 1);
  assert.equal(s.pnl, 100);
  assert.equal(s.sharpeRatio, null);
  assert.equal(s.sortinoRatio, null);
});

test("computeStats: constant daily P/L has zero variance, so Sharpe/Sortino are null", () => {
  const s = computeStats([trade(100, "2026-06-01"), trade(100, "2026-06-02"), trade(100, "2026-06-03")]);
  assert.equal(s.sharpeRatio, null);
  assert.equal(s.sortinoRatio, null);
});

test("computeStats: positive Sharpe/Sortino when daily P/L is mostly positive", () => {
  const s = computeStats([trade(100, "2026-06-01"), trade(-20, "2026-06-02"), trade(150, "2026-06-03")]);
  assert.ok(s.sharpeRatio !== null && s.sharpeRatio > 0);
  assert.ok(s.sortinoRatio !== null && s.sortinoRatio > 0);
  // Sortino only penalizes downside, so it should be higher than Sharpe here.
  assert.ok(s.sortinoRatio! > s.sharpeRatio!);
});

test("computeStats: maxDrawdownPct reflects the largest peak-to-trough as % of starting balance", () => {
  // Equity curve: +100 -> peak 100, -50 -> 50 (drawdown of 50), +10 -> 60
  const s = computeStats([trade(100, "2026-06-01"), trade(-50, "2026-06-02"), trade(10, "2026-06-03")], 100);
  assert.equal(s.maxDrawdown, 50);
  assert.ok(s.maxDrawdownPct !== null);
  assert.ok(Math.abs(s.maxDrawdownPct! - -50) < 1e-9);
});

test("computeStats: maxDrawdownPct scales with starting balance", () => {
  const s = computeStats([trade(100, "2026-06-01"), trade(-50, "2026-06-02"), trade(10, "2026-06-03")], 10000);
  assert.equal(s.maxDrawdown, 50);
  assert.ok(Math.abs(s.maxDrawdownPct! - -0.5) < 1e-9);
});

test("computeStats: no drawdown means maxDrawdownPct is 0", () => {
  const s = computeStats([trade(100, "2026-06-01"), trade(50, "2026-06-02")], 10000);
  assert.equal(s.maxDrawdown, 0);
  assert.equal(s.maxDrawdownPct, 0);
});
