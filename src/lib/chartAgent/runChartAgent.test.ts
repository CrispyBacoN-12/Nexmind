// Tests for the chart-agent orchestrator with every dependency faked. The
// bars are built so the REAL splitSessions/computeLevels/findSetup produce a
// long sweep setup for a ticker; the AI and the DB are stubs.

import test from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import type { Review } from "./review";
import type { ChartSetupRow } from "./logRows";
import { SIP_DELAY_MS } from "@/lib/alpaca";
import { CHART_BAR_SECONDS, CHART_MAX_SETUPS } from "./types";
import { runChartAgent, type ChartDeps } from "./runChartAgent";

// Monday 2026-11-02 10:30 ET (EST, UTC-5) -> the regular session is open.
const NOW_OPEN = Date.parse("2026-11-02T15:30:00Z");
// Monday 07:00 ET -> pre-market.
const NOW_PRE = Date.parse("2026-11-02T12:00:00Z");
// Saturday -> closed.
const NOW_CLOSED = Date.parse("2026-11-07T15:30:00Z");

// Friday 2026-10-30 09:30 ET (EDT, UTC-4) and Monday 2026-11-02 09:30 ET (EST).
const PREV_OPEN = Date.parse("2026-10-30T13:30:00Z") / 1000;
const TODAY_OPEN = Date.parse("2026-11-02T14:30:00Z") / 1000;

function bar(t: number, h: number, l: number, c: number): Candle {
  return { t, o: c, h, l, c, v: 1000 };
}

/** Previous session: 78 bars ranging 99..105 around 100. */
function previousSession(): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < 78; i++) {
    let h = 100.8;
    let l = 99.5;
    if (i === 10) l = 99;
    if (i === 20) h = 105;
    out.push(bar(PREV_OPEN + i * 300, h, l, 100));
  }
  return out;
}

/** Today: a bar that pierces PDL (99) and closes back above, then holds. */
function sweepToday(): Candle[] {
  return [
    bar(TODAY_OPEN, 100.4, 99.9, 100.2),
    bar(TODAY_OPEN + 300, 100.2, 98.5, 99.5),
    bar(TODAY_OPEN + 600, 100.1, 99.4, 100),
  ];
}

/** Today with no sweep: price stays well above every sweep level. */
function quietToday(): Candle[] {
  return [
    bar(TODAY_OPEN, 100.4, 99.9, 100.2),
    bar(TODAY_OPEN + 300, 100.4, 99.9, 100.1),
  ];
}

const setupBars = (): Candle[] => [...previousSession(), ...sweepToday()];
const quietBars = (): Candle[] => [...previousSession(), ...quietToday()];

/** 25 daily candles of range 2 on 2026-10-05..; none dated today. */
function dailyBars(extraToday = false): Candle[] {
  const out: Candle[] = [];
  const start = Date.parse("2026-10-01T16:00:00Z") / 1000;
  for (let i = 0; i < 25; i++) out.push(bar(start + i * 86400, 101, 99, 100));
  if (extraToday) out.push(bar(Date.parse("2026-11-02T16:00:00Z") / 1000, 150, 50, 100));
  return out;
}

const kept: Review = { status: "kept", reading: "อ่านแล้ว", reason: null };

interface Calls {
  intraday: string[][];
  daily: string[][];
  review: string[][];
  recent: number[];
  logged: ChartSetupRow[][];
}

function makeDeps(
  over: Partial<ChartDeps> & { bars?: Map<string, Candle[]>; statuses?: Map<string, Review> } = {},
): { deps: ChartDeps; calls: Calls } {
  const calls: Calls = { intraday: [], daily: [], review: [], recent: [], logged: [] };
  const bars = over.bars ?? new Map<string, Candle[]>();
  const statuses = over.statuses ?? new Map<string, Review>();
  const deps: ChartDeps = {
    now: () => NOW_OPEN,
    fetchIntraday: async (t) => {
      calls.intraday.push(t);
      return bars;
    },
    fetchDaily: async (t) => {
      calls.daily.push(t);
      return new Map(t.map((x) => [x, dailyBars()]));
    },
    review: async (items) => {
      calls.review.push(items.map((i) => i.setup.ticker));
      calls.recent.push(...items.map((i) => i.recent.length));
      return {
        reviews: new Map(items.map((i) => [i.setup.ticker, statuses.get(i.setup.ticker) ?? kept])),
        backend: "cli",
        note: null,
      };
    },
    log: async (rows) => {
      calls.logged.push(rows);
    },
    runId: () => "run-1",
    ...over,
  };
  return { deps, calls };
}

