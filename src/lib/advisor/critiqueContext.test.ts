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
import type { Fundamentals } from "@/lib/market/fundamentals";
import type { RecentNews } from "@/lib/market/news";

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
    stopSource: "atr",
    stopNotes: [],
    stopFlags: [],
    stopStructure: null,
    atrAlternative: null,
    stopAtrMult: 1.5,
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
    gapRisk: null,
    gapWorstLossUsd: null,
    fillGuard: {
      walkAwayPrice: 232.47,
      walkAwayBoundBy: "risk",
      quote: null,
      quoteNote: "No live quote was fetched.",
      atQuote: null,
      belowStop: false,
    },
    baseRate: null,
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
  assert.match(s, /next earnings: 2026-09-13 ก่อนตลาดเปิด — อีก 3 วัน \(นับตามปฏิทิน\) หลังจากวันที่การ์ดนี้อ้างอิง/);
});

test("renderCritiqueContext: an unknown earnings date is printed, not omitted", () => {
  // Omitting the line would let the model read "no earnings risk here". The
  // whole reason the line exists is that its absence is a claim.
  const s = renderCritiqueContext(makeCard({ earnings: null }), null);
  assert.match(s, /next earnings: ไม่ทราบ/);
});

function makeFundamentals(over: Partial<Fundamentals> = {}): Fundamentals {
  return {
    name: "Apple Inc.",
    industry: "Technology",
    marketCapM: 3_450_000,
    peTTM: 34.2,
    pb: 45.1,
    roePct: 145.3,
    netMarginPct: 24.3,
    revenueGrowthPct: 8.1,
    epsGrowthPct: 10.2,
    debtToEquity: 1.45,
    dividendYieldPct: 0.45,
    ...over,
  };
}

test("the fundamentals section renders every metric when fundamentals were fetched", () => {
  const text = renderCritiqueContext(makeCard(), null, makeFundamentals(), null);
  assert.match(text, /\[fundamentals\]/);
  assert.match(text, /name: Apple Inc\. \(Technology\)/);
  assert.match(text, /market cap: \$3450000M/);
  assert.match(text, /P\/E \(TTM\): 34\.20/);
  assert.match(text, /ROE: 145\.30%/);
  assert.match(text, /dividend yield: 0\.45%/);
});

test("the fundamentals section prints the note verbatim when the fetch found nothing usable", () => {
  const f = makeFundamentals({ note: "FINNHUB_API_KEY not set" });
  const text = renderCritiqueContext(makeCard(), null, f, null);
  assert.match(text, /\[fundamentals\]\nFINNHUB_API_KEY not set/);
});

test("the fundamentals section says so, never vanishing, when the caller did not fetch it at all", () => {
  const text = renderCritiqueContext(makeCard(), null);
  assert.match(text, /\[fundamentals\]\nnot fetched for this critique/);
});

test("the news section lists each headline with its date and source", () => {
  const news: RecentNews = {
    items: [
      { headline: "Apple unveils new chip", source: "Reuters", date: "2026-09-14", url: "https://example.com/a" },
      { headline: "Supplier reports delay", source: "Bloomberg", date: "2026-09-12", url: "https://example.com/b" },
    ],
  };
  const text = renderCritiqueContext(makeCard(), null, null, news);
  assert.match(text, /\[news\]/);
  assert.match(text, /2026-09-14 \(Reuters\): Apple unveils new chip/);
  assert.match(text, /2026-09-12 \(Bloomberg\): Supplier reports delay/);
});

test("an empty news result prints its note, not a blank section", () => {
  const news: RecentNews = { items: [], note: "no company news in the last 7 days" };
  const text = renderCritiqueContext(makeCard(), null, null, news);
  assert.match(text, /\[news\]\nno company news in the last 7 days/);
});

test("the news section says so, never vanishing, when the caller did not fetch it at all", () => {
  const text = renderCritiqueContext(makeCard(), null);
  assert.match(text, /\[news\]\nnot fetched for this critique/);
});

test("gap-through risk is quoted in stops and R when measured, and n/a when not", () => {
  const measured = renderCritiqueContext(
    makeCard({
      gapRisk: {
        sessions: 480, from: "2024-09-10", to: "2026-09-10",
        worstStops: 1.8, worstDate: "2025-04-04", worstLossR: 2.8,
        overHalfStop: 9, overOneStop: 2,
      },
      gapWorstLossUsd: 51.9,
    }),
    makeBars(40),
  );
  assert.match(measured, /worst overnight gap-through \(2024-09-10 to 2026-09-10, 480 sessions\): 1\.80 stops on 2025-04-04, i\.e\. up to 2\.80 R/);
  assert.match(measured, /2 sessions gapped a full stop or more/);

  const unknown = renderCritiqueContext(makeCard(), makeBars(40));
  assert.match(unknown, /worst overnight gap-through: n\/a/);
});

test("the stop line names the card's own ATR multiple and where the stop came from", () => {
  const atrCard = renderCritiqueContext(makeCard(), makeBars(40));
  assert.match(atrCard, /stop distance: 6\.18 \(1\.50 x ATR, ATR rule\)/);

  const givenCard = renderCritiqueContext(makeCard({ stopSource: "given", stopAtrMult: 0.83 }), makeBars(40));
  assert.match(givenCard, /stop distance: 6\.18 \(0\.83 x ATR, stop given \(chart-agent link or typed\)\)/);

  const swingCard = renderCritiqueContext(makeCard({ stopSource: "swing", stopAtrMult: 0.83 }), makeBars(40));
  assert.match(swingCard, /\(0\.83 x ATR, stop under a 5-minute swing low\)/);

  const pdlCard = renderCritiqueContext(makeCard({ stopSource: "pdl", stopAtrMult: 2.1 }), makeBars(40));
  assert.match(pdlCard, /\(2\.10 x ATR, stop under the previous session low\)/);
});
