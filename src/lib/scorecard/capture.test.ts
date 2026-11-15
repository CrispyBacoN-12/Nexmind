// Tests for the capture recorder: a stand-in for reviewSetups that records what the AI
// would have seen and returns no reviews, so the cloud run logs every setup as pending.

import test from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import type { ReviewItem } from "@/lib/chartAgent/review";
import type { Setup } from "@/lib/chartAgent/types";
import type { ChartSetupRow } from "@/lib/chartAgent/logRows";
import { runChartAgent } from "@/lib/chartAgent/runChartAgent";
import type { ScanResult } from "@/lib/scanAgent/types";
import { makeRecorder, parseReviewInput, sanitizeConsole, SUPPRESSED_TAG } from "./capture";
import { runScorecardDaily, type ScorecardRunInput } from "./runDaily";
import { PENDING_BACKEND } from "./types";

const bar = (t: number, h: number, l: number, c: number): Candle => ({ t, o: c, h, l, c, v: 1000 });

function item(ticker: string): ReviewItem {
  const sweepBar = bar(1_000_000, 100.2, 98.5, 99.5);
  const setup: Setup = {
    ticker,
    entry: 100,
    stop: 98.4,
    t1: { price: 105, names: ["PDH"], r: 3.1 },
    t2: null,
    sweptLevels: ["PDL"],
    sweepBar,
    tags: [],
    levels: { pPOC: 100, pVAH: 101, pVAL: 99.5, PDH: 105, PDL: 99, PMH: null, PML: null, dPOC: 100.1 },
    dataAsOf: "2026-11-02T15:15:00.000Z",
  };
  return { setup, recent: [bar(1_000_000, 100.4, 99.9, 100.2), sweepBar] };
}

test("recorder returns no reviews and the pending backend", async () => {
  const r = makeRecorder();
  const out = await r.review([item("AAA")]);
  assert.equal(out.backend, PENDING_BACKEND);
  assert.equal(out.backend, "pending");
  assert.equal(out.model, null);
  assert.equal(out.reviews.size, 0);
});

test("recorder keeps each item with its input order", async () => {
  const r = makeRecorder();
  await r.review([item("AAA"), item("BBB"), item("CCC")]);
  const m = r.inputs();
  assert.equal(m.get("AAA")?.order, 0);
  assert.equal(m.get("BBB")?.order, 1);
  assert.equal(m.get("CCC")?.order, 2);
});

test("parseReviewInput round-trips a ReviewItem through JSON", async () => {
  const r = makeRecorder();
  await r.review([item("AAA")]);
  const input = r.inputs().get("AAA")!;
  const back = parseReviewInput(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(back, input);
});

test("parseReviewInput rejects missing fields", async () => {
  const r = makeRecorder();
  await r.review([item("AAA")]);
  const good = JSON.parse(JSON.stringify(r.inputs().get("AAA")));
  assert.equal(parseReviewInput({}), null);
  assert.equal(parseReviewInput(null), null);
  const { recent: _recent, ...noRecent } = good.item;
  assert.equal(parseReviewInput({ order: 0, item: noRecent }), null);
  assert.equal(parseReviewInput({ ...good, order: "0" }), null);
});

// Monday 2026-11-02 10:30 ET.
const NOW_OPEN = Date.parse("2026-11-02T15:30:00Z");
const PREV_OPEN = Date.parse("2026-10-30T13:30:00Z") / 1000;
const TODAY_OPEN = Date.parse("2026-11-02T14:30:00Z") / 1000;

function setupBars(): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < 78; i++) {
    let h = 100.8;
    let l = 99.5;
    if (i === 10) l = 99;
    if (i === 20) h = 105;
    out.push(bar(PREV_OPEN + i * 300, h, l, 100));
  }
  out.push(bar(TODAY_OPEN, 100.4, 99.9, 100.2), bar(TODAY_OPEN + 300, 100.2, 98.5, 99.5), bar(TODAY_OPEN + 600, 100.1, 99.4, 100));
  return out;
}

function dailyBars(): Candle[] {
  const start = Date.parse("2026-10-01T16:00:00Z") / 1000;
  return Array.from({ length: 25 }, (_, i) => bar(start + i * 86400, 101, 99, 100));
}

test("a capture run through runScorecardDaily logs pending rows", async () => {
  const recorder = makeRecorder();
  const logged: (ChartSetupRow & { reviewInput?: unknown })[] = [];
  const runs: ScorecardRunInput[] = [];
  const scan = { ok: true, rows: [{ ticker: "AAA" }] } as unknown as ScanResult;
  const result = await runScorecardDaily({
    now: () => NOW_OPEN,
    alreadyRan: async () => false,
    scan: async () => scan,
    chart: (tickers, runId) =>
      runChartAgent(tickers, {
        now: () => NOW_OPEN,
        fetchIntraday: async () => new Map([["AAA", setupBars()]]),
        fetchDaily: async () => new Map([["AAA", dailyBars()]]),
        review: recorder.review,
        log: async (rows) => {
          logged.push(...rows.map((row) => ({ ...row, reviewInput: recorder.inputs().get(row.ticker) })));
        },
        runId: () => runId,
      }),
    record: async (run) => {
      runs.push(run);
    },
    newRunId: () => "run-1",
  });
  assert.equal(result.action, "ran");
  assert.equal(logged.length, 1);
  assert.equal(logged[0].aiBackend, "pending");
  assert.equal(logged[0].status, "shown");
  assert.equal(logged[0].aiReading, null);
  assert.equal((logged[0].reviewInput as { order: number }).order, 0);
  assert.equal(runs[0].aiBackend, "pending");
});

test("sanitizeConsole makes warn and error print only the fixed tag", () => {
  const origWarn = console.warn;
  const origError = console.error;
  const seen: unknown[][] = [];
  console.warn = (...a: unknown[]) => void seen.push(a);
  console.error = (...a: unknown[]) => void seen.push(a);
  try {
    sanitizeConsole();
    console.warn("secret", new Error("secret"));
    console.error("secret");
  } finally {
    console.warn = origWarn;
    console.error = origError;
  }
  assert.deepEqual(seen, [[SUPPRESSED_TAG], [SUPPRESSED_TAG]]);
});
