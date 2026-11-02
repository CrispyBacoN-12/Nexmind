import test from "node:test";
import assert from "node:assert/strict";
import { runScorecardDaily, type DailyDeps, type ScorecardRunInput } from "./runDaily";
import type { ChartAgentResult } from "@/lib/chartAgent/runChartAgent";
import type { ScanResult } from "@/lib/scanAgent/types";
import type { Review } from "@/lib/chartAgent/review";
import { CHART_TOP_N } from "@/lib/chartAgent/types";

// 2026-11-03 is a Tuesday; EST (UTC-5) from 2026-11-01. 15:45 UTC = 10:45 ET.
const at = (iso: string) => Date.parse(iso);
const IN_WINDOW = at("2026-11-03T15:45:00Z");
const SESSION = "2026-11-03";

const scanOk = (n = 25): ScanResult =>
  ({
    ok: true,
    scannedAt: "x",
    phase: "open",
    sessionDate: SESSION,
    universeSize: 500,
    covered: 480,
    passed: n,
    rows: Array.from({ length: n }, (_, i) => ({ rank: i + 1, ticker: `T${i + 1}` })),
    econ: null,
    sources: [],
    scoreFormula: "",
  }) as unknown as ScanResult;

const kept = (): Review => ({ status: "kept", reading: "อ่าน", reason: null });
const unread = (): Review => ({ status: "unread", reading: null, reason: "AI ไม่ได้อ่าน" });
const rejected = (): Review => ({ status: "rejected", reading: null, reason: "x" });
const stripped = (): Review => ({ status: "stripped", reading: null, reason: "x" });
const shownOf = (reviews: Review[]) => reviews.map((review, i) => ({ setup: { ticker: `S${i}` }, review, bars: [] }));

const chartOk = (over: Record<string, unknown> = {}): ChartAgentResult =>
  ({
    ok: true,
    ranAt: "x",
    phase: "open",
    dataAsOf: "2026-11-03T15:30:00.000Z",
    shown: shownOf([kept(), kept(), unread()]),
    rejected: [{ ticker: "R", review: rejected() }],
    cappedCount: 0,
    none: [],
    aiNote: null,
    logNote: null,
    backend: "cli",
    model: "claude-sonnet-4-5",
    ...over,
  }) as unknown as ChartAgentResult;

function harness(over: Partial<DailyDeps> = {}) {
  const calls = { scan: 0, chart: [] as { tickers: string[]; runId: string }[], record: [] as ScorecardRunInput[] };
  const deps: DailyDeps = {
    now: () => IN_WINDOW,
    alreadyRan: async () => false,
    scan: async () => {
      calls.scan++;
      return scanOk();
    },
    chart: async (tickers, runId) => {
      calls.chart.push({ tickers, runId });
      return chartOk();
    },
    record: async (r) => {
      calls.record.push(r);
    },
    newRunId: () => "run-1",
    ...over,
  };
  return { deps, calls };
}

test("outside the window does nothing", async () => {
  // 09:30 ET, 11:30 ET (end is exclusive), 10:29 ET
  for (const iso of ["2026-11-03T14:30:00Z", "2026-11-03T16:30:00Z", "2026-11-03T15:29:00Z"]) {
    const { deps, calls } = harness({ now: () => at(iso) });
    const r = await runScorecardDaily(deps);
    assert.equal(r.action, "outside_window", iso);
    assert.equal(calls.record.length, 0);
    assert.equal(calls.scan, 0);
  }
});

test("the window starts at 10:30 ET inclusive", async () => {
  const { deps, calls } = harness({ now: () => at("2026-11-03T15:30:00Z") });
  assert.equal((await runScorecardDaily(deps)).action, "ran");
  assert.equal(calls.record.length, 1);
});

test("the window follows New York time across DST", async () => {
  // 2026-07-01 is EDT (UTC-4): 14:45 UTC = 10:45 ET.
  const { deps } = harness({ now: () => at("2026-07-01T14:45:00Z") });
  assert.equal((await runScorecardDaily(deps)).action, "ran");
});

test("weekend does nothing", async () => {
  // Saturday 2026-11-07, 10:45 ET
  const { deps, calls } = harness({ now: () => at("2026-11-07T15:45:00Z") });
  const r = await runScorecardDaily(deps);
  assert.equal(r.action, "outside_window");
  assert.equal(calls.record.length, 0);
  assert.equal(calls.scan, 0);
});

test("already ran does nothing", async () => {
  const asked: string[] = [];
  const { deps, calls } = harness({
    alreadyRan: async (s) => {
      asked.push(s);
      return true;
    },
  });
  const r = await runScorecardDaily(deps);
  assert.equal(r.action, "already_ran");
  assert.equal(r.sessionDate, SESSION);
  assert.deepEqual(asked, [SESSION]);
  assert.equal(calls.scan, 0);
  assert.equal(calls.chart.length, 0);
  assert.equal(calls.record.length, 0);
});