test("closed phase: every ticker is none, nothing is fetched, reviewed or logged", async () => {
  const { deps, calls } = makeDeps({ now: () => NOW_CLOSED });
  const r = await runChartAgent(["AAA", "BBB"], deps);
  assert.ok(r.ok);
  assert.equal(r.phase, "closed");
  assert.deepEqual(r.shown, []);
  assert.deepEqual(r.none, [
    { ticker: "AAA", reason: "ตลาดปิดแล้ว" },
    { ticker: "BBB", reason: "ตลาดปิดแล้ว" },
  ]);
  assert.equal(r.dataAsOf, null);
  assert.equal(calls.intraday.length, 0);
  assert.equal(calls.daily.length, 0);
  assert.equal(calls.review.length, 0);
  assert.equal(calls.logged.length, 0);
});

test("pre-market phase: none with the no-bars-yet reason, no I/O", async () => {
  const { deps, calls } = makeDeps({ now: () => NOW_PRE });
  const r = await runChartAgent(["AAA"], deps);
  assert.ok(r.ok);
  assert.equal(r.phase, "pre");
  assert.deepEqual(r.none, [{ ticker: "AAA", reason: "ยังไม่มีแท่งในเวลาทำการ" }]);
  assert.equal(calls.intraday.length, 0);
  assert.equal(calls.logged.length, 0);
});

test("an intraday fetch that throws is ok:false", async () => {
  const { deps } = makeDeps({
    fetchIntraday: async () => {
      throw new Error("boom");
    },
  });
  const origWarn = console.warn;
  console.warn = () => {};
  let r;
  try {
    r = await runChartAgent(["AAA"], deps);
  } finally {
    console.warn = origWarn;
  }
  assert.deepEqual(r, { ok: false, error: "ไม่มีข้อมูลแท่ง 5 นาที" });
});

test("no ticker with any intraday bars is ok:false", async () => {
  const { deps } = makeDeps({ bars: new Map([["AAA", []]]) });
  const r = await runChartAgent(["AAA", "BBB"], deps);
  assert.deepEqual(r, { ok: false, error: "ไม่มีข้อมูลแท่ง 5 นาที" });
});

test("a ticker the data source has no bars for goes to none", async () => {
  const { deps } = makeDeps({ bars: new Map([["AAA", setupBars()]]) });
  const r = await runChartAgent(["AAA", "MISSING"], deps);
  assert.ok(r.ok);
  assert.deepEqual(r.shown.map((s) => s.setup.ticker), ["AAA"]);
  assert.deepEqual(r.none, [{ ticker: "MISSING", reason: "ไม่มีแท่งของตัวนี้" }]);
});

test("a shown setup carries previous+premarket+regular bars, ATR from daily bars without today's", async () => {
  const bars = setupBars();
  const { deps, calls } = makeDeps({
    bars: new Map([["AAA", bars]]),
    fetchDaily: async () => new Map([["AAA", dailyBars(true)]]),
  });
  const r = await runChartAgent(["AAA"], deps);
  assert.ok(r.ok);
  assert.equal(r.shown.length, 1);
  const s = r.shown[0];
  assert.equal(s.review.status, "kept");
  assert.equal(s.bars.length, bars.length);
  // Daily ATR is 2 (today's 150/50 forming bar was dropped): stop = sweep low - 0.1 * 2.
  assert.ok(Math.abs(s.setup.stop - (s.setup.sweepBar.l - 0.2)) < 1e-9, `stop ${s.setup.stop}`);
  assert.deepEqual(calls.review, [["AAA"]]);
  assert.equal(calls.recent[0], 3);
  assert.equal(r.backend, "cli");
  assert.equal(r.aiNote, null);
  assert.equal(r.logNote, null);
  assert.equal(r.dataAsOf, new Date((TODAY_OPEN + 600 + 300) * 1000).toISOString());
  assert.equal(calls.logged.length, 1);
  assert.equal(calls.logged[0][0].status, "shown");
  assert.equal(calls.logged[0][0].runId, "run-1");
});

test("a daily fetch that throws leaves the ATR uncomputable, not the run failed", async () => {
  const { deps } = makeDeps({
    bars: new Map([["AAA", setupBars()]]),
    fetchDaily: async () => {
      throw new Error("daily down");
    },
  });
  const origWarn = console.warn;
  console.warn = () => {};
  let r;
  try {
    r = await runChartAgent(["AAA"], deps);
  } finally {
    console.warn = origWarn;
  }
  assert.ok(r.ok);
  assert.deepEqual(r.none, [{ ticker: "AAA", reason: "ATR คำนวณไม่ได้" }]);
});

