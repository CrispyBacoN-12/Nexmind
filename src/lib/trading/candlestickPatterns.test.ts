import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/indicators";
import {
  priorTrend, isHammer, isShootingStar,
  isBullishEngulfing, isBearishEngulfing, isPiercingLine, isDarkCloudCover,
} from "./candlestickPatterns";

const HOUR = 3600;

function bar(t: number, o: number, h: number, l: number, c: number, v = 1000): Candle {
  return { t, o, h, l, c, v };
}

function downtrendPrefix(n: number, startClose: number, step: number): Candle[] {
  return Array.from({ length: n }, (_, k) => {
    const c = startClose - k * step;
    return bar(k * HOUR, c + step * 0.3, c + 1, c - 1, c);
  });
}

function uptrendPrefix(n: number, startClose: number, step: number): Candle[] {
  return Array.from({ length: n }, (_, k) => {
    const c = startClose + k * step;
    return bar(k * HOUR, c - step * 0.3, c + 1, c - 1, c);
  });
}

const DOWN = downtrendPrefix(15, 200, 3); // closes 200 -> 158; priorTrend at index 14 = "down"
const UP = uptrendPrefix(15, 100, 3);     // closes 100 -> 142; priorTrend at index 14 = "up"

test("priorTrend: insufficient history returns flat", () => {
  const bars = downtrendPrefix(5, 100, 3);
  assert.equal(priorTrend(bars, 4, 10), "flat");
});

test("priorTrend: rising closes over the window return up", () => {
  assert.equal(priorTrend(UP, 14, 10), "up");
});

test("priorTrend: falling closes over the window return down", () => {
  assert.equal(priorTrend(DOWN, 14, 10), "down");
});

test("Hammer: small body + long lower wick after a downtrend fires", () => {
  const bars = [...DOWN, bar(15 * HOUR, 100, 101.2, 95, 101)];
  assert.equal(isHammer(bars, 15), true);
});

test("Hammer: same shape after an uptrend does not fire (trend filter)", () => {
  const bars = [...UP, bar(15 * HOUR, 100, 101.2, 95, 101)];
  assert.equal(isHammer(bars, 15), false);
});

test("Shooting Star: small body + long upper wick after an uptrend fires", () => {
  const bars = [...UP, bar(15 * HOUR, 100, 105, 98.8, 99)];
  assert.equal(isShootingStar(bars, 15), true);
});

test("Shooting Star: same shape after a downtrend does not fire (trend filter)", () => {
  const bars = [...DOWN, bar(15 * HOUR, 100, 105, 98.8, 99)];
  assert.equal(isShootingStar(bars, 15), false);
});

test("Bullish Engulfing: a bullish body engulfing the prior bearish body after a downtrend fires", () => {
  const bars = [...DOWN, bar(15 * HOUR, 110, 111, 104, 105), bar(16 * HOUR, 104, 113, 103, 112)];
  assert.equal(isBullishEngulfing(bars, 16), true);
});

test("Bullish Engulfing: same shape after an uptrend does not fire (trend filter)", () => {
  const bars = [...UP, bar(15 * HOUR, 110, 111, 104, 105), bar(16 * HOUR, 104, 113, 103, 112)];
  assert.equal(isBullishEngulfing(bars, 16), false);
});

test("Bearish Engulfing: a bearish body engulfing the prior bullish body after an uptrend fires", () => {
  const bars = [...UP, bar(15 * HOUR, 100, 106, 99, 105), bar(16 * HOUR, 106, 107, 91, 92)];
  assert.equal(isBearishEngulfing(bars, 16), true);
});

test("Bearish Engulfing: same shape after a downtrend does not fire (trend filter)", () => {
  const bars = [...DOWN, bar(15 * HOUR, 100, 106, 99, 105), bar(16 * HOUR, 106, 107, 91, 92)];
  assert.equal(isBearishEngulfing(bars, 16), false);
});

test("Piercing Line: gap-down close back above the prior body's midpoint after a downtrend fires", () => {
  const bars = [...DOWN, bar(15 * HOUR, 120, 121, 109, 110), bar(16 * HOUR, 108, 118, 107, 117)];
  assert.equal(isPiercingLine(bars, 16), true);
});

test("Piercing Line: same shape after an uptrend does not fire (trend filter)", () => {
  const bars = [...UP, bar(15 * HOUR, 120, 121, 109, 110), bar(16 * HOUR, 108, 118, 107, 117)];
  assert.equal(isPiercingLine(bars, 16), false);
});

test("Dark Cloud Cover: gap-up close back below the prior body's midpoint after an uptrend fires", () => {
  const bars = [...UP, bar(15 * HOUR, 100, 111, 99, 110), bar(16 * HOUR, 112, 113, 102, 103)];
  assert.equal(isDarkCloudCover(bars, 16), true);
});

test("Dark Cloud Cover: same shape after a downtrend does not fire (trend filter)", () => {
  const bars = [...DOWN, bar(15 * HOUR, 100, 111, 99, 110), bar(16 * HOUR, 112, 113, 102, 103)];
  assert.equal(isDarkCloudCover(bars, 16), false);
});
