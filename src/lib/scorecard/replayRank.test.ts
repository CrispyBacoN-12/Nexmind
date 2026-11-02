// Tests for the replay's historical scan row and top-N pick (spec §7): the row is
// rebuilt from bars alone, as the live scan's TradingView row would read at
// 10:30 ET minus the SIP delay.

import test from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import { SIP_DELAY_MS } from "@/lib/alpaca";
import { etClock } from "@/lib/scanAgent/session";
import { passesBase } from "@/lib/scanAgent/filter";
import type { TvRow } from "@/lib/scanAgent/types";
import { pickTopN, replayRow } from "./replayRank";

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

/** `count` weekdays ending at `end` (inclusive), ascending. */
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

/** Regular 5-minute bars 09:30-15:55 ET at a flat price, volume `v` each. */
function regularDay(date: string, price: number, v: number): Candle[] {
  const out: Candle[] = [];
  for (let m = 570; m < 960; m += 5) {
    out.push({ t: etEpoch(date, hhmm(m)), o: price, h: price + 0.2, l: price - 0.2, c: price, v });
  }
  return out;
}

const TODAY = "2026-10-28";
const RUN_AT = etEpoch(TODAY, "10:30");
const CUTOFF = RUN_AT - SIP_DELAY_MS / 1000; // 10:14 ET

// 10 prior sessions with 1,000 shares per bar; today opens +3% with 2,500 per bar.
// After the cutoff today trades enormous volume that must not be read.
function intradayFixture(priorSessions = 10): Candle[] {
  const days = weekdays(TODAY, priorSessions + 1);
  const bars: Candle[] = [];
  for (const d of days.slice(0, -1)) bars.push(...regularDay(d, 100, 1000));
  for (const b of regularDay(TODAY, 103, 2500)) {
    const late = b.t + 300 > CUTOFF;
    bars.push(late ? { ...b, v: 9_000_000, c: 200 } : b);
  }
  return bars;
}

// 30 finished daily bars (range 4 around 100, 2M shares) before today, plus
// today's own bar, which must be ignored for the previous close and the averages.
function dailyFixture(): Candle[] {
  const out: Candle[] = [];
  for (const d of weekdays(TODAY, 31).slice(0, -1)) {
    out.push({ t: etEpoch(d, "00:00"), o: 100, h: 102, l: 98, c: 100, v: 2_000_000 });
  }
  out.push({ t: etEpoch(TODAY, "00:00"), o: 103, h: 150, l: 50, c: 120, v: 99_000_000 });
  return out;
}

test("gap and rvol from bars", () => {
  const row = replayRow("AAA", dailyFixture(), dailyFixture(), intradayFixture(), TODAY, CUTOFF);
  assert.ok(row, "expected a row");
  assert.equal(row.ticker, "AAA");
  assert.equal(row.type, "stock");
  assert.ok(Math.abs((row.gapPct ?? NaN) - 3) < 1e-9, `gapPct ${row.gapPct}`);
  assert.ok(Math.abs((row.rvolIntraday ?? NaN) - 2.5) < 1e-9, `rvol ${row.rvolIntraday}`);
  assert.equal(row.close, 103); // last finished regular bar, not the late 200
  assert.equal(row.avgVolume10d, 2_000_000);
  assert.ok(Math.abs((row.atr ?? NaN) - 4) < 1e-9, `atr ${row.atr}`);
  assert.ok(((row.atr as number) / row.close) * 100 >= 1.5);
  assert.equal(passesBase(row), true);
  assert.equal(row.changePct, null);
  assert.equal(row.premarketVolume, null);
  assert.equal(row.rvol10d, null);
  assert.equal(row.earningsLastAt, null);
});

