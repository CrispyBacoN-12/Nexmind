import "dotenv/config"; // scheduledResearch.ts imports prisma at module scope
import { test } from "node:test";
import assert from "node:assert/strict";
import { strategyResultLine, RESEARCH_ROTATION, pickRotationEntry, roundInputs } from "./scheduledResearch";

// Run #112 (2026-08-31) is the worked example these fixtures come from. Every
// candidate it rejected printed FIT numbers that looked nothing like the reason
// it died: research-216 read "trades=3 win%=100.0" while its actual verdict was
// "0 trades in 2019". runResearch.ts:311 decides status on the SELECT fold; the
// row stores and this line printed the FIT fold. Reading a round meant hand-
// querying `iterations` to find the number that decided it.

const summary = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    trades: 363, wins: 175, losses: 188, winRate: 48.2,
    totalPnl: -150.2, avgR: 0.041, expectancy: -0.4138, profitFactor: 0.2339,
    ...over,
  });

const iterations = (selectOver: Record<string, unknown> | null = {}) =>
  JSON.stringify([
    { note: "final exit-ladder sweep on fit (2016-01-01..2019-01-01)", backtestSummary: JSON.parse(summary()) },
    ...(selectOver
      ? [{
          note: "select fold select (2019-01-01..2020-01-01, 2019 melt-up on falling rates) — 85/476 symbols traded",
          backtestSummary: JSON.parse(summary({ trades: 90, winRate: 31.1, avgR: -0.4071, expectancy: -0.0824, profitFactor: 0.549 })),
        }]
      : []),
  ]);

const row = (over: Record<string, unknown> = {}) => ({
  id: 218, label: "Volume-Confirmed Range Breakout", status: "rejected", safetyFlag: false,
  backtestSummary: summary(), iterations: iterations(), ...over,
});

test("the line reports the SELECT fold, because that is what decided the status", () => {
  const line = strategyResultLine(row());
  assert.match(line, /select=\[/);
  assert.match(line, /trades=90/, "SELECT's trade count, not FIT's 363");
  assert.match(line, /avgR=-0\.407/, "avgR is the metric the gate reasons about under a fixed lot");
});

test("SELECT is printed before FIT, so the deciding number is read first", () => {
  const line = strategyResultLine(row());
  assert.ok(line.indexOf("select=[") < line.indexOf("fit=["), `SELECT must lead: ${line}`);
});

test("a candidate that never traded in SELECT says so, instead of showing a healthy FIT", () => {
  // research-216: FIT read trades=3 win%=100.0, SELECT traded 0 of 476 names.
  // Printing only the FIT half is how a dead rule reads as a good one.
  const line = strategyResultLine(row({
    id: 216,
    label: "MACD Momentum Continuation",
    backtestSummary: summary({ trades: 3, winRate: 100, avgR: 0.9946, expectancy: 0.1667, profitFactor: null }),
    iterations: JSON.stringify([{
      note: "select fold select (2019-01-01..2020-01-01, 2019 melt-up on falling rates) — 0/476 symbols traded",
      backtestSummary: JSON.parse(summary({ trades: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0, avgR: null, expectancy: null, profitFactor: null })),
    }]),
  }));
  assert.match(line, /trades=0/);
  assert.match(line, /select=\[/);
});

test("a row with no SELECT iteration is called out, not silently reduced to FIT", () => {
  // Legacy single-symbol rows have no select fold at all. Omitting the segment
  // would make them indistinguishable from a panel row that passed one.
  const line = strategyResultLine(row({ iterations: iterations(null) }));
  assert.match(line, /no select fold/i);
  assert.doesNotMatch(line, /select=\[/);
});

test("malformed iterations JSON degrades to a note rather than aborting the round's log", () => {
  const line = strategyResultLine(row({ iterations: "{not json" }));
  assert.match(line, /research-218/);
  assert.match(line, /no select fold/i);
});

test("the safety flag and status still lead the line", () => {
  const line = strategyResultLine(row({ safetyFlag: true }));
  assert.match(line, /^research-218 \[rejected\] SAFETY-FLAGGED "Volume-Confirmed Range Breakout"/);
});

// --- rotation ---------------------------------------------------------------

test("every rotation entry supplies exactly three angles, matching CANDIDATES_SCHEMA", () => {
  // proposeCandidates asks for exactly 3 and the schema enforces 3. A rotation
  // entry listing two or four angles would put the prompt and the schema in
  // conflict on every round it came up.
  for (const e of RESEARCH_ROTATION) {
    assert.equal(e.angles?.length, 3, `${e.label} must list 3 angles`);
  }
});

test("the rotation no longer asks for entry mechanisms", () => {
  // The 2026-08-31 direction: entry-rule research is closed (five straight
  // rejections), so the rotation varies trade geometry on a fixed baseline.
  const text = RESEARCH_ROTATION.map((e) => `${e.label} ${e.brief} ${(e.angles ?? []).join(" ")}`).join(" ");
  assert.doesNotMatch(text, /mean-reversion|volatility-contraction/i);
});

test("the rotation does not re-propose the confluence filters already rejected", () => {
  // 13 vetoes swept IS/OOS on 2026-08-23, all rejected, three pre-registered
  // picks all flipped sign. Spending an AI round re-deriving that is waste.
  const text = RESEARCH_ROTATION.map((e) => `${e.brief} ${(e.angles ?? []).join(" ")}`).join(" ");
  assert.doesNotMatch(text, /bollinger|stochastic|vwap|lorentzian|volume.profile|liquidity sweep/i);
});

test("the rotation never asks for another entry confirmation", () => {
  // 2026-09-03: the baseline entry loses to a matched random entry in 30/30
  // cells and the loss is confirmation lag — shifting the SAME signals two or
  // three bars earlier flips the margin positive in 5/5 folds. An angle telling
  // QUANT to wait for one more signal spends a round on a mechanism already
  // measured as counterproductive. This guard is why the old
  // "require one confirmation close" angle is gone.
  const text = RESEARCH_ROTATION.map((e) => `${e.brief} ${(e.angles ?? []).join(" ")}`).join(" ");
  assert.doesNotMatch(text, /confirmation close|wait for (a |one )?(further |additional )?confirm/i);
  assert.doesNotMatch(text, /one more signal|another confirmation/i);
});

test("pickRotationEntry cycles through the whole rotation and wraps", () => {
  const n = RESEARCH_ROTATION.length;
  for (let w = 0; w < n * 2; w++) {
    assert.equal(pickRotationEntry(w).label, RESEARCH_ROTATION[w % n].label);
  }
  assert.equal(pickRotationEntry(-1).label, RESEARCH_ROTATION[n - 1].label, "negative weeks must not index out of range");
});

test("a rotation round carries its angles through to the proposer", () => {
  const inputs = roundInputs(undefined, RESEARCH_ROTATION[0]);
  assert.equal(inputs.label, RESEARCH_ROTATION[0].label);
  assert.deepEqual(inputs.angles, RESEARCH_ROTATION[0].angles);
});

test("a manual brief override drops the rotation's angles", () => {
  // The angles describe the rotation entry's brief. Pairing them with a
  // different brief would tell QUANT to explore three angles of a question
  // nobody asked — worse than giving it no axis at all.
  const inputs = roundInputs({ brief: "test a specific idea" }, RESEARCH_ROTATION[0]);
  assert.equal(inputs.brief, "test a specific idea");
  assert.equal(inputs.label, "manual-override");
  assert.equal(inputs.angles, undefined);
});
