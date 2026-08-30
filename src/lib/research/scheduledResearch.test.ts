import "dotenv/config"; // scheduledResearch.ts imports prisma at module scope
import { test } from "node:test";
import assert from "node:assert/strict";
import { strategyResultLine } from "./scheduledResearch";

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
