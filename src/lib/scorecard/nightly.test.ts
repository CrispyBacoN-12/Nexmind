import "dotenv/config"; // nightly.ts -> control.ts reaches prisma via research/control.ts
import test from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import { etClock } from "@/lib/scanAgent/session";
import { controlWindow, runScorecardNightly, windowElapsed, type AiVerdict, type LiveSnapshot, type NightlyDeps, type NightlyRow, type NightlyRun } from "./nightly";
import { controlDistribution, type ControlTrade } from "./control";
import { rMultiple } from "./score";
import type { ExitVariant, Outcome } from "./types";

function etEpoch(date: string, hhmm: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const wanted = h * 60 + mi;
  for (const offset of [4, 5]) {
    const ms = Date.UTC(y, mo - 1, d, h + offset, mi);
    const c = etClock(ms / 1000);
    if (c.date === date && c.minutes === wanted) return ms / 1000;
  }
  throw new Error(`cannot resolve ${date} ${hhmm} ET`);
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Flat 5-minute bars on `date` from `fromMin` through 15:55 ET; never touch stop 99 or T1 102. */
function flatBars(date: string, fromMin = 570): Candle[] {
  const bars: Candle[] = [];
  for (let m = fromMin; m < 960; m += 5) bars.push({ t: etEpoch(date, hhmm(m)), o: 100, h: 100.2, l: 99.8, c: 100, v: 1000 });
  return bars;
}

const closedOutcome = (over: Partial<Outcome> = {}): Outcome => ({
  status: "closed",
  fillAt: etEpoch("2026-10-01", "15:20"),
  fill: 100,
  exitAt: etEpoch("2026-10-01", "15:40"),
  exitPrice: 102,
  exitReason: "t1",
  r: 0.5,
  sessionsHeld: 1,
  ...over,
});

function row(over: Partial<NightlyRow> = {}): NightlyRow {
  return {
    id: 1,
    createdAt: new Date(etEpoch("2026-11-02", "10:30") * 1000),
    ticker: "AAA",
    status: "shown",
    aiReading: "อ่านโครงสร้าง",
    aiModel: "claude-sonnet-x",
    entry: 100,
    stop: 99,
    t1: 102,
    outcomes: {},
    ...over,
  };
}

interface Recorded {
  fetches: { tickers: string[]; fromSec: number; toSec: number }[];
  saved: { chartSetupId: number; variant: ExitVariant; outcome: Outcome }[];
  live: LiveSnapshot[];
  verdicts: AiVerdict[];
  sent: string[];
  runsSince: string[];
}

function deps(opts: {
  nowMs: number;
  rows: NightlyRow[];
  bars?: (ticker: string, fromSec: number, toSec: number) => Candle[] | undefined;
  runs?: NightlyRun[];
  verdict?: unknown;
}): { deps: NightlyDeps; rec: Recorded } {
  const rec: Recorded = { fetches: [], saved: [], live: [], verdicts: [], sent: [], runsSince: [] };
  return {
    rec,
    deps: {
      now: () => opts.nowMs,
      loadRows: async () => opts.rows,
      fetchBars: async (tickers, fromSec, toSec) => {
        rec.fetches.push({ tickers: [...tickers].sort(), fromSec, toSec });
        const m = new Map<string, Candle[]>();
        for (const t of tickers) {
          const b = opts.bars?.(t, fromSec, toSec);
          if (b) m.set(t, b);
        }
        return m;
      },
      saveOutcomes: async (rows) => {
        rec.saved.push(...rows);
      },
      loadRuns: async (since) => {
        rec.runsSince.push(since);
        return opts.runs ?? [];
      },
      loadVerdict: async () => opts.verdict ?? null,
      saveLive: async (d) => {
        rec.live.push(d);
      },
      saveVerdict: async (d) => {
        rec.verdicts.push(d);
      },
      send: async (m) => {
        rec.sent.push(m);
      },
    },
  };
}

// Tue 2026-11-03 08:00 ET: Monday's session is complete.
const NOV3 = etEpoch("2026-11-03", "08:00") * 1000;

test("scores open rows and never rescans closed ones", async () => {
  const closedRow = row({ id: 1, ticker: "DONE", outcomes: { hold: closedOutcome(), sameDay: closedOutcome() } });
  const fresh = row({ id: 2, ticker: "NEW" });
  const halfOpen = row({
    id: 3,
    ticker: "HALF",
    createdAt: new Date(etEpoch("2026-11-02", "10:35") * 1000),
    outcomes: { hold: { ...closedOutcome(), status: "open", exitAt: null, exitPrice: null, exitReason: null, r: null }, sameDay: closedOutcome() },
  });
  const { deps: d, rec } = deps({ nowMs: NOV3, rows: [closedRow, fresh, halfOpen], bars: () => flatBars("2026-11-02") });

  await runScorecardNightly(d);

  assert.equal(rec.fetches.length, 1);
  // SPY rides along as the market calendar.
  assert.deepEqual(rec.fetches[0].tickers, ["HALF", "NEW", "SPY"]);
  assert.equal(rec.fetches[0].fromSec, etEpoch("2026-11-02", "10:30") - 86_400);
  assert.equal(rec.fetches[0].toSec, Math.floor((NOV3 - 16 * 60_000) / 1000));

  const keys = rec.saved.map((s) => `${s.chartSetupId}:${s.variant}`).sort();
  assert.deepEqual(keys, ["2:hold", "2:sameDay", "3:hold"]);
  const byKey = new Map(rec.saved.map((s) => [`${s.chartSetupId}:${s.variant}`, s.outcome]));
  assert.equal(byKey.get("2:hold")!.status, "open"); // one session of ten
  assert.equal(byKey.get("2:hold")!.fill, 100);
  assert.equal(byKey.get("2:sameDay")!.status, "closed");
  assert.equal(byKey.get("2:sameDay")!.exitReason, "time");
  assert.equal(rec.live.length, 1);
  assert.equal(rec.sent.length, 1);
});

test("nothing to score: no bar fetch, nothing saved", async () => {
  const done = row({ outcomes: { hold: closedOutcome(), sameDay: closedOutcome() } });
  const { deps: d, rec } = deps({ nowMs: NOV3, rows: [done] });
  await runScorecardNightly(d);
  assert.equal(rec.fetches.length, 0);
  assert.equal(rec.saved.length, 0);
});

test("no bars → open, then no_data after 15 days", async () => {
  const r = row({ ticker: "GONE" });
  // No bars at all for the ticker.
  const early = deps({ nowMs: NOV3, rows: [r] });
  await runScorecardNightly(early.deps);
  assert.deepEqual(early.rec.saved.map((s) => s.outcome.status), ["open", "open"]);
  assert.ok(early.rec.saved.every((s) => s.outcome.fill === null));

  const late = deps({ nowMs: r.createdAt.getTime() + 15 * 86_400_000, rows: [r] });
  await runScorecardNightly(late.deps);
  assert.deepEqual(late.rec.saved.map((s) => s.outcome.status), ["no_data", "no_data"]);

  // 14.9 days: still open.
  const almost = deps({ nowMs: r.createdAt.getTime() + 14.9 * 86_400_000, rows: [r] });
  await runScorecardNightly(almost.deps);
  assert.deepEqual(almost.rec.saved.map((s) => s.outcome.status), ["open", "open"]);
});

test("bars on other days but no regular bar on the run date → open, never not_filled", async () => {
  const r = row({ ticker: "HALT" });
  // Pre-market bars on the run date and a full session the next day, nothing regular on the run date.
  const pre = [480, 485, 490].map((m) => ({ t: etEpoch("2026-11-02", hhmm(m)), o: 100, h: 100, l: 100, c: 100, v: 10 }));
  const nowMs = etEpoch("2026-11-04", "08:00") * 1000;
  const { deps: d, rec } = deps({ nowMs, rows: [r], bars: () => [...pre, ...flatBars("2026-11-03")] });
  await runScorecardNightly(d);
  assert.deepEqual(rec.saved.map((s) => s.outcome.status), ["open", "open"]);

  const late = deps({ nowMs: r.createdAt.getTime() + 16 * 86_400_000, rows: [r], bars: () => [...pre, ...flatBars("2026-11-03")] });
  await runScorecardNightly(late.deps);
  assert.deepEqual(late.rec.saved.map((s) => s.outcome.status), ["no_data", "no_data"]);
});

test("a filled open row whose bars vanish keeps its outcome", async () => {
  const open: Outcome = { ...closedOutcome({ fillAt: etEpoch("2026-11-02", "10:30") }), status: "open", exitAt: null, exitPrice: null, exitReason: null, r: null };
  const r = row({ outcomes: { hold: open, sameDay: closedOutcome() } });
  const { deps: d, rec } = deps({ nowMs: r.createdAt.getTime() + 20 * 86_400_000, rows: [r] });
  const snap = await runScorecardNightly(d);
  assert.equal(rec.saved.length, 0);
  assert.equal(snap.recentTrades[0].hold.status, "open");
});

// --- The frozen AI verdict ------------------------------------------------------

const V_DAY = "2026-10-01"; // Thursday
const V_LATER = ["2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14"];
/** The run day's last 40 minutes and one bar on each of the next 9 sessions: 10 complete sessions. */
const verdictBars = (): Candle[] => [
  ...flatBars(V_DAY, 920),
  ...V_LATER.map((d) => ({ t: etEpoch(d, "15:55"), o: 100, h: 100.2, l: 99.8, c: 100, v: 1000 })),
];
const V_NOW = etEpoch("2026-10-20", "08:00") * 1000;

function keptSample(n: number, over: Partial<NightlyRow> = {}): NightlyRow[] {
  return Array.from({ length: n }, (_, i) =>
    row({
      id: i + 1,
      ticker: `K${i}`,
      createdAt: new Date(etEpoch(V_DAY, "15:20") * 1000),
      aiModel: i < 200 ? "claude-sonnet-a" : "claude-sonnet-b",
      outcomes: { hold: closedOutcome(), sameDay: closedOutcome() },
      ...over,
    }),
  );
}

test("freezes the AI verdict exactly once", async () => {
  const rows = [...keptSample(300), row({ id: 301, ticker: "LATE", createdAt: new Date(etEpoch("2026-10-02", "10:30") * 1000), outcomes: { hold: closedOutcome({ r: 9 }), sameDay: closedOutcome() } })];
  const { deps: d, rec } = deps({ nowMs: V_NOW, rows, bars: () => verdictBars() });

  const snap = await runScorecardNightly(d);

  assert.equal(rec.verdicts.length, 1);
  const v = rec.verdicts[0];
  assert.equal(v.n, 300);
  assert.equal(v.firstId, 1);
  assert.equal(v.lastId, 300);
  assert.ok(Math.abs(v.meanR - 0.5) < 1e-12); // the late row's 9R is not in the sample
  assert.deepEqual(v.modelMix, { "claude-sonnet-a": 200, "claude-sonnet-b": 100 });
  assert.equal(v.runs, 200);
  assert.ok(v.controlP95 < 0, `flat control loses its costs, p95 ${v.controlP95}`);
  assert.equal(v.pass, true);
  // First the SPY calendar (from the sample's last run − 1 day), then the sample's own
  // tickers plus SPY (to check each row's 10 sessions) in one call per run date.
  assert.deepEqual(rec.fetches[0], { tickers: ["SPY"], fromSec: etEpoch(V_DAY, "15:20") - 86_400, toSec: Math.floor((V_NOW - 16 * 60_000) / 1000) });
  assert.equal(rec.fetches.length, 2);
  assert.equal(rec.fetches[1].tickers.length, 301);
  assert.ok(rec.fetches[1].tickers.includes("SPY"));
  assert.equal(snap.verdictPending, null);
  assert.ok(!rec.fetches[1].tickers.includes("LATE"));
  assert.equal(snap.verdict?.n, 300);
  assert.deepEqual(snap.keptControl, { median: v.controlMedian, p95: v.controlP95, runs: v.runs });
  assert.equal(snap.stats.afterVerdict.hold.n, 1);
  assert.equal(snap.stats.kept.hold.n, 300);

  // With a verdict already stored it is never written again.
  const again = deps({ nowMs: V_NOW, rows, bars: () => verdictBars(), verdict: v });
  const snap2 = await runScorecardNightly(again.deps);
  assert.equal(again.rec.verdicts.length, 0);
  assert.equal(again.rec.fetches.length, 0);
  assert.equal(snap2.verdict?.computedAt, v.computedAt);
});

test("no freeze while a sample window is still open", async () => {
  // 10-14 is the 10th session; at 10-14 12:00 ET it is not complete.
  const nowMs = etEpoch("2026-10-14", "12:00") * 1000;
  const { deps: d, rec } = deps({ nowMs, rows: keptSample(300), bars: () => verdictBars() });
  const snap = await runScorecardNightly(d);
  assert.equal(rec.verdicts.length, 0);
  // Only the SPY calendar is read; the sample's bars wait for the night it is ready.
  assert.deepEqual(rec.fetches.map((f) => f.tickers), [["SPY"]]);
  assert.equal(snap.keptControl, null);
});

test("unread rows never count toward 300", async () => {
  const unread = keptSample(300, { aiReading: null });
  const kept = keptSample(2).map((r, i) => ({ ...r, id: 1000 + i, ticker: `KEPT${i}` }));
  const { deps: d, rec } = deps({ nowMs: V_NOW, rows: [...unread, ...kept], bars: () => verdictBars() });
  const snap = await runScorecardNightly(d);
  assert.equal(rec.verdicts.length, 0);
  assert.equal(snap.keptProgress.n, 2);
  assert.equal(snap.stats.unread.hold.n, 300);
  assert.equal(snap.stats.kept.hold.n, 2);
  assert.deepEqual(snap.modelMix, { "claude-sonnet-a": 2 });
  assert.equal(snap.keptControl, null); // no live control before the verdict
});

test("missed weekday shows in the snapshot", async () => {
  // Sat 2026-11-07 07:00 ICT = Fri 2026-11-06 19:00 ET (EST).
  const nowMs = Date.parse("2026-11-07T00:00:00Z");
  const ran = (sessionDate: string, status: string, error: string | null = null): NightlyRun => ({
    sessionDate,
    status,
    error,
    runId: "r",
    ranAt: new Date(etEpoch(sessionDate, "10:31") * 1000),
  });
  const runs = [ran("2026-11-02", "ran"), ran("2026-11-03", "no_session"), ran("2026-11-04", "failed", "scan พัง")];
  // 11-05 has no run row, but its setups were logged (the run row write failed): it ran.
  const orphan = row({ id: 9, createdAt: new Date(etEpoch("2026-11-05", "10:35") * 1000), outcomes: { hold: closedOutcome(), sameDay: closedOutcome() } });
  const { deps: d, rec } = deps({ nowMs, rows: [orphan], runs });

  const snap = await runScorecardNightly(d);

  assert.deepEqual(snap.missed, [
    { date: "2026-11-04", failed: "scan พัง" },
    { date: "2026-11-06", failed: null },
  ]);
  assert.equal(snap.sessionDate, "2026-11-06");
  assert.equal(snap.lastRun.status, "none");
  // 30 weekdays ending 11-06 start on 2026-09-28.
  assert.deepEqual(rec.runsSince, ["2026-09-28"]);
  assert.match(rec.sent[0], /ไม่ได้รัน \(คอมปิด\?\)/);
});

test("last night's counts come from the setup rows; AI down when only unread", async () => {
  const nowMs = Date.parse("2026-11-04T00:00:00Z"); // Tue 11-03 19:00 ET
  const at = new Date(etEpoch("2026-11-03", "10:31") * 1000);
  const rows = [
    row({ id: 1, createdAt: at, aiReading: null, ticker: "U1" }),
    row({ id: 2, createdAt: at, aiReading: null, ticker: "U2", status: "capped" }),
  ];
  const runs: NightlyRun[] = [{ sessionDate: "2026-11-03", status: "ran", runId: "r", kept: 2, unread: 0, setups: 2, ranAt: at }];
  const { deps: d, rec } = deps({ nowMs, rows, runs, bars: () => flatBars("2026-11-03") });
  const snap = await runScorecardNightly(d);
  assert.equal(snap.lastRun.unread, 2);
  assert.equal(snap.lastRun.kept, 0);
  assert.equal(snap.lastRun.aiDown, true);
  assert.match(rec.sent[0], /AI ไม่ทำงานเมื่อคืน/);
});

test("windowElapsed counts ten complete sessions from the fill date on the calendar bars (SPY)", () => {
  const bars = verdictBars();
  const fillAt = etEpoch(V_DAY, "15:20");
  assert.equal(windowElapsed(bars, fillAt, etEpoch("2026-10-14", "16:00")), true);
  assert.equal(windowElapsed(bars, fillAt, etEpoch("2026-10-14", "15:59")), false);
  assert.equal(windowElapsed(bars.slice(0, -1), fillAt, V_NOW / 1000), false); // only 9 sessions
  assert.equal(windowElapsed(bars, null, V_NOW / 1000), false);
});

test("cumulative R is credited on the exit date", async () => {
  const a = row({ id: 1, outcomes: { hold: closedOutcome({ r: 1, exitAt: etEpoch("2026-10-05", "11:00") }), sameDay: closedOutcome() } });
  const b = row({ id: 2, outcomes: { hold: closedOutcome({ r: -1, exitAt: etEpoch("2026-10-02", "11:00") }), sameDay: closedOutcome() } });
  const c = row({ id: 3, outcomes: { hold: closedOutcome({ r: 0.5, exitAt: etEpoch("2026-10-05", "14:00") }), sameDay: closedOutcome() } });
  const { deps: d } = deps({ nowMs: V_NOW, rows: [a, b, c] });
  const snap = await runScorecardNightly(d);
  assert.deepEqual(snap.cumulativeR.kept, [
    { date: "2026-10-02", cumR: -1, n: 1 },
    { date: "2026-10-05", cumR: 0.5, n: 3 },
  ]);
  assert.deepEqual(snap.cumulativeR.vetoed, []);
});

test("controlWindow drops bars the control can never read (extended hours, sessions past the tenth)", () => {
  const pre = [480, 485].map((m) => ({ t: etEpoch(V_DAY, hhmm(m)), o: 100, h: 100, l: 100, c: 100, v: 1 }));
  const past = ["2026-10-15", "2026-10-16"].map((d) => ({ t: etEpoch(d, "15:55"), o: 50, h: 50, l: 50, c: 50, v: 1 }));
  const noisy = [...pre, ...verdictBars(), ...past];
  const runAt = etEpoch(V_DAY, "15:20");
  assert.deepEqual(controlWindow(noisy, runAt), verdictBars());
  const trade = (id: number, bars: Candle[]): ControlTrade => ({ id, runAtSec: runAt, fill: 100, stop: 99, t1: 102, bars, cutoffSec: V_NOW / 1000 });
  const full = controlDistribution([1, 2, 3].map((id) => trade(id, noisy)), "hold");
  const trimmed = controlDistribution([1, 2, 3].map((id) => trade(id, controlWindow(noisy, runAt))), "hold");
  assert.ok(full);
  assert.deepEqual(trimmed, full);
});

// --- Fix round 1 -------------------------------------------------------------

test("a filled row whose bars stop after 3 sessions closes at its last close when SPY completes session 10", async () => {
  // Own bars: the run day from 15:20 and two more sessions; the last close is 101.
  const own: Candle[] = [
    ...flatBars(V_DAY, 920),
    { t: etEpoch("2026-10-02", "15:55"), o: 100, h: 100.2, l: 99.8, c: 100, v: 1000 },
    { t: etEpoch("2026-10-05", "15:50"), o: 100, h: 100.2, l: 99.8, c: 100.5, v: 1000 },
    { t: etEpoch("2026-10-05", "15:55"), o: 100, h: 100.2, l: 99.8, c: 101, v: 1000 },
  ];
  const r = row({ id: 7, ticker: "HALT", createdAt: new Date(etEpoch(V_DAY, "15:20") * 1000) });
  const bars = (t: string) => (t === "SPY" ? verdictBars() : own);

  // 10-14 12:00 ET: SPY's 10th session has not completed. Still open.
  const before = deps({ nowMs: etEpoch("2026-10-14", "12:00") * 1000, rows: [r], bars });
  await runScorecardNightly(before.deps);
  const holdBefore = before.rec.saved.find((s) => s.variant === "hold")!.outcome;
  assert.equal(holdBefore.status, "open");
  assert.equal(holdBefore.fill, 100);

  // After 10-14 16:00 ET it has: close at the last finished regular close.
  const after = deps({ nowMs: V_NOW, rows: [r], bars });
  const snap = await runScorecardNightly(after.deps);
  const hold = after.rec.saved.find((s) => s.variant === "hold")!.outcome;
  assert.equal(hold.status, "closed");
  assert.equal(hold.exitReason, "time");
  assert.equal(hold.exitPrice, 101);
  assert.equal(hold.exitAt, etEpoch("2026-10-05", "15:55") + 300);
  assert.equal(hold.sessionsHeld, 3);
  assert.ok(Math.abs((hold.r as number) - rMultiple(100, 101, 99)) < 1e-12);
  // sameDay closed normally at the run day's close.
  const sameDay = after.rec.saved.find((s) => s.variant === "sameDay")!.outcome;
  assert.equal(sameDay.status, "closed");
  assert.equal(sameDay.sessionsHeld, 1);
  assert.equal(snap.recentTrades[0].hold.status, "closed");
});

test("a stored open fill whose own bars end on the fill day closes once the SPY window has elapsed", async () => {
  // Stored hold open with a fill; tonight's own bars still show the fill day only.
  const stored: Outcome = { status: "open", fillAt: etEpoch(V_DAY, "15:20"), fill: 100, exitAt: null, exitPrice: null, exitReason: null, r: null, sessionsHeld: 1 };
  const r = row({ id: 8, ticker: "GONE", createdAt: new Date(etEpoch(V_DAY, "15:20") * 1000), outcomes: { hold: stored, sameDay: closedOutcome() } });
  const { deps: d, rec } = deps({ nowMs: V_NOW, rows: [r], bars: (t) => (t === "SPY" ? verdictBars() : flatBars(V_DAY, 920)) });
  await runScorecardNightly(d);
  assert.equal(rec.saved.length, 1);
  assert.equal(rec.saved[0].outcome.status, "closed");
  assert.equal(rec.saved[0].outcome.exitAt, etEpoch(V_DAY, "15:55") + 300);
  assert.equal(rec.saved[0].outcome.sessionsHeld, 1);
});

test("AI down only when every setup was unread: a veto proves the AI answered", async () => {
  const nowMs = Date.parse("2026-11-04T00:00:00Z"); // Tue 11-03 19:00 ET
  const at = new Date(etEpoch("2026-11-03", "10:31") * 1000);
  const runs: NightlyRun[] = [{ sessionDate: "2026-11-03", status: "ran", runId: "r", ranAt: at }];
  const mixed = [
    row({ id: 1, createdAt: at, aiReading: null, ticker: "V1", status: "ai_rejected" }),
    row({ id: 2, createdAt: at, aiReading: null, ticker: "U1" }),
    row({ id: 3, createdAt: at, aiReading: null, ticker: "U2" }),
  ];
  const m = deps({ nowMs, rows: mixed, runs, bars: () => flatBars("2026-11-03") });
  const snap = await runScorecardNightly(m.deps);
  assert.equal(snap.lastRun.vetoed, 1);
  assert.equal(snap.lastRun.unread, 2);
  assert.equal(snap.lastRun.aiDown, false);
  assert.doesNotMatch(m.rec.sent[0], /AI ไม่ทำงาน/);

  const allUnread = deps({ nowMs, rows: mixed.slice(1), runs, bars: () => flatBars("2026-11-03") });
  assert.equal((await runScorecardNightly(allUnread.deps)).lastRun.aiDown, true);
});

test("a failed run row outranks orphan rows on the run line", async () => {
  const nowMs = Date.parse("2026-11-04T00:00:00Z");
  const at = new Date(etEpoch("2026-11-03", "10:31") * 1000);
  const runs: NightlyRun[] = [{ sessionDate: "2026-11-03", status: "failed", runId: "r", error: "บันทึก setup ไม่ได้", ranAt: at }];
  const rows = [row({ id: 1, createdAt: at, ticker: "P1" })];
  const { deps: d, rec } = deps({ nowMs, rows, runs, bars: () => flatBars("2026-11-03") });
  const snap = await runScorecardNightly(d);
  assert.equal(snap.lastRun.status, "failed");
  assert.equal(snap.lastRun.error, "บันทึก setup ไม่ได้");
  assert.equal(snap.lastRun.setups, 1);
  assert.match(rec.sent[0], /รอบอัตโนมัติเมื่อคืน: ล้มเหลว: บันทึก setup ไม่ได้/);
  // The day still is not "missed": its setups were logged.
  assert.ok(!snap.missed.some((m) => m.date === "2026-11-03"));
});

test("afterVerdict is anchored on the stored verdict's lastId; kept's cumulative line excludes it", async () => {
  // 300 closed kept rows on 10-01, ids 1..300, exits a minute apart; the stored verdict ends at id 150.
  const rows = keptSample(300).map((r, i) => ({
    ...r,
    outcomes: { hold: closedOutcome({ r: 1, exitAt: etEpoch("2026-10-01", "15:40") + i }), sameDay: closedOutcome() },
  }));
  const stored: AiVerdict = {
    ruleVersion: "sweep-v1", n: 150, meanR: 1, controlMedian: -0.1, controlP95: -0.05, runs: 200, pass: true,
    computedAt: "2026-10-20T00:00:00.000Z", firstId: 1, lastId: 150, modelMix: {},
  };
  const { deps: d, rec } = deps({ nowMs: V_NOW, rows, verdict: stored });
  const snap = await runScorecardNightly(d);
  assert.equal(rec.fetches.length, 0);
  assert.equal(snap.stats.kept.hold.n, 150);
  assert.equal(snap.stats.afterVerdict.hold.n, 150);
  assert.equal(snap.counts.afterVerdict.total, 150);
  assert.equal(snap.cumulativeR.kept.at(-1)!.n, 150);
  assert.equal(snap.cumulativeR.afterVerdict.at(-1)!.n, 150);
  assert.deepEqual(snap.keptControl, { median: -0.1, p95: -0.05, runs: 200 });
  assert.match(rec.sent[0], /ซื้อสุ่ม p95: -0\.05R → ชนะ/);
});

// --- Final-review fixes (F6-F8) ----------------------------------------------

const storedOpen = (over: Partial<Outcome> = {}): Outcome => ({
  status: "open", fillAt: etEpoch(V_DAY, "15:20"), fill: 100, exitAt: null, exitPrice: null, exitReason: null, r: null, sessionsHeld: 1, ...over,
});

test("F6: a filled open row whose ticker returns no bars becomes no_data once the SPY window elapses, and stops pinning the fetch", async () => {
  const r = row({ id: 8, ticker: "GONE", createdAt: new Date(etEpoch(V_DAY, "15:20") * 1000), outcomes: { hold: storedOpen(), sameDay: storedOpen() } });
  const bars = (t: string) => (t === "SPY" ? verdictBars() : undefined);

  // Window not yet elapsed (10-14 12:00 ET): left as stored.
  const before = deps({ nowMs: etEpoch("2026-10-14", "12:00") * 1000, rows: [r], bars });
  await runScorecardNightly(before.deps);
  assert.equal(before.rec.saved.length, 0);

  // Elapsed: both variants no_data, fill fields kept.
  const after = deps({ nowMs: V_NOW, rows: [r], bars });
  const snap = await runScorecardNightly(after.deps);
  assert.deepEqual(after.rec.saved.map((s) => `${s.variant}:${s.outcome.status}`).sort(), ["hold:no_data", "sameDay:no_data"]);
  for (const s of after.rec.saved) {
    assert.equal(s.outcome.fill, 100);
    assert.equal(s.outcome.fillAt, etEpoch(V_DAY, "15:20"));
    assert.equal(s.outcome.sessionsHeld, 1);
    assert.equal(s.outcome.r, null);
  }
  assert.equal(snap.counts.kept.noData, 1);
  assert.equal(snap.keptProgress.n, 0); // out of the verdict sample

  // The next night it is terminal: nothing to score, no fetch.
  const stored = Object.fromEntries(after.rec.saved.map((s) => [s.variant, s.outcome]));
  const next = deps({ nowMs: V_NOW + 86_400_000, rows: [{ ...r, outcomes: stored }], bars });
  await runScorecardNightly(next.deps);
  assert.equal(next.rec.fetches.length, 0);
  assert.equal(next.rec.saved.length, 0);
});

test("F6: a no_data row leaves the verdict sample and the next kept row moves in", async () => {
  const gone = row({ id: 1, ticker: "GONE", createdAt: new Date(etEpoch(V_DAY, "15:20") * 1000), outcomes: { hold: storedOpen(), sameDay: closedOutcome() } });
  const rest = keptSample(300).map((r) => ({ ...r, id: r.id + 1 })); // ids 2..301
  const { deps: d, rec } = deps({ nowMs: V_NOW, rows: [gone, ...rest], bars: (t) => (t === "GONE" ? undefined : verdictBars()) });
  const snap = await runScorecardNightly(d);
  assert.equal(rec.saved.find((s) => s.chartSetupId === 1)?.outcome.status, "no_data");
  assert.equal(rec.verdicts.length, 1);
  assert.equal(rec.verdicts[0].firstId, 2);
  assert.equal(rec.verdicts[0].lastId, 301);
  assert.equal(snap.verdict?.n, 300);
});

test("F7: with no run-date bar tonight a stored fill is left as stored, never closed on later bars", async () => {
  // Own bars only on later sessions (none on the run date); SPY's window has elapsed.
  const later: Candle[] = V_LATER.slice(0, 3).map((d) => ({ t: etEpoch(d, "15:55"), o: 100, h: 100.2, l: 99.8, c: 101, v: 1000 }));
  const r = row({ id: 8, ticker: "PART", createdAt: new Date(etEpoch(V_DAY, "15:20") * 1000), outcomes: { hold: storedOpen(), sameDay: closedOutcome() } });
  const { deps: d, rec } = deps({ nowMs: V_NOW, rows: [r], bars: (t) => (t === "SPY" ? verdictBars() : later) });
  const snap = await runScorecardNightly(d);
  assert.equal(rec.saved.length, 0);
  assert.equal(snap.recentTrades[0].hold.status, "open");
});

test("F8: one sample ticker missing from the ready-night fetch → no freeze tonight, retried the next night", async () => {
  const rows = keptSample(300);
  const { deps: d, rec } = deps({ nowMs: V_NOW, rows, bars: (t) => (t === "K7" ? undefined : verdictBars()) });
  const snap = await runScorecardNightly(d);
  assert.equal(rec.verdicts.length, 0);
  assert.equal(snap.verdict, null);
  assert.match(snap.verdictPending ?? "", /#8 K7/);
  // The sample's fetch carries SPY, so its windows are checked on bars of the same fetch.
  assert.ok(rec.fetches[1].tickers.includes("SPY"));

  const next = deps({ nowMs: V_NOW + 86_400_000, rows, bars: () => verdictBars() });
  const snap2 = await runScorecardNightly(next.deps);
  assert.equal(next.rec.verdicts.length, 1);
  assert.equal(snap2.verdictPending, null);
});

test("F8: no freeze when a sample row has no eligible control bar", async () => {
  // K3's run-date bars start at 15:30 ET: it has run-date bars, but the control may not enter at or after 15:30.
  const late = (): Candle[] => [...flatBars(V_DAY, 930), ...verdictBars().slice(8)];
  const { deps: d, rec } = deps({ nowMs: V_NOW, rows: keptSample(300), bars: (t) => (t === "K3" ? late() : verdictBars()) });
  const snap = await runScorecardNightly(d);
  assert.equal(rec.verdicts.length, 0);
  assert.match(snap.verdictPending ?? "", /#4 K3/);
});

test("F8: no freeze when the sample fetch's SPY bars do not cover ten sessions", async () => {
  // The first fetch (the calendar) has full SPY; the sample's own fetch is missing SPY's 10th session.
  let spyCalls = 0;
  const bars = (t: string) => (t === "SPY" && ++spyCalls > 1 ? verdictBars().slice(0, -1) : verdictBars());
  const { deps: d, rec } = deps({ nowMs: V_NOW, rows: keptSample(300), bars });
  const snap = await runScorecardNightly(d);
  assert.equal(rec.verdicts.length, 0);
  assert.match(snap.verdictPending ?? "", /SPY/);
});
