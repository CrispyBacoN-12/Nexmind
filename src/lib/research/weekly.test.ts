import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import { weekIndex, toWeeklyBars, assertWeeklyMatchesDaily, weeklyPanel, WEEKLY_PANEL_WARMUP_BARS } from "./weekly";
import type { Panel } from "./panel";

const DAY = 86_400;

/** 2016-01-04 was a Monday. Alpaca stamps a daily bar at 05:00 UTC. */
const MON_2016_01_04 = Date.parse("2016-01-04T05:00:00Z") / 1000;
/** Yahoo stamps the same session at 14:30 UTC. Same calendar date, different offset. */
const MON_2016_01_04_YAHOO = Date.parse("2016-01-04T14:30:00Z") / 1000;

const bar = (t: number, o: number, h: number, l: number, c: number, v: number): Candle => ({ t, o, h, l, c, v });

test("weekIndex buckets Monday through Friday of one week together", () => {
  const days = [0, 1, 2, 3, 4].map((k) => weekIndex(MON_2016_01_04 + k * DAY));
  assert.deepEqual(days, [days[0], days[0], days[0], days[0], days[0]]);
});

test("weekIndex starts a new bucket on the following Monday", () => {
  assert.equal(weekIndex(MON_2016_01_04 + 7 * DAY), weekIndex(MON_2016_01_04) + 1);
});

test("weekIndex does not depend on the cache's time-of-day convention", () => {
  assert.equal(weekIndex(MON_2016_01_04_YAHOO), weekIndex(MON_2016_01_04));
  assert.equal(weekIndex(MON_2016_01_04_YAHOO + 4 * DAY), weekIndex(MON_2016_01_04));
});

test("toWeeklyBars composes OHLCV from the week's daily bars", () => {
  const daily: Candle[] = [
    bar(MON_2016_01_04 + 0 * DAY, 100, 104, 99, 101, 10),
    bar(MON_2016_01_04 + 1 * DAY, 101, 108, 100, 107, 20),
    bar(MON_2016_01_04 + 2 * DAY, 107, 107, 95, 96, 30),
    bar(MON_2016_01_04 + 3 * DAY, 96, 103, 96, 102, 40),
    bar(MON_2016_01_04 + 4 * DAY, 102, 105, 101, 103, 50),
  ];
  const weekly = toWeeklyBars(daily);
  assert.equal(weekly.length, 1);
  assert.deepEqual(weekly[0], {
    t: MON_2016_01_04 + 4 * DAY, // the week's LAST session, i.e. when the bar closed
    o: 100, // Monday's open
    h: 108, // the week's max high
    l: 95, // the week's min low
    c: 103, // Friday's close
    v: 150, // the week's summed volume
  });
});

test("toWeeklyBars keeps a short week rather than dropping it", () => {
  // A three-session holiday week is a real week, and refusing it would silently
  // remove bars from the fold rather than from the resampler.
  const daily: Candle[] = [
    bar(MON_2016_01_04 + 0 * DAY, 100, 101, 99, 100, 1),
    bar(MON_2016_01_04 + 1 * DAY, 100, 102, 98, 99, 2),
    bar(MON_2016_01_04 + 2 * DAY, 99, 100, 97, 98, 3),
  ];
  const weekly = toWeeklyBars(daily);
  assert.equal(weekly.length, 1);
  assert.deepEqual(weekly[0], { t: MON_2016_01_04 + 2 * DAY, o: 100, h: 102, l: 97, c: 98, v: 6 });
});

test("toWeeklyBars emits one bar per week across a weekend boundary", () => {
  const daily: Candle[] = [
    bar(MON_2016_01_04 + 4 * DAY, 100, 101, 99, 100, 1), // Friday
    bar(MON_2016_01_04 + 7 * DAY, 100, 106, 100, 105, 2), // the next Monday
  ];
  const weekly = toWeeklyBars(daily);
  assert.equal(weekly.length, 2);
  assert.equal(weekly[0].c, 100);
  assert.equal(weekly[1].o, 100);
  assert.equal(weekly[1].c, 105);
});

test("toWeeklyBars returns nothing for an empty series", () => {
  assert.deepEqual(toWeeklyBars([]), []);
});

/** Five sessions a week for `weeks` weeks, prices walking up by 1 a session. */
function dailySeries(weeks: number, t0 = MON_2016_01_04): Candle[] {
  const out: Candle[] = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 5; d++) {
      const n = w * 5 + d;
      const c = 100 + n;
      out.push(bar(t0 + (w * 7 + d) * DAY, c - 1, c + 2, c - 3, c, 1_000 + n));
    }
  }
  return out;
}

test("assertWeeklyMatchesDaily accepts the resampler's own output", () => {
  const daily = dailySeries(6);
  assert.doesNotThrow(() => assertWeeklyMatchesDaily("TEST", daily, toWeeklyBars(daily)));
});

test("assertWeeklyMatchesDaily rejects a wrong high", () => {
  const daily = dailySeries(3);
  const weekly = toWeeklyBars(daily);
  weekly[1].h += 1;
  assert.throws(() => assertWeeklyMatchesDaily("TEST", daily, weekly), /TEST.*\bh\b/);
});

test("assertWeeklyMatchesDaily rejects a wrong volume sum", () => {
  const daily = dailySeries(3);
  const weekly = toWeeklyBars(daily);
  weekly[0].v -= 1;
  assert.throws(() => assertWeeklyMatchesDaily("TEST", daily, weekly), /TEST.*\bv\b/);
});

test("assertWeeklyMatchesDaily rejects a dropped week", () => {
  const daily = dailySeries(3);
  const weekly = toWeeklyBars(daily).slice(0, 2);
  assert.throws(() => assertWeeklyMatchesDaily("TEST", daily, weekly), /2 weekly bars from 3/);
});

test("weeklyPanel resamples every symbol and tags its cachePath", () => {
  const panel: Panel = {
    fetchedAt: "2026-08-14T00:00:00.000Z",
    cachePath: ".cache/bars/test.json",
    symbols: ["AAA", "BBB"],
    bars: { AAA: dailySeries(4), BBB: dailySeries(4, MON_2016_01_04_YAHOO) },
    droppedBars: { AAA: 3 },
  };
  const weekly = weeklyPanel(panel);
  assert.deepEqual(weekly.symbols, ["AAA", "BBB"]);
  assert.equal(weekly.bars.AAA.length, 4);
  assert.equal(weekly.bars.BBB.length, 4);
  assert.equal(weekly.cachePath, ".cache/bars/test.json#weekly");
  assert.equal(weekly.fetchedAt, panel.fetchedAt);
  assert.deepEqual(weekly.droppedBars, { AAA: 3 });
});

test("weeklyPanel throws rather than returning an empty panel", () => {
  const panel: Panel = {
    fetchedAt: "x", cachePath: ".cache/bars/empty.json", symbols: ["AAA"], bars: { AAA: [] }, droppedBars: {},
  };
  assert.throws(() => weeklyPanel(panel), /produced no weekly series/);
});

test("the weekly warm-up is two years and clears the engine's own 60-bar warm-up", () => {
  assert.equal(WEEKLY_PANEL_WARMUP_BARS, 104);
});
