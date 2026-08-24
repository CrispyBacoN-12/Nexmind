import "dotenv/config"; // blindTest.ts imports prisma at module scope — needs DATABASE_URL to construct, same as other DB-touching scripts
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateHoldout, applyBlindTestVerdict, blindTestOrchestrationFailure } from "./blindTest";
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

test("applyBlindTestVerdict: a passing verdict keeps an approved candidate approved", () => {
  const verdict = {
    strategy: { id: 1, label: "X" },
    symbol: "AAPL",
    range: "2y" as const,
    totalBars: 500,
    holdoutBars: 120,
    holdoutDays: 365,
    inSample: summary(),
    holdout: summary(),
    passed: true,
    reasons: [],
  };
  const applied = applyBlindTestVerdict("approved", verdict);
  assert.equal(applied.status, "approved");
  assert.deepEqual(JSON.parse(applied.blindTestJson), verdict);
});

test("applyBlindTestVerdict: a failing verdict demotes an approved candidate to rejected", () => {
  const verdict = {
    strategy: { id: 1, label: "X" },
    symbol: "AAPL",
    range: "2y" as const,
    totalBars: 500,
    holdoutBars: 120,
    holdoutDays: 365,
    inSample: summary(),
    holdout: summary({ expectancy: -1 }),
    passed: false,
    reasons: ["held-out expectancy is not positive (-1)"],
  };
  const applied = applyBlindTestVerdict("approved", verdict);
  assert.equal(applied.status, "rejected");
});

test("applyBlindTestVerdict: an unfetchable/error verdict rejects conservatively rather than trusting the in-sample pass", () => {
  const applied = applyBlindTestVerdict("approved", { error: "AAPL: could not fetch enough deep history" });
  assert.equal(applied.status, "rejected");
  const parsed = JSON.parse(applied.blindTestJson);
  assert.ok(/Lean conservative/.test(parsed.reasons[0]));
});

test("applyBlindTestVerdict: a candidate already rejected in-sample passes through unchanged (blind test is never run for it)", () => {
  const applied = applyBlindTestVerdict("rejected", { error: "should not matter — status was never approved" });
  assert.equal(applied.status, "rejected");
});

// ---- blindTestOrchestrationFailure ----
// Covers runResearch.ts's catch path around runBlindTest()/update(): if that
// sequence throws (e.g. a Neon connection hiccup) instead of runBlindTest()
// returning its normal `{error}` result, the candidate must still end up
// rejected with an error-shaped blindTest payload — never left "approved"
// with an empty/default blindTest column indistinguishable from a real pass.

test("blindTestOrchestrationFailure: rejects and records a thrown Error's message", () => {
  const failed = blindTestOrchestrationFailure(new Error("Connection terminated unexpectedly"));
  assert.equal(failed.status, "rejected");
  const parsed = JSON.parse(failed.blindTestJson);
  assert.ok(/Lean conservative/.test(parsed.reasons[0]));
  assert.ok(/Connection terminated unexpectedly/.test(parsed.error));
});

test("blindTestOrchestrationFailure: handles a non-Error thrown value without crashing", () => {
  const failed = blindTestOrchestrationFailure("boom");
  assert.equal(failed.status, "rejected");
  const parsed = JSON.parse(failed.blindTestJson);
  assert.ok(/boom/.test(parsed.error));
});

test("blindTestOrchestrationFailure produces the same shape as applyBlindTestVerdict's own {error} branch", () => {
  const viaOrchestrationFailure = blindTestOrchestrationFailure(new Error("db down"));
  const viaDirectError = applyBlindTestVerdict("approved", { error: "blind-test orchestration threw: db down" });
  assert.deepEqual(viaOrchestrationFailure, viaDirectError);
});