test("a ticker with no setup goes to none with the rule's reason; no setups means no review and no log", async () => {
  const { deps, calls } = makeDeps({ bars: new Map([["AAA", quietBars()]]) });
  const r = await runChartAgent(["AAA"], deps);
  assert.ok(r.ok);
  assert.deepEqual(r.none, [{ ticker: "AAA", reason: "ยังไม่มี sweep" }]);
  assert.equal(r.backend, "none");
  assert.equal(r.aiNote, null);
  assert.equal(calls.review.length, 0);
  assert.equal(calls.logged.length, 0);
});

test("a ticker whose levels cannot be computed goes to none with that error", async () => {
  // Only today's bars: there is no previous session.
  const { deps } = makeDeps({ bars: new Map([["AAA", sweepToday()]]) });
  const r = await runChartAgent(["AAA"], deps);
  assert.ok(r.ok);
  assert.deepEqual(r.none, [{ ticker: "AAA", reason: "ไม่มีวันทำการก่อนหน้า" }]);
});

test("input tickers are de-duplicated, order kept", async () => {
  const { deps, calls } = makeDeps({ bars: new Map([["AAA", quietBars()]]) });
  const r = await runChartAgent(["BBB", "AAA", "BBB"], deps);
  assert.ok(r.ok);
  assert.deepEqual(calls.intraday[0], ["BBB", "AAA"]);
  assert.deepEqual(r.none.map((n) => n.ticker), ["BBB", "AAA"]);
});

test("7 eligible setups: 5 shown, 2 logged as capped", async () => {
  const names = ["A1", "A2", "A3", "A4", "A5", "A6", "A7"];
  const { deps, calls } = makeDeps({
    bars: new Map(names.map((n) => [n, setupBars()])),
    fetchDaily: async (t) => new Map(t.map((x) => [x, dailyBars()])),
  });
  const r = await runChartAgent(names, deps);
  assert.ok(r.ok);
  assert.equal(CHART_MAX_SETUPS, 5);
  assert.deepEqual(r.shown.map((s) => s.setup.ticker), names.slice(0, 5));
  assert.deepEqual(r.rejected, []);
  assert.equal(calls.review.length, 1, "one review call for all setups");
  assert.equal(calls.review[0].length, 7);
  const rows = calls.logged[0];
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.map((x) => x.status), ["shown", "shown", "shown", "shown", "shown", "capped", "capped"]);
  assert.equal(r.cappedCount, 2);
});

test("a rejected and a stripped setup go to rejected and are logged with their status; they do not take a slot", async () => {
  const names = ["A1", "A2", "A3"];
  const statuses = new Map<string, Review>([
    ["A1", { status: "rejected", reading: "x", reason: "โครงสร้างไม่ดี" }],
    ["A2", { status: "stripped", reading: null, reason: "ตัดออก: มีคำทำนาย" }],
  ]);
  const { deps, calls } = makeDeps({
    bars: new Map(names.map((n) => [n, setupBars()])),
    statuses,
  });
  const r = await runChartAgent(names, deps);
  assert.ok(r.ok);
  assert.deepEqual(r.shown.map((s) => s.setup.ticker), ["A3"]);
  assert.equal(r.cappedCount, 0);
  assert.deepEqual(
    r.rejected.map((x) => [x.ticker, x.review.status]),
    [["A1", "rejected"], ["A2", "stripped"]],
  );
  const rows = calls.logged[0];
  assert.deepEqual(rows.map((x) => [x.ticker, x.status]), [
    ["A1", "ai_rejected"],
    ["A2", "guard_stripped"],
    ["A3", "shown"],
  ]);
  assert.equal(rows[0].aiRejectReason, "โครงสร้างไม่ดี");
});

test("AI unavailable (unread everywhere): every setup is eligible and the note is passed on", async () => {
  const names = ["A1", "A2"];
  const unread: Review = { status: "unread", reading: null, reason: "AI ไม่ได้อ่าน" };
  const { deps } = makeDeps({
    bars: new Map(names.map((n) => [n, setupBars()])),
    review: async (items) => ({
      reviews: new Map(items.map((i) => [i.setup.ticker, unread])),
      backend: "mock",
      note: "no AI backend",
    }),
  });
  const r = await runChartAgent(names, deps);
  assert.ok(r.ok);
  assert.deepEqual(r.shown.map((s) => s.setup.ticker), names);
  assert.ok(r.shown.every((s) => s.review.status === "unread"));
  assert.equal(r.aiNote, "no AI backend");
  assert.equal(r.backend, "mock");
});

// --- still-forming bars ------------------------------------------------------
// Alpaca's end is now - SIP_DELAY_MS and not bar-aligned, so its newest bar can
// be partial. A bar is read only once its end is at or before that cutoff.

