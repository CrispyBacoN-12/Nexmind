import test from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import { etClock } from "@/lib/scanAgent/session";
import { scoreSetup } from "./score";
import {
  SCORECARD_COST_MODEL,
  SCORECARD_MAX_HOLD_SESSIONS,
  SCORECARD_SOURCE,
  type ExitVariant,
} from "./types";

// ET wall clock -> epoch seconds, correct across DST (2026-11-01 is the fall-back
// Sunday, so 2026-11-02 is EST and 2026-10-30 is EDT).
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

function bar(date: string, hhmm: string, o: number, h: number, l: number, c: number): Candle {
  return { t: etEpoch(date, hhmm), o, h, l, c, v: 1000 };
}

const DAY1 = "2026-11-02";
const RUN = etEpoch(DAY1, "10:30");
const STOP = 99;
const T1 = 102;
const AFTER_DAY1 = etEpoch("2026-11-03", "08:00"); // cutoff once day 1 is complete

function score(bars: Candle[], cutoffSec: number, variant: ExitVariant = "hold", runAtSec = RUN) {
  return scoreSetup({ runAtSec, stop: STOP, t1: T1, bars, cutoffSec, variant });
}

const near = (a: number | null, b: number) =>
  assert.ok(a !== null && Math.abs(a - b) < 1e-6, `${a} vs ${b}`);

// A quiet session that never touches 99 or 102: open, mid and last bar.
function quietDay(date: string, lastClose = 100.4, fromFill = false): Candle[] {
  const bars = [
    bar(date, "10:30", 100, 101, 99.5, 100.2),
    bar(date, "12:00", 100.2, 101, 99.6, 100.3),
    bar(date, "15:55", 100.3, 101, 99.7, lastClose),
  ];
  return fromFill ? bars : [bar(date, "09:30", 100, 101, 99.5, 100.1), ...bars];
}

test("the scorecard constants carry the spec values", () => {
  assert.equal(SCORECARD_SOURCE, "scheduled");
  assert.equal(SCORECARD_MAX_HOLD_SESSIONS, 10);
  assert.deepEqual(SCORECARD_COST_MODEL, { slippageBps: 5, commissionBps: 1 });
});

test("T1 hit", () => {
  const bars = [
    bar(DAY1, "10:30", 100, 100.5, 99.5, 100.2),
    bar(DAY1, "10:35", 100.2, 102.2, 100, 102),
  ];
  const o = score(bars, AFTER_DAY1);
  assert.equal(o.status, "closed");
  assert.equal(o.exitReason, "t1");
  assert.equal(o.exitPrice, 102);
  assert.equal(o.fill, 100);
  assert.equal(o.fillAt, RUN);
  assert.equal(o.sessionsHeld, 1);
  near(o.r, 1.799043);
});

test("stop hit", () => {
  const bars = [
    bar(DAY1, "10:30", 100, 100.5, 99.5, 100.2),
    bar(DAY1, "10:35", 100.2, 100.4, 98.9, 99.2),
  ];
  const o = score(bars, AFTER_DAY1);
  assert.equal(o.status, "closed");
  assert.equal(o.exitReason, "stop");
  assert.equal(o.exitPrice, 99);
  near(o.r, -1.056671);
});

test("same bar touches both counts as stop", () => {
  const bars = [
    bar(DAY1, "10:30", 100, 100.5, 99.5, 100.2),
    bar(DAY1, "10:35", 100.2, 102.5, 98.5, 100),
  ];
  const o = score(bars, AFTER_DAY1);
  assert.equal(o.exitReason, "stop");
  assert.equal(o.exitPrice, 99);
});

test("the fill bar's own low and high count", () => {
  const o = score([bar(DAY1, "10:30", 100, 102.2, 99.5, 101)], AFTER_DAY1);
  assert.equal(o.exitReason, "t1");
  assert.equal(o.sessionsHeld, 1);
});

