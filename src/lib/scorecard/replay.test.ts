import "dotenv/config"; // replay.ts reaches prisma via control.ts -> research/control.ts
import test from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import { etClock } from "@/lib/scanAgent/session";
import { splitSessions } from "@/lib/chartAgent/bars";
import { computeLevels } from "@/lib/chartAgent/levels";
import { findSetup } from "@/lib/chartAgent/setup";
import { runReplay, REPLAY_BIASES, type ReplayDeps } from "./replay";

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

function weekdays(end: string, count: number): string[] {
  const out: string[] = [];
  const d = new Date(`${end}T12:00:00Z`);
  while (out.length < count) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.unshift(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const SESSIONS = weekdays("2026-10-28", 12); // all EDT
const PREV = SESSIONS[10];
const TODAY = SESSIONS[11];

function bar(date: string, m: number, o: number, h: number, l: number, c: number, v: number): Candle {
  return { t: etEpoch(date, hhmm(m)), o, h, l, c, v };
}

/** Quiet regular session around 100, 1,000 shares a bar. */
function quietDay(date: string): Candle[] {
  const out: Candle[] = [];
  for (let m = 570; m < 960; m += 5) out.push(bar(date, m, 100, 100.8, 99.5, 100, 1000));
  return out;
}

/** The previous session of runChartAgent.test.ts: PDL 99, PDH 105. */
function previousDay(date: string): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < 78; i++) {
    const h = i === 20 ? 105 : 100.8;
    const l = i === 10 ? 99 : 99.5;
    out.push(bar(date, 570 + i * 5, 100, h, l, 100, 1000));
  }
  return out;
}

/**
 * Today at 3,000 shares a bar (rvol 3, so the scan picks it). `sweepAt` is the
 * minute of a bar that opens above PDL 99, wicks to 98.5 and closes back above;
 * `spikeAt` is a bar that trades up to 110 (through any first target).
 */
function today(opts: { sweepAt: number | null; spikeAt: number | null }): Candle[] {
  const out: Candle[] = [];
  for (let m = 570; m < 960; m += 5) {
    if (m === opts.sweepAt) out.push(bar(TODAY, m, 100.2, 100.2, 98.5, 99.5, 3000));
    else if (m === opts.spikeAt) out.push(bar(TODAY, m, 100, 110, 99.9, 100, 3000));
    else if (opts.sweepAt !== null && m > opts.sweepAt) out.push(bar(TODAY, m, 100, 100.1, 99.4, 100, 3000));
    else out.push(bar(TODAY, m, 100.2, 100.4, 99.9, 100.2, 3000));
  }
  return out;
}

function intraday(todayBars: Candle[]): Candle[] {
  return [...SESSIONS.slice(0, 10).flatMap(quietDay), ...previousDay(PREV), ...todayBars];
}

/** 30 finished daily bars, range 2 around 100 (ATR 2), 2M shares. */
function daily(): Candle[] {
  return weekdays(TODAY, 30).map((d) => ({ t: etEpoch(d, "00:00"), o: 100, h: 101, l: 99, c: 100, v: 2_000_000 }));
}

function deps(bars: Record<string, Candle[]>, noRawDaily: string[] = []): ReplayDeps {
  return {
    sessions: SESSIONS,
    universe: Object.keys(bars),
    loadIntraday: async (t) => bars[t] ?? [],
    loadDaily: async () => daily(),
    // No corporate action in the fixture: as traded = adjusted.
    loadRawDaily: async (t) => (noRawDaily.includes(t) ? [] : daily()),
  };
}

test("end to end on a stub universe", async () => {
  const s = await runReplay(
    deps({
      SWP: intraday(today({ sweepAt: 575, spikeAt: 660 })), // sweep 09:35, T1 hit 11:00
      FLAT: intraday(today({ sweepAt: null, spikeAt: null })),
    }),
  );
  assert.equal(s.period.from, SESSIONS[0]);
  assert.equal(s.period.to, TODAY);
  assert.equal(s.sessions, 12);
  assert.equal(s.universe, 2);
  assert.equal(s.tickersWithData, 2);
  assert.deepEqual(s.missingTickers, []);
  assert.equal(s.picks, 2); // both picked on TODAY only (rvol 3); nothing triggers earlier
  assert.equal(s.setupsFound, 1);
  assert.equal(s.filled, 1);
  assert.equal(s.notFilled, 0);
  assert.equal(s.open, 0);
  assert.equal(s.stats.hold.n, 1);
  assert.ok((s.stats.hold.meanR as number) > 0);
  assert.equal(s.stats.hold.t1Pct, 1);
  assert.equal(s.stats.sameDay.n, 1);
  assert.equal(typeof s.pass, "boolean");
  assert.deepEqual(s.biases, REPLAY_BIASES);
  assert.deepEqual(s.biases, [
    "รายชื่อหุ้นเป็น S&P 500 ปัจจุบัน — หุ้นที่เคยหลุดออกจากดัชนีไม่อยู่ในผล (survivorship bias)",
    "ไม่มีข้อมูลงบและ 8-K ย้อนหลัง — คะแนนส่วนนั้นนับเป็น 0",
  ]);
  assert.equal(s.cumulativeR.length, 12);
  assert.equal(s.cumulativeR.at(-1)?.date, TODAY);
  assert.equal(s.cumulativeR.at(-1)?.cumR, s.stats.hold.meanR);
  assert.equal(s.cumulativeR.at(-2)?.cumR, 0);
});

test("reads no bar after the cutoff when finding setups", async () => {
  // The sweep bar starts 10:10 ET and ends 10:15, after the 10:14 cutoff.
  const bars = intraday(today({ sweepAt: 610, spikeAt: null }));

  // With every bar of the day the live pipeline does see a setup ...
  const split = splitSessions(bars, TODAY);
  const lv = computeLevels(split);
  assert.ok("levels" in lv);
  assert.equal(findSetup("LATE", split, lv.levels, 2).kind, "setup");

  // ... but the replay, reading only up to 10:30 - SIP delay, must not.
  const s = await runReplay(deps({ LATE: bars }));
  assert.equal(s.picks, 1);
  assert.equal(s.setupsFound, 0);
  assert.equal(s.filled, 0);
  assert.equal(s.stats.hold.n, 0);
  assert.equal(s.pass, false);
});

test("a ticker missing any of its bar series is never ranked and is listed", async () => {
  const s = await runReplay(
    deps(
      {
        SWP: intraday(today({ sweepAt: 575, spikeAt: 660 })),
        NOINTRA: [],
        NORAW: intraday(today({ sweepAt: 575, spikeAt: 660 })),
      },
      ["NORAW"],
    ),
  );
  assert.equal(s.universe, 3);
  assert.equal(s.tickersWithData, 1);
  assert.deepEqual(s.missingTickers, ["NOINTRA", "NORAW"]);
  assert.equal(s.picks, 1);
  assert.equal(s.setupsFound, 1);
});
