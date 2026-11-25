// Chart helpers for /levels on synthetic daily candles (made-up data only).

import { test } from "node:test";
import assert from "node:assert/strict";

import type { Candle } from "@/lib/indicators";

import { bandColor, bandRects, chartSeries, cleanCandles, rangeStart, widenRange, type ChartBar } from "./chart";
import type { Zone } from "./levels";

const T0 = Date.UTC(2024, 0, 2, 14, 30) / 1000; // 09:30 ET
const DAY = 86400;
const bar = (i: number, c: number): Candle => ({ t: T0 + i * DAY, o: c, h: c + 1, l: c - 1, c, v: 1000 });
const bars = (n: number) => Array.from({ length: n }, (_, i) => bar(i, 100 + (i % 7)));

test("chartSeries: completed bars then the forming bar, MAs aligned", () => {
  const input = bars(260);
  const last = input[259].t;
  const done = chartSeries(input, last + 3 * DAY);
  assert.equal(done.length, 260);
  for (let i = 0; i < 49; i++) assert.equal(done[i].ma50, null);
  const mean50 = input.slice(0, 50).reduce((s, b) => s + b.c, 0) / 50;
  assert.ok(Math.abs(done[49].ma50! - mean50) < 1e-9);
  assert.equal(done[198].ma200, null);
  assert.notEqual(done[199].ma200, null);

  const live = chartSeries(input, last + 3600); // same New York date, before 16:00 ET
  assert.equal(live.length, 260);
  assert.equal(live[259].ma50, null);
  assert.notEqual(live[258].ma50, null);
});

test("chartSeries: drops non-finite bars and de-duplicates timestamps", () => {
  const b0 = bar(0, 100);
  const b1 = bar(1, 101);
  const b1b = { ...b1, c: 105 };
  const b2 = { ...bar(2, 102), h: Number.NaN };
  const b3 = bar(3, 103);
  const out = chartSeries([b0, b1, b1b, b2, b3], b3.t + 3 * DAY);
  assert.deepEqual(
    out.map((b) => b.t),
    [b0.t, b1.t, b3.t],
  );
  assert.equal(out[1].c, 105);
});

test("cleanCandles: the one candle list both the zones and the chart read", () => {
  const b0 = bar(0, 100);
  const b1 = bar(1, 101);
  const b1b = { ...b1, c: 105 };
  const b2 = { ...bar(2, 102), o: Number.POSITIVE_INFINITY };
  assert.deepEqual(cleanCandles([b1, b2, b0, b1b]), [b0, b1b]);
  assert.deepEqual(cleanCandles([]), []);
});

test("chartSeries: empty → []", () => {
  assert.deepEqual(chartSeries([], T0), []);
});

test("rangeStart: picks the first bar inside the window and clamps to the series", () => {
  const s: ChartBar[] = chartSeries(bars(600), T0 + 700 * DAY);
  const last = s.at(-1)!.t;
  assert.equal(rangeStart(s, "3M"), s.find((b) => b.t >= last - 63 * DAY * 7 / 5)!.t);
  assert.equal(rangeStart(s, "1Y"), s.find((b) => b.t >= last - 252 * DAY * 7 / 5)!.t);
  const short = chartSeries(bars(100), T0 + 200 * DAY);
  assert.equal(rangeStart(short, "2Y"), short[0].t);
  assert.equal(rangeStart([], "6M"), null);
});

test("rangeStart: 2Y always shows the whole series (holidays make 504 trading days < 2 calendar years)", () => {
  const s = chartSeries(bars(750), T0 + 800 * DAY);
  assert.equal(rangeStart(s, "2Y"), s[0].t);
});

test("widenRange: stretches the price range to include the cost line", () => {
  assert.deepEqual(widenRange({ minValue: 150, maxValue: 200 }, 120), { minValue: 120, maxValue: 200 });
  assert.deepEqual(widenRange({ minValue: 150, maxValue: 200 }, 260), { minValue: 150, maxValue: 260 });
  assert.deepEqual(widenRange({ minValue: 150, maxValue: 200 }, 170), { minValue: 150, maxValue: 200 });
  assert.deepEqual(widenRange({ minValue: 150, maxValue: 200 }, null), { minValue: 150, maxValue: 200 });
  assert.equal(widenRange(null, 120), null);
});

const zone = (low: number, high: number, stale = false): Zone => ({
  low,
  high,
  mid: (low + high) / 2,
  touches: 2,
  lastTouch: null,
  lastTouchIndex: null,
  volumeShare: 0,
  sources: ["pivot"],
  stale,
});

test("bandRects: clips, skips off-pane and null, fades stale", () => {
  const toY = (p: number) => 1000 - p * 5; // 100 → 500
  const [below] = bandRects([zone(90, 95)], 100, toY, 600);
  assert.deepEqual(below, { top: 525, bottom: 550, color: "#10b981", opacity: 0.18 });
  assert.deepEqual(bandRects([zone(210, 220)], 100, toY, 600), []); // y −100..−50
  assert.equal(bandRects([zone(195, 205)], 100, toY, 600)[0].top, 0); // y −25..25
  assert.deepEqual(bandRects([zone(75, 85)], 100, toY, 600)[0], { top: 575, bottom: 600, color: "#10b981", opacity: 0.18 }); // y 575..625
  assert.deepEqual(bandRects([zone(10, 20)], 100, toY, 600), []); // y 900..950
  assert.deepEqual(bandRects([zone(90, 95)], 100, () => null, 600), []);
  assert.equal(bandRects([zone(90, 95, true)], 100, toY, 600)[0].opacity, 0.08);
  assert.equal(bandRects([zone(98, 102)], 100, toY, 600)[0].color, "#f59e0b");
});

test("bandColor: support green, resistance red, inside amber", () => {
  assert.equal(bandColor(zone(90, 95), 100), "#10b981");
  assert.equal(bandColor(zone(105, 110), 100), "#f43f5e");
  assert.equal(bandColor(zone(99, 101), 100), "#f59e0b");
});
