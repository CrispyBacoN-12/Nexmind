import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluatePortfolio, readNav } from "./evaluate";
import type { CandidateTrade, GateName, PortfolioEvaluationInput, PortfolioSlot } from "./types";

// NAV 10,000; each position risks $100 = 1% (10 shares x $10 stop distance).
const slot = (ticker: string, sector: PortfolioSlot["sector"], worstLossR: number | null = 2): PortfolioSlot => ({
  ticker, sector, shares: 10, entry: 100, stop: 90, worstLossR,
});
const cand = (over: Partial<CandidateTrade> = {}): CandidateTrade => ({
  ticker: "NEW", sector: "Health Care", baseShares: 10, entry: 50, stop: 40, worstLossR: 2, ...over,
});

function input(over: Partial<PortfolioEvaluationInput> = {}): PortfolioEvaluationInput {
  return {
    today: "2026-09-25",
    slots: [],
    candidate: cand(),
    navHistory: [
      { date: "2026-09-24", nav: 10_000 },
      { date: "2026-09-25", nav: 10_000 },
    ],
    regime: { spyClose: 110, spySma200: 100 },
    correlations: {},
    strictMode: true,
    ...over,
  };
}

const gate = (out: ReturnType<typeof evaluatePortfolio>, name: GateName) => out.gates.find((g) => g.gate === name)!;

test("a clean book passes every gate, in the fixed order", () => {
  const out = evaluatePortfolio(input());
  assert.deepEqual(out.gates.map((g) => g.gate), ["CAPACITY", "SECTOR", "CORRELATION", "REGIME", "DRAWDOWN", "GAP_HEAT"]);
  assert.ok(out.gates.every((g) => g.passed && g.severity === "OK"));
  assert.equal(out.canExecute, true);
  assert.equal(out.suggestedShares, 10);
  assert.equal(out.nominalHeatPctAfter, 1);
  assert.equal(out.tailRiskGapHeatPctAfter, 2);
});

test("CAPACITY: full book and already-held both block", () => {
  const five = ["A", "B", "C", "D", "E"].map((t, i) => slot(t, i % 2 ? "Energy" : "Utilities"));
  const corr = Object.fromEntries(five.map((s) => [s.ticker, 0.1]));
  assert.equal(gate(evaluatePortfolio(input({ slots: five, correlations: corr })), "CAPACITY").passed, false);
  const held = evaluatePortfolio(input({ slots: [slot("NEW", "Energy")], correlations: { NEW: 0.1 } }));
  assert.match(gate(held, "CAPACITY").message, /already held/);
});

test("SECTOR: a third name in one sector blocks; unknown sector fails closed at WARN", () => {
  const two = [slot("A", "Health Care"), slot("B", "Health Care")];
  const out = evaluatePortfolio(input({ slots: two, correlations: { A: 0.1, B: 0.1 } }));
  assert.equal(gate(out, "SECTOR").passed, false);
  assert.equal(gate(out, "SECTOR").severity, "CRITICAL");

  const unk = evaluatePortfolio(input({ candidate: cand({ sector: "Other" }) }));
  assert.equal(gate(unk, "SECTOR").passed, false);
  assert.equal(gate(unk, "SECTOR").severity, "WARN");
});

test("CORRELATION: above 0.70 blocks, exactly 0.70 passes, unmeasured fails closed", () => {
  const held = [slot("A", "Energy")];
  assert.equal(gate(evaluatePortfolio(input({ slots: held, correlations: { A: 0.71 } })), "CORRELATION").severity, "CRITICAL");
  assert.equal(gate(evaluatePortfolio(input({ slots: held, correlations: { A: 0.7 } })), "CORRELATION").passed, true);
  const unk = gate(evaluatePortfolio(input({ slots: held, correlations: {} })), "CORRELATION");
  assert.equal(unk.passed, false);
  assert.equal(unk.severity, "WARN");
});

test("REGIME: SPY below SMA200 caps the book at 2; unreadable fails closed", () => {
  const two = [slot("A", "Energy"), slot("B", "Utilities")];
  const corr = { A: 0.1, B: 0.1 };
  const below = { spyClose: 90, spySma200: 100 };
  assert.equal(gate(evaluatePortfolio(input({ slots: two, correlations: corr, regime: below })), "REGIME").passed, false);
  assert.equal(gate(evaluatePortfolio(input({ slots: two.slice(0, 1), correlations: corr, regime: below })), "REGIME").passed, true);
  assert.equal(gate(evaluatePortfolio(input({ regime: null })), "REGIME").severity, "WARN");
});

