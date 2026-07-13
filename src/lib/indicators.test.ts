import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anchoredVWAP, dailyAnchor, detectLiquiditySweep, volumeProfile, estimatedDelta, cumulativeDelta,
  type Candle,
} from "./indicators";

const HOUR = 3600;
const DAY = 86_400;

function bar(t: number, o: number, h: number, l: number, c: number, v = 1000): Candle {
  return { t, o, h, l, c, v };
}

test("dailyAnchor: true at i=0 and at each new UTC day, false within a day", () => {
  const bars = [bar(0, 1, 1, 1, 1), bar(HOUR, 1, 1, 1, 1), bar(DAY, 1, 1, 1, 1), bar(DAY + HOUR, 1, 1, 1, 1)];
  assert.equal(dailyAnchor(0, bars), true);
  assert.equal(dailyAnchor(1, bars), false);
  assert.equal(dailyAnchor(2, bars), true);
  assert.equal(dailyAnchor(3, bars), false);
});

test("anchoredVWAP: resets cumulative sums at each anchor bar", () => {
  // Day 1: flat at 100. Day 2: flat at 200. VWAP must reset to ~200 on day 2's
  // first bar, not stay dragged down by day 1's cumulative average.
  const bars = [
    bar(0, 100, 100, 100, 100, 10), bar(HOUR, 100, 100, 100, 100, 10),
    bar(DAY, 200, 200, 200, 200, 10), bar(DAY + HOUR, 200, 200, 200, 200, 10),
  ];
  const vwap = anchoredVWAP(bars, dailyAnchor);
  assert.ok(Math.abs((vwap[1] as number) - 100) < 1e-9, "day 1 VWAP stays at 100");
  assert.ok(Math.abs((vwap[2] as number) - 200) < 1e-9, "day 2 resets to 200, not dragged by day 1");
  assert.ok(Math.abs((vwap[3] as number) - 200) < 1e-9);
});

test("detectLiquiditySweep: wick below prior swing low that closes back above → long", () => {
  const range = Array.from({ length: 20 }, (_, i) => bar(i * HOUR, 100, 101, 99, 100));
  // Sweep bar: wicks to 97 (below the 99 prior low) but closes back at 99.5.
  const sweep = bar(20 * HOUR, 100, 100.5, 97, 99.5);
  const bars = [...range, sweep];
  const result = detectLiquiditySweep(bars, 20, 20);
  assert.equal(result?.side, "long");
  assert.ok(Math.abs((result?.sweptLevel ?? 0) - 99) < 1e-9);
});

test("detectLiquiditySweep: wick above prior swing high that closes back below → short", () => {
  const range = Array.from({ length: 20 }, (_, i) => bar(i * HOUR, 100, 101, 99, 100));
  const sweep = bar(20 * HOUR, 100, 103, 99.5, 100.5); // wicks above 101, closes back below
  const bars = [...range, sweep];
  const result = detectLiquiditySweep(bars, 20, 20);
  assert.equal(result?.side, "short");
});

test("detectLiquiditySweep: no wick beyond the prior range → null", () => {
  const range = Array.from({ length: 20 }, (_, i) => bar(i * HOUR, 100, 101, 99, 100));
  const hold = bar(20 * HOUR, 100, 100.5, 99.5, 100);
  const bars = [...range, hold];
  assert.equal(detectLiquiditySweep(bars, 20, 20), null);
});

test("detectLiquiditySweep: insufficient lookback → null", () => {
  const bars = [bar(0, 100, 101, 99, 100)];
  assert.equal(detectLiquiditySweep(bars, 0, 20), null);
});

test("volumeProfile: point of control lands near the price with concentrated volume", () => {
  const bars: Candle[] = [];
  for (let i = 0; i < 40; i++) bars.push(bar(i * HOUR, 100, 101, 99, 100, 100)); // background noise
  for (let i = 40; i < 50; i++) bars.push(bar(i * HOUR, 120, 120.5, 119.5, 120, 5000)); // heavy volume at ~120
  const levels = volumeProfile(bars, bars.length - 1, 50, 24, 0.7);
  assert.ok(levels != null);
  assert.ok(Math.abs(levels!.poc - 120) < 2, `expected POC near 120, got ${levels!.poc}`);
  assert.ok(levels!.vah >= levels!.poc && levels!.val <= levels!.poc);
});

test("volumeProfile: insufficient lookback → null", () => {
  const bars = [bar(0, 100, 101, 99, 100)];
  assert.equal(volumeProfile(bars, 0, 50), null);
});

test("estimatedDelta: close at the high is fully buy-dominant, close at the low is fully sell-dominant", () => {
  const buyBar = bar(0, 100, 102, 100, 102, 500); // closed at the high
  const sellBar = bar(0, 100, 102, 100, 100, 500); // closed at the low
  const midBar = bar(0, 100, 102, 100, 101, 500); // closed at the midpoint
  const [d1] = estimatedDelta([buyBar]);
  const [d2] = estimatedDelta([sellBar]);
  const [d3] = estimatedDelta([midBar]);
  assert.ok(Math.abs(d1 - 500) < 1e-9);
  assert.ok(Math.abs(d2 - -500) < 1e-9);
  assert.ok(Math.abs(d3) < 1e-9);
});

test("cumulativeDelta: running sum of estimatedDelta", () => {
  const bars = [bar(0, 100, 102, 100, 102, 500), bar(HOUR, 100, 102, 100, 100, 300)];
  const cum = cumulativeDelta(bars);
  assert.ok(Math.abs(cum[0] - 500) < 1e-9);
  assert.ok(Math.abs(cum[1] - (500 - 300)) < 1e-9);
});
