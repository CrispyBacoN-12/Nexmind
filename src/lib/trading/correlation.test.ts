import { test } from "node:test";
import assert from "node:assert/strict";
import { dailyReturns, pearsonCorrelation } from "./correlation";
import type { Candle } from "@/lib/indicators";

function candle(c: number): Candle {
  return { t: 0, o: c, h: c, l: c, c, v: 0 };
}

test("dailyReturns: known candle series -> known % returns", () => {
  const candles = [candle(100), candle(110), candle(121)];
  assert.deepEqual(dailyReturns(candles), [0.1, 0.1]);
});

test("dailyReturns: fewer than 2 candles -> empty array", () => {
  assert.deepEqual(dailyReturns([]), []);
  assert.deepEqual(dailyReturns([candle(100)]), []);
});

test("pearsonCorrelation: identical series -> 1", () => {
  const xs = [1, 2, 3, 4, 5, 6];
  assert.equal(pearsonCorrelation(xs, xs), 1);
});

test("pearsonCorrelation: inverted series -> -1", () => {
  const xs = [1, 2, 3, 4, 5, 6];
  const ys = [6, 5, 4, 3, 2, 1];
  assert.equal(pearsonCorrelation(xs, ys), -1);
});

test("pearsonCorrelation: short series (<5 points) -> null", () => {
  assert.equal(pearsonCorrelation([1, 2, 3], [1, 2, 3]), null);
});

test("pearsonCorrelation: trims to common trailing length", () => {
  const xs = [99, 1, 2, 3, 4, 5]; // 6 points, last 5 = [1,2,3,4,5]
  const ys = [1, 2, 3, 4, 5]; // 5 points
  assert.equal(pearsonCorrelation(xs, ys), 1);
});

test("pearsonCorrelation: constant series -> null (zero variance)", () => {
  assert.equal(pearsonCorrelation([1, 1, 1, 1, 1], [1, 2, 3, 4, 5]), null);
});
