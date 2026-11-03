import "dotenv/config"; // nightly.ts -> control.ts reaches prisma via research/control.ts
import test from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import { etClock } from "@/lib/scanAgent/session";
import { runScorecardNightly, windowElapsed, type AiVerdict, type LiveSnapshot, type NightlyDeps, type NightlyRow, type NightlyRun } from "./nightly";
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
  assert.deepEqual(rec.fetches[0].tickers, ["HALF", "NEW"]);
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
  // The sample's bars were fetched for the sample's own tickers only.
  assert.ok(rec.fetches.length >= 1);
  assert.ok(!rec.fetches.some((f) => f.tickers.includes("LATE")));
  assert.equal(snap.verdict?.n, 300);
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
  await runScorecardNightly(d);
  assert.equal(rec.verdicts.length, 0);
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

test("windowElapsed counts ten complete sessions from the fill date on the row's own bars", () => {
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

test("the live control ignores bars it can never read (extended hours, sessions past the tenth)", async () => {
  const open = (id: number): NightlyRow =>
    row({ id, ticker: `L${id}`, createdAt: new Date(etEpoch(V_DAY, "15:20") * 1000), outcomes: { hold: { ...NO_FILL_OPEN(), fill: 100, fillAt: etEpoch(V_DAY, "15:20") } } });
  const rows = [open(1), open(2), open(3)];
  const pre = [480, 485].map((m) => ({ t: etEpoch(V_DAY, hhmm(m)), o: 100, h: 100, l: 100, c: 100, v: 1 }));
  const past = ["2026-10-15", "2026-10-16"].map((d) => ({ t: etEpoch(d, "15:55"), o: 50, h: 50, l: 50, c: 50, v: 1 }));
  const plain = await runScorecardNightly(deps({ nowMs: V_NOW, rows, bars: () => verdictBars() }).deps);
  const noisy = await runScorecardNightly(deps({ nowMs: V_NOW, rows, bars: () => [...pre, ...verdictBars(), ...past] }).deps);
  assert.ok(plain.keptControl);
  assert.equal(plain.keptControl.trades, 3);
  assert.deepEqual(noisy.keptControl, plain.keptControl);
});

function NO_FILL_OPEN(): Outcome {
  return { status: "open", fillAt: null, fill: null, exitAt: null, exitPrice: null, exitReason: null, r: null, sessionsHeld: 1 };
}
