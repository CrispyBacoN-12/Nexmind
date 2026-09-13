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
import { guardObjections, renderCritiqueContext, type Objection } from "@/lib/advisor/critiqueContext";
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
    // A known date by default, so that a test which cares about the unknown
    // wording has to ask for it and cannot pass by accident.
    earnings: { date: "2026-10-28", hour: "amc" },
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

function obj(claim: string, evidence = "some number"): Objection {
  return { claim, evidence, severity: "concern" };
}

test("the guard strips English directional vocabulary and records it verbatim", () => {
  const { kept, stripped } = guardObjections([obj("You should buy this here")]);
  assert.equal(kept.length, 0);
  assert.equal(stripped.length, 1);
  assert.match(stripped[0]!, /You should buy this here — some number/);
});

test("the guard strips the negated form too — a negated verdict is still a verdict", () => {
  const { kept, stripped } = guardObjections([obj("You should not buy this")]);
  assert.equal(kept.length, 0);
  assert.equal(stripped.length, 1);
});

test("the guard strips Thai recommendation language by substring", () => {
  const { kept, stripped } = guardObjections([obj("ราคานี้ไม่ควรเข้า", "เกิน SMA50 อยู่ 26%")]);
  assert.equal(kept.length, 0);
  assert.equal(stripped.length, 1);
});

test("the guard matches directional words in the evidence field, not only the claim", () => {
  const { kept, stripped } = guardObjections([obj("The structure is stretched", "so avoid it")]);
  assert.equal(kept.length, 0);
  assert.equal(stripped.length, 1);
});

test("the guard leaves a clean structural objection untouched", () => {
  const clean = obj("The last close sits 26.7% above its SMA50", "SMA50 178.90, close 226.40");
  const { kept, stripped } = guardObjections([clean]);
  assert.deepEqual(kept, [clean]);
  assert.deepEqual(stripped, []);
});

test("the guard is word-boundary anchored in English — 'entered' and 'shortfall' survive", () => {
  const a = obj("Price entered this range only four bars ago", "bars 36-40");
  const b = obj("There is a shortfall between the budget and one share", "budget $100, share $226.40");
  const { kept, stripped } = guardObjections([a, b]);
  assert.equal(kept.length, 2);
  assert.deepEqual(stripped, []);
});

test("the guard preserves order and mixes kept with stripped correctly", () => {
  const clean = obj("ATR is 1.8% of entry", "4.12 on 226.40");
  const { kept, stripped } = guardObjections([obj("recommend waiting"), clean, obj("sell into strength")]);
  assert.deepEqual(kept, [clean]);
  assert.equal(stripped.length, 2);
});

test("renderCritiqueContext: the head block carries the earnings date the owner can see", () => {
  const s = renderCritiqueContext(makeCard({ earnings: { date: "2026-09-13", hour: "bmo" } }), null);
  assert.match(s, /next earnings: 2026-09-13 before the open — 3 calendar day\(s\) after the as-of date/);
});

test("renderCritiqueContext: an unknown earnings date is printed, not omitted", () => {
  // Omitting the line would let the model read "no earnings risk here". The
  // whole reason the line exists is that its absence is a claim.
  const s = renderCritiqueContext(makeCard({ earnings: null }), null);
  assert.match(s, /next earnings: unknown/);
});