test("gap below the stop exits at the open", () => {
  const bars = [
    ...quietDay(DAY1, 100.4, true),
    bar("2026-11-03", "09:30", 98, 98.5, 97.5, 98.2),
  ];
  const o = score(bars, etEpoch("2026-11-03", "09:40"));
  assert.equal(o.status, "closed");
  assert.equal(o.exitReason, "stop");
  assert.equal(o.exitPrice, 98);
  assert.equal(o.exitAt, etEpoch("2026-11-03", "09:30"));
  assert.equal(o.sessionsHeld, 2);
  near(o.r, -2.008576);
});

test("gap above T1 exits at the open", () => {
  const bars = [
    ...quietDay(DAY1, 100.4, true),
    bar("2026-11-03", "09:30", 103, 103.5, 102.8, 103.2),
  ];
  const o = score(bars, etEpoch("2026-11-03", "09:40"));
  assert.equal(o.exitReason, "t1");
  assert.equal(o.exitPrice, 103);
  assert.equal(o.sessionsHeld, 2);
});

test("not filled when the first open is under the stop", () => {
  const o = score([bar(DAY1, "10:30", 98.9, 100, 98.5, 99.5)], AFTER_DAY1);
  assert.equal(o.status, "not_filled");
  assert.equal(o.fill, null);
  assert.equal(o.r, null);
  assert.equal(o.sessionsHeld, 0);
});

test("not filled when the first open is at or above T1", () => {
  const o = score([bar(DAY1, "10:30", 102, 103, 101.5, 102.5)], AFTER_DAY1);
  assert.equal(o.status, "not_filled");
});

test("not filled when no regular bar starts after the run on a finished day", () => {
  const bars = [bar(DAY1, "15:55", 100, 101, 99.5, 100.4)];
  const o = score(bars, AFTER_DAY1, "hold", etEpoch(DAY1, "15:58"));
  assert.equal(o.status, "not_filled");
  assert.equal(o.sessionsHeld, 0);
});

test("open while the run day has no fill bar yet", () => {
  // The 10:30 bar ends 10:35; at 10:31 it is still forming.
  const o = score([bar(DAY1, "10:30", 100, 101, 99.5, 100.2)], etEpoch(DAY1, "10:31"));
  assert.equal(o.status, "open");
  assert.equal(o.fillAt, null);
  assert.equal(o.fill, null);
  assert.equal(o.r, null);
  assert.equal(o.sessionsHeld, 0);
});

test("the fill bar is inclusive: a bar starting exactly at the run fills", () => {
  const o = score([bar(DAY1, "10:30", 100.7, 101, 99.5, 100.2)], AFTER_DAY1, "sameDay");
  assert.equal(o.fill, 100.7);
  assert.equal(o.fillAt, RUN);
});

const TEN = [
  "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06",
  "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13",
];

function sessions(dates: string[]): Candle[] {
  return dates.flatMap((d, i) => quietDay(d, i === dates.length - 1 ? 100.77 : 100.4, i === 0));
}

test("hold exits on time at the 10th session's close", () => {
  const o = score(sessions(TEN), etEpoch("2026-11-13", "16:30"));
  assert.equal(o.status, "closed");
  assert.equal(o.exitReason, "time");
  assert.equal(o.sessionsHeld, 10);
  assert.equal(o.exitPrice, 100.77);
  assert.equal(o.exitAt, etEpoch("2026-11-13", "16:00"));
});

test("holiday is not a session", () => {
  // 2026-11-11 has no bars: the 10th session is the 11th weekday, 2026-11-16.
  const dates = [...TEN.filter((d) => d !== "2026-11-11"), "2026-11-16"];
  const bars = sessions(dates);
  // Cutoff after the 13th: only 9 sessions complete, so still open.
  const open = score(bars, etEpoch("2026-11-13", "16:30"));
  assert.equal(open.status, "open");
  assert.equal(open.sessionsHeld, 9);
  const done = score(bars, etEpoch("2026-11-16", "16:30"));
  assert.equal(done.status, "closed");
  assert.equal(done.exitReason, "time");
  assert.equal(done.sessionsHeld, 10);
  assert.equal(done.exitPrice, 100.77);
});

