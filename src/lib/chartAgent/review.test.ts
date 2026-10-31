import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import type { Setup } from "@/lib/chartAgent/types";
import {
  CHART_PREDICTION_PHRASES_TH,
  buildReviewPrompt,
  isChartPrediction,
  normalizeReviews,
} from "@/lib/chartAgent/review";

const PLAIN = "sweep PDL แล้วกลับขึ้นมายืนเหนือ VAL";
const STRIPPED = "ตัดออก: มีคำทำนาย";
const NO_REASON = "AI ตัดออกโดยไม่ให้เหตุผลที่แสดงได้";
const UNREAD = "AI ไม่ได้อ่าน";

test("every prediction phrase is caught", () => {
  assert.equal(CHART_PREDICTION_PHRASES_TH.length, 10);
  for (const p of CHART_PREDICTION_PHRASES_TH) {
    assert.equal(isChartPrediction(`โครงสร้างนี้ ${p} ครับ`), true, p);
  }
});

test("the advisor's directional guard is part of the check", () => {
  assert.equal(isChartPrediction("You should buy this here"), true);
  assert.equal(isChartPrediction("ราคานี้ไม่ควรเข้า"), true);
});

test("a plain description passes", () => {
  assert.equal(isChartPrediction(PLAIN), false);
});

test("a clean reading with keep is kept", () => {
  const out = normalizeReviews(
    { reviews: [{ ticker: "KO", keep: true, reading: `  ${PLAIN}  `, rejectReason: "" }] },
    ["KO"],
  );
  assert.deepEqual(out.get("KO"), { status: "kept", reading: PLAIN, reason: null });
});

test("a reading that predicts is stripped", () => {
  const out = normalizeReviews(
    { reviews: [{ ticker: "KO", keep: true, reading: "ราคาจะขึ้นต่อ", rejectReason: "" }] },
    ["KO"],
  );
  assert.deepEqual(out.get("KO"), { status: "stripped", reading: null, reason: STRIPPED });
});

test("a stripped reading wins even when the model also rejected", () => {
  const out = normalizeReviews(
    { reviews: [{ ticker: "KO", keep: false, reading: "แน่นอนว่าหลุด", rejectReason: "โครงสร้างอ่อน" }] },
    ["KO"],
  );
  assert.deepEqual(out.get("KO"), { status: "stripped", reading: null, reason: STRIPPED });
});

test("keep false is rejected with its reason", () => {
  const out = normalizeReviews(
    { reviews: [{ ticker: "KO", keep: false, reading: PLAIN, rejectReason: " แท่ง sweep ปิดอ่อน " }] },
    ["KO"],
  );
  assert.deepEqual(out.get("KO"), { status: "rejected", reading: PLAIN, reason: "แท่ง sweep ปิดอ่อน" });
});

test("a rejection with an empty, blank or null reason gets the fixed text", () => {
  for (const rejectReason of ["", "   ", null]) {
    const out = normalizeReviews({ reviews: [{ ticker: "KO", keep: false, reading: PLAIN, rejectReason }] }, ["KO"]);
    assert.deepEqual(out.get("KO"), { status: "rejected", reading: PLAIN, reason: NO_REASON }, String(rejectReason));
  }
});

test("a rejection whose reason predicts gets the fixed text", () => {
  const out = normalizeReviews(
    { reviews: [{ ticker: "KO", keep: false, reading: PLAIN, rejectReason: "น่าจะลงต่อ" }] },
    ["KO"],
  );
  assert.deepEqual(out.get("KO"), { status: "rejected", reading: PLAIN, reason: NO_REASON });
});

test("a missing ticker is unread", () => {
  const out = normalizeReviews({ reviews: [{ ticker: "KO", keep: true, reading: PLAIN, rejectReason: "" }] }, ["KO", "AAPL"]);
  assert.equal(out.get("KO")?.status, "kept");
  assert.deepEqual(out.get("AAPL"), { status: "unread", reading: null, reason: UNREAD });
});