test("holiday records no_session", async () => {
  const { deps, calls } = harness({ chart: async () => chartOk({ dataAsOf: null, shown: [], rejected: [] }) });
  const r = await runScorecardDaily(deps);
  assert.equal(r.action, "no_session");
  assert.equal(calls.record.length, 1);
  assert.equal(calls.record[0].status, "no_session");
  assert.equal(calls.record[0].sessionDate, SESSION);
  assert.equal(calls.record[0].setups, 0);
});

test("scan failure records failed", async () => {
  const { deps, calls } = harness({ scan: async () => ({ ok: false, error: "tv down" }) });
  const r = await runScorecardDaily(deps);
  assert.equal(r.action, "failed");
  assert.equal(r.note, "tv down");
  assert.equal(calls.chart.length, 0);
  assert.equal(calls.record.length, 1);
  assert.equal(calls.record[0].status, "failed");
  assert.equal(calls.record[0].error, "tv down");
});

test("a scan that throws records failed", async () => {
  const { deps, calls } = harness({
    scan: async () => {
      throw new Error("boom");
    },
  });
  const r = await runScorecardDaily(deps);
  assert.equal(r.action, "failed");
  assert.equal(calls.record[0].status, "failed");
  assert.match(calls.record[0].error ?? "", /boom/);
});

test("chart failure records failed", async () => {
  const { deps, calls } = harness({ chart: async () => ({ ok: false, error: "no bars" }) });
  const r = await runScorecardDaily(deps);
  assert.equal(r.action, "failed");
  assert.equal(calls.record[0].status, "failed");
  assert.equal(calls.record[0].error, "no bars");
});

test("chart gets the scan's first CHART_TOP_N tickers", async () => {
  const { deps, calls } = harness();
  await runScorecardDaily(deps);
  assert.equal(calls.chart[0].tickers.length, CHART_TOP_N);
  assert.deepEqual(calls.chart[0].tickers.slice(0, 3), ["T1", "T2", "T3"]);
});

test("ran records counts", async () => {
  const { deps, calls } = harness({
    chart: async () =>
      chartOk({
        shown: shownOf([kept(), kept(), unread()]),
        rejected: [{ ticker: "R", review: rejected() }],
      }),
  });
  const r = await runScorecardDaily(deps);
  assert.equal(r.action, "ran");
  const rec = calls.record[0];
  assert.equal(rec.status, "ran");
  assert.equal(rec.setups, 4);
  assert.equal(rec.kept, 2);
  assert.equal(rec.vetoed, 1);
  assert.equal(rec.unread, 1);
  assert.equal(rec.stripped, 0);
  assert.equal(rec.aiBackend, "cli");
  assert.equal(rec.aiModel, "claude-sonnet-4-5");
  assert.equal(rec.sessionDate, SESSION);
});

test("stripped reviews count as stripped, not vetoed", async () => {
  const { deps, calls } = harness({
    chart: async () =>
      chartOk({ shown: shownOf([kept()]), rejected: [{ ticker: "A", review: rejected() }, { ticker: "B", review: stripped() }] }),
  });
  await runScorecardDaily(deps);
  const rec = calls.record[0];
  assert.equal(rec.vetoed, 1);
  assert.equal(rec.stripped, 1);
  assert.equal(rec.setups, 3);
});

test("capped setups count as kept when the AI ran, unread when it did not", async () => {
  const withAi = harness({ chart: async () => chartOk({ shown: shownOf([kept(), kept()]), rejected: [], cappedCount: 3 }) });
  await runScorecardDaily(withAi.deps);
  assert.equal(withAi.calls.record[0].setups, 5);
  assert.equal(withAi.calls.record[0].kept, 5);
  assert.equal(withAi.calls.record[0].unread, 0);

  const noAi = harness({
    chart: async () =>
      chartOk({ shown: shownOf([unread(), unread()]), rejected: [], cappedCount: 3, backend: "mock", model: null }),
  });
  await runScorecardDaily(noAi.deps);
  assert.equal(noAi.calls.record[0].setups, 5);
  assert.equal(noAi.calls.record[0].kept, 0);
  assert.equal(noAi.calls.record[0].unread, 5);
});

test("a ran day with zero setups is still ran", async () => {
  const { deps, calls } = harness({ chart: async () => chartOk({ shown: [], rejected: [], cappedCount: 0 }) });
  const r = await runScorecardDaily(deps);
  assert.equal(r.action, "ran");
  assert.equal(calls.record[0].setups, 0);
});

test("passes the same runId to chart and record", async () => {
  const { deps, calls } = harness({ newRunId: () => "abc-123" });
  await runScorecardDaily(deps);
  assert.equal(calls.chart[0].runId, "abc-123");
  assert.equal(calls.record[0].runId, "abc-123");
});

test("record throwing is reported as failed, not thrown", async () => {
  let n = 0;
  const { deps } = harness({
    record: async () => {
      n++;
      throw new Error("db down");
    },
  });
  const r = await runScorecardDaily(deps);
  assert.equal(r.action, "failed");
  assert.match(r.note ?? "", /db down/);
  assert.equal(n, 1);
});