test("hold stays open with 9 complete sessions", () => {
  const o = score(sessions(TEN.slice(0, 9)), etEpoch("2026-11-12", "16:30"));
  assert.equal(o.status, "open");
  assert.equal(o.r, null);
  assert.equal(o.exitPrice, null);
  assert.equal(o.exitReason, null);
  assert.equal(o.sessionsHeld, 9);
  assert.equal(o.fill, 100);
});

test("hold stays open while the 10th session is still running", () => {
  const bars = sessions(TEN);
  // Cutoff mid-afternoon on the 10th: the last bar (15:55) is not finished yet.
  const o = score(bars, etEpoch("2026-11-13", "15:00"));
  assert.equal(o.status, "open");
  assert.equal(o.sessionsHeld, 10);
});

test("a hit inside the 10 sessions beats the time exit", () => {
  const bars = [
    ...sessions(TEN.slice(0, 4)),
    bar(TEN[4], "09:30", 100, 100.5, 98.8, 99.2),
  ];
  const o = score(bars, etEpoch(TEN[4], "10:00"));
  assert.equal(o.exitReason, "stop");
  assert.equal(o.sessionsHeld, 5);
});

test("sameDay closes at the entry day's close", () => {
  const o = score(quietDay(DAY1, 100.4, true), AFTER_DAY1, "sameDay");
  assert.equal(o.status, "closed");
  assert.equal(o.exitReason, "time");
  assert.equal(o.sessionsHeld, 1);
  assert.equal(o.exitPrice, 100.4);
  near(o.r, (100.4 * 0.9995 - 100.05 - 0.010005) / 1.05);
});

test("sameDay ignores later days, hold does not", () => {
  const bars = [
    ...quietDay(DAY1, 100.4, true),
    bar("2026-11-03", "09:30", 98, 98.5, 97.5, 98.2),
  ];
  const cutoff = etEpoch("2026-11-03", "09:40");
  assert.equal(score(bars, cutoff, "sameDay").exitReason, "time");
  assert.equal(score(bars, cutoff, "hold").exitReason, "stop");
});

test("sameDay stays open until the entry day is complete", () => {
  const o = score(quietDay(DAY1, 100.4, true), etEpoch(DAY1, "14:00"), "sameDay");
  assert.equal(o.status, "open");
  assert.equal(o.sessionsHeld, 1);
  assert.equal(o.r, null);
});

test("forming bars are ignored", () => {
  const bars = [
    bar(DAY1, "10:30", 100, 100.5, 99.5, 100.2),
    bar(DAY1, "10:35", 100.2, 100.4, 98, 98.5), // ends 10:40, after the cutoff
  ];
  const o = score(bars, etEpoch(DAY1, "10:37"));
  assert.equal(o.status, "open");
  assert.equal(o.exitReason, null);
});

test("extended-hours bars are ignored", () => {
  const bars = [
    ...quietDay(DAY1, 100.4, true),
    bar(DAY1, "17:00", 99.5, 99.6, 97, 97.5),
    bar("2026-11-03", "08:00", 99.5, 99.6, 97, 97.5),
  ];
  const o = score(bars, etEpoch("2026-11-03", "09:00"), "hold");
  assert.equal(o.status, "open");
  assert.equal(o.exitReason, null);
  assert.equal(o.sessionsHeld, 1);
  assert.equal(score(bars, AFTER_DAY1, "sameDay").exitReason, "time");
});

test("bars on earlier days and out-of-order input are tolerated", () => {
  const bars = [
    bar(DAY1, "15:55", 100.3, 101, 99.7, 100.4),
    bar(DAY1, "10:30", 100, 101, 99.5, 100.2),
    bar("2026-10-30", "10:30", 90, 91, 80, 85),
  ];
  const o = score(bars, AFTER_DAY1, "sameDay");
  assert.equal(o.fill, 100);
  assert.equal(o.exitReason, "time");
  assert.equal(o.exitPrice, 100.4);
});

test("custom costs flow through the R formula", () => {
  const o = scoreSetup({
    runAtSec: RUN, stop: STOP, t1: T1, cutoffSec: AFTER_DAY1, variant: "hold",
    bars: [bar(DAY1, "10:30", 100, 102.5, 99.5, 101)],
    costs: { slippageBps: 0, commissionBps: 0 },
  });
  near(o.r, 2);
});
