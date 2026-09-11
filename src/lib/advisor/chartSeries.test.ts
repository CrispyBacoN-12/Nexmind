import { test } from "node:test";
import assert from "node:assert/strict";

import type { Candle } from "@/lib/indicators";

import {
  chartSeries,
  withProjection,
  type ChartBar,
  CHART_PROJECTION_BARS,
  CHART_SMA_FAST,
  CHART_SMA_SLOW,
  CHART_VISIBLE_BARS,
} from "./chartSeries";

const DAY = 86_400;

/** `n` daily bars, close = base + i, starting 2024-01-01. */
function bars(n: number, base = 100): Candle[] {
  const start = Math.floor(Date.UTC(2024, 0, 1) / 1000);
  return Array.from({ length: n }, (_, i) => {
    const c = base + i;
    return { t: start + i * DAY, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1_000 + i };
  });
}

test("the window is the LAST n bars, not the first", () => {
  const rows = chartSeries(bars(300), 10);
  assert.equal(rows.length, 10);
  assert.equal(rows[0].c, 100 + 290);
  assert.equal(rows[9].c, 100 + 299);
});

test("SMA is computed over the full history, so the FIRST visible bar already has one", () => {
  // The whole reason the route fetches 2y to show 6mo. A 200-period mean needs
  // 200 bars BEFORE the leftmost bar on screen; computing it on the visible
  // slice alone would leave the left two thirds of the line missing.
  const rows = chartSeries(bars(CHART_SMA_SLOW + 60), 60);

  assert.equal(rows.length, 60);
  assert.notEqual(rows[0].sma200, null, "leftmost visible bar must already carry sma200");
  assert.ok(rows.every((r) => r.sma200 != null));
  assert.ok(rows.every((r) => r.sma50 != null));
});

test("slicing first would have broken it — proof by comparison", () => {
  const full = bars(CHART_SMA_SLOW + 60);
  const wrong = chartSeries(full.slice(-60), 60);
  assert.equal(wrong[0].sma200, null, "200 bars cannot come out of a 60-bar slice");
});

test("sma200 is the mean of the 200 closes ending at that bar", () => {
  const rows = chartSeries(bars(CHART_SMA_SLOW + 1), 1);
  // closes 100..300; the last 200 are 101..300
  const expected = (101 + 300) / 2;
  assert.equal(rows[0].sma200, expected);
});

test("sma50 tracks the fast window independently of the slow one", () => {
  const rows = chartSeries(bars(CHART_SMA_FAST + 1), 1);
  // closes run 100..150; the fast mean covers the last 50 of them, 101..150
  const expected = (101 + (100 + CHART_SMA_FAST)) / 2;
  assert.equal(rows[0].sma50, expected);
  assert.equal(rows[0].sma200, null, "not enough history for the slow mean");
});

test("too little history yields null SMAs rather than throwing", () => {
  const rows = chartSeries(bars(20), 20);
  assert.equal(rows.length, 20);
  assert.ok(rows.every((r) => r.sma50 === null && r.sma200 === null));
});

test("fewer bars than the window returns every bar there is", () => {
  const rows = chartSeries(bars(7), 50);
  assert.equal(rows.length, 7);
});

test("no bars at all yields no rows", () => {
  assert.deepEqual(chartSeries([], 50), []);
});

test("each row carries a YYYY-MM-DD date read from epoch SECONDS", () => {
  const rows = chartSeries(bars(3), 3);
  assert.equal(rows[0].d, "2024-01-01");
  assert.equal(rows[2].d, "2024-01-03");
});

test("open, high, low, close and volume survive untouched", () => {
  const rows = chartSeries(bars(2), 2);
  const last = rows[1];
  assert.equal(last.o, 100.5);
  assert.equal(last.h, 102);
  assert.equal(last.l, 100);
  assert.equal(last.c, 101);
  assert.equal(last.v, 1_001);
});

test("the default window is the documented six months of sessions", () => {
  assert.equal(chartSeries(bars(400)).length, CHART_VISIBLE_BARS);
});

test("projection appends the requested number of forward columns", () => {
  const rows = withProjection(chartSeries(bars(10), 10), 5);
  assert.equal(rows.length, 15);
  assert.equal(rows.filter((r) => r.real).length, 10);
  assert.equal(rows.filter((r) => !r.real).length, 5);
});

test("a projection column carries no bar at all — nulls, never a repeated close", () => {
  const rows = withProjection(chartSeries(bars(10), 10), 3);
  const future = rows[12];
  assert.equal(future.real, false);
  assert.equal(future.o, null);
  assert.equal(future.h, null);
  assert.equal(future.l, null);
  assert.equal(future.c, null);
  assert.equal(future.v, null);
  assert.equal(future.sma50, null);
  assert.equal(future.sma200, null);
});

test("real columns survive the padding untouched", () => {
  const real = chartSeries(bars(10), 10);
  const rows = withProjection(real, 4);
  for (let i = 0; i < real.length; i++) {
    assert.equal(rows[i].d, real[i].d);
    assert.equal(rows[i].c, real[i].c);
    assert.equal(rows[i].real, true);
  }
});

test("projected dates step forward over weekdays and skip the weekend", () => {
  // 2024-01-05 is a Friday.
  const friday = Math.floor(Date.UTC(2024, 0, 5) / 1000);
  const one: ChartBar[] = [
    { t: friday, d: "2024-01-05", o: 1, h: 2, l: 0.5, c: 1.5, v: 10, sma50: null, sma200: null },
  ];
  const rows = withProjection(one, 3);
  assert.deepEqual(
    rows.slice(1).map((r) => r.d),
    ["2024-01-08", "2024-01-09", "2024-01-10"],
  );
});

test("projected columns keep the date order the axis reads", () => {
  const rows = withProjection(chartSeries(bars(30), 30), 6);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].t > rows[i - 1].t, `row ${i} must come after row ${i - 1}`);
  }
});

test("no bars means no projection to hang off — an empty chart stays empty", () => {
  assert.deepEqual(withProjection([], 5), []);
});

test("zero projection columns is the series unchanged", () => {
  const real = chartSeries(bars(10), 10);
  assert.equal(withProjection(real, 0).length, 10);
});

test("the default projection width is the documented constant", () => {
  assert.equal(withProjection(chartSeries(bars(10), 10)).length, 10 + CHART_PROJECTION_BARS);
});
