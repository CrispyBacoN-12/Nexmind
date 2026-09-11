// The facts sheet is the model's entire view of the trade. Its tests are
// content tests, not snapshot tests: what matters is that a number the owner
// can see on the card is present in the string, and that a number the card
// does NOT have renders as an explicit "n/a" rather than vanishing. An absent
// line reads to a model as a fact that does not exist, which is a different
// and worse claim than "unknown".
//
// No dotenv import: this module is pure and pulls in nothing that touches
// prisma at module scope (contrast src/lib/trading/hawk.test.ts).

import { test } from "node:test";
import assert from "node:assert/strict";

import type { ChartBar } from "@/lib/advisor/chartSeries";
import { renderCritiqueContext } from "@/lib/advisor/critiqueContext";
import { ADVISOR_NO_EDGE_CLAIM, type AdvisorCard } from "@/lib/advisor/types";

function makeCard(over: Partial<AdvisorCard> = {}): AdvisorCard {
  return {
    ticker: "AAPL",
    asOf: "2026-09-10",
    lastClose: 226.4,
    entry: 226.4,
    entrySource: "last close",
    atr: 4.12,
    slDistance: 6.18,
    stop: 220.22,
    sizing: {
      shares: 4,
      riskShares: 4,
      affordableShares: 2,
      slotBudget: 500,
      riskUsdTarget: 25,
      actualRiskUsd: 24.72,
      actualRiskPct: 0.99,
      boundBy: ["affordability"],
      reason: "affordability capped the size at 2 shares",
    },
    deployedUsd: 905.6,
    ladder: [
      { r: 1, price: 232.58, gainPct: 2.73, plUsd: 24.72 },
      { r: 2, price: 238.76, gainPct: 5.46, plUsd: 49.44 },
    ],
    costR: 0.04,
    correlations: [{ ticker: "MSFT", correlation: 0.62, note: "126 overlapping bars" }],
    avgCorrelation: 0.62,
    corrMultiplier: 0.7,
    corrAdjustedShares: 2,
    freeSlots: 3,
    gate: { slots: 3, benchAbove: true, shortsAllowed: false, note: "market gate ON" },
    alreadyHeld: false,
    warnings: [],
    noEdgeClaim: ADVISOR_NO_EDGE_CLAIM,
    ...over,
  };
}

function makeBars(n: number): ChartBar[] {
  return Array.from({ length: n }, (_, i) => ({
    t: 1_750_000_000 + i * 86_400,
    d: `2026-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, "0")}`,
    o: 200 + i,
    h: 205 + i,
    l: 195 + i,
    c: 200 + i,
    v: 1_000_000,
    sma50: 190 + i,
    sma200: 180 + i,
  }));
}

test("facts sheet carries entry, stop, ATR, costR and every ladder rung", () => {
  const text = renderCritiqueContext(makeCard(), makeBars(40));
  assert.match(text, /entry: \$226\.40/);
  assert.match(text, /stop: \$220\.22/);
  assert.match(text, /ATR\(14\): 4\.12/);
  assert.match(text, /0\.04 R/);
  assert.match(text, /1\.0 R · \$232\.58/);
  assert.match(text, /2\.0 R · \$238\.76/);
});

test("a zero-share card still renders and carries the sizing reason verbatim", () => {
  const card = makeCard({
    sizing: {
      shares: 0,
      riskShares: 0,
      affordableShares: 0,
      slotBudget: 100,
      riskUsdTarget: 25,
      actualRiskUsd: 0,
      actualRiskPct: 0,
      boundBy: ["affordability"],
      reason: "one share costs more than the slot budget",
    },
  });
  const text = renderCritiqueContext(card, makeBars(40));
  assert.match(text, /shares: 0/);
  assert.match(text, /one share costs more than the slot budget/);
});

test("a null chart renders the position-in-range block as n/a and throws nothing", () => {
  const text = renderCritiqueContext(makeCard(), null);
  assert.match(text, /\[position in range\]/);
  assert.match(text, /last close vs SMA50: n\/a/);
  assert.match(text, /last close vs SMA200: n\/a/);
  assert.doesNotMatch(text, /52-week/);
});

test("the correlation multiplier is labelled reported-not-applied", () => {
  const text = renderCritiqueContext(makeCard(), makeBars(40));
  assert.match(text, /correlation multiplier: 0\.70 — REPORTED ONLY, not applied/);
});

test("the range block names the window it actually measured, never 52-week", () => {
  const text = renderCritiqueContext(makeCard(), makeBars(40));
  assert.match(text, /bars supplied: 40 daily bars/);
  assert.doesNotMatch(text, /52-week/);
});

test("warnings render verbatim, and an empty list says so", () => {
  const dirty = renderCritiqueContext(makeCard({ warnings: ["correlation data missing for MSFT"] }), null);
  assert.match(dirty, /correlation data missing for MSFT/);
  const clean = renderCritiqueContext(makeCard(), null);
  assert.match(clean, /\[warnings\]\nnone/);
});