test("unknown tickers are ignored", () => {
  const out = normalizeReviews({ reviews: [{ ticker: "ZZZZ", keep: true, reading: PLAIN, rejectReason: "" }] }, ["KO"]);
  assert.equal(out.has("ZZZZ"), false);
  assert.deepEqual(out.get("KO"), { status: "unread", reading: null, reason: UNREAD });
});

test("an empty reading with keep is kept with a null reading", () => {
  const out = normalizeReviews({ reviews: [{ ticker: "KO", keep: true, reading: "   ", rejectReason: "" }] }, ["KO"]);
  assert.deepEqual(out.get("KO"), { status: "kept", reading: null, reason: null });
});

test("the first occurrence of a ticker wins", () => {
  const out = normalizeReviews(
    {
      reviews: [
        { ticker: "ko", keep: false, reading: PLAIN, rejectReason: "แท่งอ่อน" },
        { ticker: "KO", keep: true, reading: "อื่น", rejectReason: "" },
      ],
    },
    ["KO"],
  );
  assert.equal(out.get("KO")?.status, "rejected");
});

test("garbage input leaves every ticker unread", () => {
  for (const raw of [null, undefined, "x", 3, {}, { reviews: "no" }, { reviews: [null, 1, { ticker: 5 }] }]) {
    const out = normalizeReviews(raw, ["KO"]);
    assert.deepEqual(out.get("KO"), { status: "unread", reading: null, reason: UNREAD });
  }
});

// 2026-01-15 15:30 UTC = 10:30 ET (EST); 5-minute bars.
const T0 = Date.UTC(2026, 0, 15, 15, 30) / 1000;
function bar(i: number, base: number): Candle {
  return { t: T0 + i * 300, o: base, h: base + 0.5, l: base - 0.5, c: base + 0.25, v: 1000 + i };
}

function setup(ticker: string, entry: number): Setup {
  return {
    ticker,
    entry,
    stop: entry - 1.23,
    t1: { price: entry + 2.5, names: ["pPOC"], r: 2.03 },
    t2: { price: entry + 4.1, names: ["PDH", "pVAH"], r: 3.33 },
    sweptLevels: ["PDL"],
    sweepBar: bar(3, entry - 1),
    tags: [],
    levels: {
      pPOC: entry + 2.5,
      pVAH: entry + 4.1,
      pVAL: null,
      PDH: entry + 4.1,
      PDL: entry - 1.1,
      PMH: null,
      PML: null,
      dPOC: null,
    },
    dataAsOf: "2026-01-15T15:35:00.000Z",
  };
}

test("the prompt carries every ticker, its prices and the last bar's ET time", () => {
  const recentKo = [bar(0, 60), bar(1, 60.1), bar(2, 60.2)]; // last starts 10:40 ET
  const recentAa = [bar(0, 40), bar(1, 40.1)]; // last starts 10:35 ET
  const p = buildReviewPrompt([
    { setup: setup("KO", 61.5), recent: recentKo },
    { setup: setup("AAPL", 187.25), recent: recentAa },
  ]);
  assert.ok(p.includes("KO") && p.includes("AAPL"));
  assert.ok(p.includes("61.50"), "KO entry");
  assert.ok(p.includes("60.27"), "KO stop");
  assert.ok(p.includes("64.00"), "KO T1");
  assert.ok(p.includes("187.25"), "AAPL entry");
  assert.ok(p.includes("2.03"), "T1 R to 2 decimals");
  assert.ok(p.includes("PDL"), "swept level name");
  assert.ok(p.includes("pPOC"), "target name");
  assert.ok(p.includes("10:40"), "last KO bar in ET");
  assert.ok(p.includes("10:35"), "last AAPL bar in ET");
  assert.equal(p.includes("pVAL"), false, "null levels are not listed");
});
