import "dotenv/config"; // blindTest.ts imports prisma at module scope — needs DATABASE_URL to construct, same as other DB-touching scripts
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateHoldout, applyBlindTestVerdict, blindTestOrchestrationFailure, type PanelBlindTestReport } from "./blindTest";
import { PANEL_VALIDATION, TEST_FOLDS } from "./panel";
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

test("evaluateHoldout: fails when the held-out profit factor is below the in-sample bar", () => {
  const v = evaluateHoldout(summary(), summary({ trades: 50, profitFactor: 1.04 }));
  assert.equal(v.passed, false);
  assert.ok(v.reasons.some((r) => /held-out profit factor 1\.04 is below the 1\.1 bar/.test(r)));
});

test("evaluateHoldout: a null held-out profit factor means zero losing trades, not a low ratio", () => {
  const v = evaluateHoldout(summary(), summary({ trades: 50, profitFactor: null }));
  assert.equal(v.passed, true);
});

test("evaluateHoldout: fails when the held-out edge keeps less than half of in-sample", () => {
  // The case this bar exists for: in-sample avgR 0.63 -> held-out 0.063, a 10x
  // collapse that the old expectancy>0 gate passed.
  const v = evaluateHoldout(summary({ avgR: 0.63 }), summary({ trades: 50, avgR: 0.063 }));
  assert.equal(v.passed, false);
  assert.ok(v.reasons.some((r) => /held-out avgR kept only 10% of in-sample \(0\.630 → 0\.063\)/.test(r)));
});

test("evaluateHoldout: retention exactly at the floor passes", () => {
  const v = evaluateHoldout(summary({ avgR: 0.4 }), summary({ trades: 50, avgR: 0.2 }));
  assert.equal(v.passed, true);
});

test("evaluateHoldout: a held-out edge stronger than in-sample is not penalised", () => {
  const v = evaluateHoldout(summary({ avgR: 0.2 }), summary({ trades: 50, avgR: 0.5 }));
  assert.equal(v.passed, true);
});

test("evaluateHoldout: falls back to expectancy when either side predates avgR", () => {
  const v = evaluateHoldout(summary({ avgR: null, expectancy: 20 }), summary({ trades: 50, avgR: null, expectancy: 4 }));
  assert.equal(v.passed, false);
  assert.ok(v.reasons.some((r) => /held-out expectancy kept only 20% of in-sample \(20\.00 → 4\.00\)/.test(r)));
});

test("evaluateHoldout: a negative held-out result is not also reported as poor retention", () => {
  const v = evaluateHoldout(summary({ avgR: 0.63 }), summary({ trades: 50, avgR: -0.4, expectancy: -2 }));
  assert.equal(v.passed, false);
  assert.equal(v.reasons.length, 1);
  assert.ok(/held-out expectancy is not positive/.test(v.reasons[0]));
});

/** A minimal panel verdict, shaped as runBlindTest returns it. */
function panelVerdict(overrides: { passed?: boolean; foldPassed?: boolean; reasons?: string[] } = {}): PanelBlindTestReport {
  const foldPassed = overrides.foldPassed ?? overrides.passed ?? true;
  return {
    strategy: { id: 1, label: "X" },
    validation: PANEL_VALIDATION,
    panel: { cachePath: ".cache/bars/sp500-1d.json", fetchedAt: "2026-08-14T00:00:00.000Z", symbols: 491 },
    caveat: "survivorship",
    bar: { minTrades: 200, minSymbols: 100, controlRuns: 200, bootstrapRuns: 1000 },
    fit: summary(),
    folds: TEST_FOLDS.map((f) => ({
      fold: f.name,
      from: f.from,
      to: f.to,
      regime: f.regime,
      symbolsInFold: 480,
      symbolsTraded: 300,
      summary: summary({ trades: 400 }),
      control: { runs: 200, avgRs: [], median: 0.05, p95: 0.12 },
      bootstrap: { runs: 1000, blocks: 24, p5: 0.04, p50: 0.3, p95: 0.6 },
      passed: foldPassed,
      reasons: foldPassed ? [] : (overrides.reasons ?? ["fold failed"]),
    })),
    passed: overrides.passed ?? true,
    reasons: (overrides.passed ?? true) ? [] : (overrides.reasons ?? ["fold failed"]),
  };
}

test("applyBlindTestVerdict: a passing verdict keeps an approved candidate approved", () => {
  const verdict = panelVerdict({ passed: true });
  const applied = applyBlindTestVerdict("approved", verdict);
  assert.equal(applied.status, "approved");
  assert.deepEqual(JSON.parse(applied.blindTestJson), verdict);
});

test("applyBlindTestVerdict: a failing verdict demotes an approved candidate to rejected", () => {
  const applied = applyBlindTestVerdict("approved", panelVerdict({ passed: false }));
  assert.equal(applied.status, "rejected");
});

test("applyBlindTestVerdict: one dead fold sinks the whole verdict, however good the others look", () => {
  // The research-29 shape: strong in one regime, dead in another. Averaging
  // would have passed it. runBlindTest ANDs the folds, so this is the contract
  // that has to hold at the decision layer too.
  const verdict = panelVerdict({ passed: false, reasons: ["[test2] avgR does not beat the random-entry control's p95"] });
  verdict.folds[0].passed = true;
  verdict.folds[0].reasons = [];
  assert.equal(applyBlindTestVerdict("approved", verdict).status, "rejected");
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