test("DRAWDOWN: 3% daily drop stops the day; 8% halves size; 15% is safe mode", () => {
  const daily = evaluatePortfolio(input({ navHistory: [{ date: "2026-09-24", nav: 10_000 }, { date: "2026-09-25", nav: 9_700 }] }));
  assert.equal(gate(daily, "DRAWDOWN").passed, false);

  const half = evaluatePortfolio(input({ navHistory: [{ date: "2026-09-01", nav: 10_000 }, { date: "2026-09-24", nav: 9_200 }, { date: "2026-09-25", nav: 9_200 }] }));
  assert.equal(gate(half, "DRAWDOWN").passed, true);
  assert.equal(gate(half, "DRAWDOWN").severity, "WARN");
  assert.equal(half.sizeMultiplier, 0.5);
  assert.equal(half.suggestedShares, 5);

  const safe = evaluatePortfolio(input({ navHistory: [{ date: "2026-09-01", nav: 10_000 }, { date: "2026-09-25", nav: 8_500 }] }));
  assert.match(gate(safe, "DRAWDOWN").message, /safe mode/);
  assert.equal(safe.canExecute, false);
});

test("DRAWDOWN: no log or a stale log is unknown, and heat goes unknown with it", () => {
  const none = evaluatePortfolio(input({ navHistory: [] }));
  assert.equal(gate(none, "DRAWDOWN").severity, "WARN");
  assert.equal(gate(none, "GAP_HEAT").passed, false);
  assert.equal(none.nav, null);

  const stale = readNav([{ date: "2026-09-10", nav: 10_000 }], "2026-09-25", 5);
  assert.equal(stale.nav, null);
  assert.match(stale.unknownReason!, /15 days old/);
});

test("GAP_HEAT: sums risk$ x worstLossR; over 10% of NAV blocks", () => {
  // 3 held at 3R each = 9%, candidate at 2R = 2% -> 11%.
  const held = [slot("A", "Energy", 3), slot("B", "Utilities", 3), slot("C", "Materials", 3)];
  const corr = { A: 0.1, B: 0.1, C: 0.1 };
  const out = evaluatePortfolio(input({ slots: held, correlations: corr }));
  assert.equal(out.tailRiskGapHeatPctAfter, 11);
  assert.equal(gate(out, "GAP_HEAT").passed, false);
  assert.equal(out.nominalHeatRAfter, 4);
});

test("GAP_HEAT: an unmeasured gap counts as 1R and marks the figure a lower bound", () => {
  const out = evaluatePortfolio(input({ candidate: cand({ worstLossR: null }) }));
  assert.equal(out.tailRiskGapHeatPctAfter, 1);
  assert.deepEqual(out.gapUnmeasured, ["NEW"]);
  assert.equal(gate(out, "GAP_HEAT").severity, "WARN");
  assert.match(gate(out, "GAP_HEAT").message, /lower bound/);
});

test("overrides un-block only outside strictMode, and only with a non-blank reason", () => {
  const two = [slot("A", "Health Care"), slot("B", "Health Care")];
  const base = { slots: two, correlations: { A: 0.1, B: 0.1 }, overrides: { SECTOR: "pairs trade, sized down" } };
  assert.equal(evaluatePortfolio(input({ ...base, strictMode: true })).canExecute, false);

  const adv = evaluatePortfolio(input({ ...base, strictMode: false }));
  assert.equal(adv.canExecute, true);
  assert.equal(gate(adv, "SECTOR").overridden, true);
  assert.equal(gate(adv, "SECTOR").passed, false);

  const blank = evaluatePortfolio(input({ ...base, strictMode: false, overrides: { SECTOR: "   " } }));
  assert.deepEqual(blank.blockedBy, ["SECTOR"]);
});

test("the drawdown size cut still applies when the drawdown gate is overridden", () => {
  const out = evaluatePortfolio(input({
    strictMode: false,
    overrides: { DRAWDOWN: "known deposit timing" },
    navHistory: [{ date: "2026-09-01", nav: 10_000 }, { date: "2026-09-24", nav: 9_200 }, { date: "2026-09-25", nav: 8_900 }],
  }));
  assert.equal(gate(out, "DRAWDOWN").overridden, true);
  assert.equal(out.suggestedShares, 5);
});