/** Previous session + 09:30 quiet bar + 09:35 sweep bar (ends 09:40 ET). */
const sweepAsLastBar = (): Candle[] => [...previousSession(), ...sweepToday().slice(0, 2)];
const SWEEP_BAR_END_MS = (TODAY_OPEN + 300 + CHART_BAR_SECONDS) * 1000;

test("a bar that ends after now minus the SIP delay is ignored", async () => {
  // 1 ms short of a finished 09:35 bar: it would otherwise be the sweep bar.
  const now = SWEEP_BAR_END_MS + SIP_DELAY_MS - 1;
  const { deps, calls } = makeDeps({ now: () => now, bars: new Map([["AAA", sweepAsLastBar()]]) });
  const r = await runChartAgent(["AAA"], deps);
  assert.ok(r.ok);
  assert.equal(r.phase, "open");
  assert.deepEqual(r.shown, []);
  assert.deepEqual(r.none, [{ ticker: "AAA", reason: "ยังไม่มี sweep" }]);
  assert.equal(r.dataAsOf, new Date(TODAY_OPEN * 1000 + CHART_BAR_SECONDS * 1000).toISOString());
  assert.equal(calls.review.length, 0);
  assert.equal(calls.logged.length, 0);
});

test("a bar that ends exactly at now minus the SIP delay is read", async () => {
  const now = SWEEP_BAR_END_MS + SIP_DELAY_MS;
  const { deps } = makeDeps({ now: () => now, bars: new Map([["AAA", sweepAsLastBar()]]) });
  const r = await runChartAgent(["AAA"], deps);
  assert.ok(r.ok);
  assert.deepEqual(r.shown.map((s) => s.setup.ticker), ["AAA"]);
  assert.equal(r.shown[0].setup.sweepBar.t, TODAY_OPEN + 300);
  assert.equal(r.dataAsOf, new Date(SWEEP_BAR_END_MS).toISOString());
});

test("a forming bar does not move the entry or join the chart bars", async () => {
  // NOW_OPEN is 10:30 ET: the cutoff is 10:14, so a 10:10 bar is still forming.
  const forming = bar(TODAY_OPEN + 40 * 60, 100.5, 99.9, 100.4);
  const { deps } = makeDeps({ bars: new Map([["AAA", [...setupBars(), forming]]]) });
  const r = await runChartAgent(["AAA"], deps);
  assert.ok(r.ok);
  assert.equal(r.shown.length, 1);
  assert.equal(r.shown[0].setup.entry, 100);
  assert.equal(r.shown[0].bars.length, setupBars().length);
});

// --- superseded runs ---------------------------------------------------------

test("an already-aborted signal: no review, no log, ok:false cancelled", async () => {
  const { deps, calls } = makeDeps({ bars: new Map([["AAA", setupBars()]]), signal: AbortSignal.abort() });
  const r = await runChartAgent(["AAA"], deps);
  assert.deepEqual(r, { ok: false, error: "ยกเลิกแล้ว" });
  assert.equal(calls.review.length, 0);
  assert.equal(calls.logged.length, 0);
});

test("a signal aborted during the review: the run is cancelled and nothing is logged", async () => {
  const ctrl = new AbortController();
  const { deps: base } = makeDeps({ bars: new Map([["AAA", setupBars()]]) });
  const { deps, calls } = makeDeps({
    bars: new Map([["AAA", setupBars()]]),
    signal: ctrl.signal,
    review: async (items) => {
      ctrl.abort();
      return base.review(items);
    },
  });
  const r = await runChartAgent(["AAA"], deps);
  assert.deepEqual(r, { ok: false, error: "ยกเลิกแล้ว" });
  assert.equal(calls.logged.length, 0);
});

test("an intraday fetch failure is logged with its message", async () => {
  const { deps } = makeDeps({
    fetchIntraday: async () => {
      throw new Error("alpaca 500");
    },
  });
  const warned: unknown[][] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warned.push(args);
  };
  try {
    await runChartAgent(["AAA"], deps);
  } finally {
    console.warn = origWarn;
  }
  assert.deepEqual(warned, [["chart-agent: intraday fetch failed:", "alpaca 500"]]);
});

test("a log failure sets logNote and never fails the run", async () => {
  const { deps } = makeDeps({
    bars: new Map([["AAA", setupBars()]]),
    log: async () => {
      throw new Error("db down");
    },
  });
  const r = await runChartAgent(["AAA"], deps);
  assert.ok(r.ok);
  assert.equal(r.shown.length, 1);
  assert.equal(r.logNote, "บันทึกลงฐานข้อมูลไม่ได้: db down");
});