// A 10:1 split AFTER the replay session (between TODAY and the end of the data).
// The adjusted series divides old prices by 10 and multiplies old volume by 10, so
// it shows ~100 and 3M shares a day; as traded, TODAY's stock was ~1,000 with only
// 300k shares a day, under the scan's 1M floor. The replay must rank on the raw
// basis, or it admits names on volume they only had after a split that had not
// happened yet.
const SPLIT_DAY = weekdays("2026-11-03", 1)[0]; // after TODAY
function splitDaily(raw: boolean): Candle[] {
  const out: Candle[] = [];
  for (const d of weekdays(TODAY, 31).slice(0, -1)) {
    const k = raw ? 10 : 1;
    out.push({ t: etEpoch(d, "00:00"), o: 100 * k, h: 102 * k, l: 98 * k, c: 100 * k, v: 3_000_000 / k });
  }
  for (const d of [TODAY, "2026-10-29", "2026-10-30", "2026-11-02", SPLIT_DAY]) {
    const k = raw && d < SPLIT_DAY ? 10 : 1;
    out.push({ t: etEpoch(d, "00:00"), o: 100 * k, h: 102 * k, l: 98 * k, c: 100 * k, v: 3_000_000 / k });
  }
  return out;
}

test("ranking reads as-traded volume and price: a later split leaks nothing", () => {
  const row = replayRow("SPLT", splitDaily(false), splitDaily(true), intradayFixture(), TODAY, CUTOFF);
  assert.ok(row, "expected a row");
  assert.equal(row.avgVolume10d, 300_000); // raw, not the adjusted 3M
  assert.equal(passesBase(row), false);
  assert.ok(Math.abs(row.close - 1030) < 1e-9, `close ${row.close}`); // 103 adjusted x 10
  assert.ok(Math.abs((row.atr ?? NaN) - 40) < 1e-9, `atr ${row.atr}`); // 4 adjusted x 10
  const atrPctRaw = ((row.atr as number) / row.close) * 100;
  assert.ok(Math.abs(atrPctRaw - (4 / 103) * 100) < 1e-9, "ATR % is unchanged by the basis");
  // Ratios do not move with the basis.
  assert.ok(Math.abs((row.gapPct ?? NaN) - 3) < 1e-9);
  assert.ok(Math.abs((row.rvolIntraday ?? NaN) - 2.5) < 1e-9);
});

test("the same split-adjusted bars without the raw series would have passed", () => {
  const row = replayRow("SPLT", splitDaily(false), splitDaily(false), intradayFixture(), TODAY, CUTOFF);
  assert.ok(row);
  assert.equal(passesBase(row), true);
});

test("null when the raw daily bar of the previous session is missing", () => {
  const raw = splitDaily(true).filter((b) => etClock(b.t).date !== weekdays(TODAY, 2)[0]);
  assert.equal(replayRow("SPLT", splitDaily(false), raw, intradayFixture(), TODAY, CUTOFF), null);
});

test("null with under 10 prior sessions", () => {
  assert.equal(replayRow("AAA", dailyFixture(), dailyFixture(), intradayFixture(9), TODAY, CUTOFF), null);
});

test("null when no regular bar finished before the cutoff", () => {
  const early = etEpoch(TODAY, "09:33");
  assert.equal(replayRow("AAA", dailyFixture(), dailyFixture(), intradayFixture(), TODAY, early), null);
});

function row(ticker: string, over: Partial<TvRow>): TvRow {
  return {
    ticker,
    exchange: "",
    type: "stock",
    close: 100,
    changePct: null,
    gapPct: 0,
    premarketChangePct: null,
    premarketVolume: null,
    rvolIntraday: 1,
    rvol10d: null,
    avgVolume10d: 2_000_000,
    atr: 3,
    earningsLastAt: null,
    earningsLastTime: null,
    earningsNextAt: null,
    earningsNextTime: null,
    ...over,
  };
}

test("pickTopN orders by activity and drops no-trigger rows", () => {
  const rows = [
    row("GAP3", { gapPct: 3, rvolIntraday: 2.5 }), // 5.5
    row("QUIET", { gapPct: 0.5, rvolIntraday: 1.2 }), // no trigger
    row("GAP5", { gapPct: -5, rvolIntraday: 1 }), // 6
    row("PENNY", { close: 2, gapPct: 9, rvolIntraday: 5 }), // fails passesBase
    row("VOL", { gapPct: 0, rvolIntraday: 2 }), // 2
  ];
  assert.deepEqual(pickTopN(rows), ["GAP5", "GAP3", "VOL"]);
  assert.deepEqual(pickTopN(rows, 2), ["GAP5", "GAP3"]);
});
