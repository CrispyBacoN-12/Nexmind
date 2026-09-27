import assert from "node:assert/strict";
import { test } from "node:test";

import type { Candle } from "@/lib/indicators";

import { dateAlignedCorrelation, regimeFromBenchmark } from "./marketInputs";

const DAY = 86_400;
const T0 = Date.parse("2026-01-01T00:00:00Z") / 1000;

/** One bar per day from T0, closes given. */
const series = (closes: number[], skipDays: number[] = []): Candle[] =>
  closes
    .map((c, i) => ({ t: T0 + i * DAY, o: c, h: c, l: c, c, v: 1 }))
    .filter((_, i) => !skipDays.includes(i));

// A deterministic zig-zag with some shape, so correlations are not degenerate.
const walk = (n: number, seed: number) => {
  const out = [100];
  for (let i = 1; i < n; i++) out.push(out[i - 1] * (1 + Math.sin(i * seed) * 0.02));
  return out;
};

test("identical series correlate at 1, a mirrored one at -1", () => {
  const a = series(walk(80, 1.3));
  assert.ok(Math.abs(dateAlignedCorrelation(a, a)! - 1) < 1e-9);
  const mirrored = series(walk(80, 1.3).map((c, i, arr) => (i === 0 ? 100 : 100 * (2 - c / arr[0]))));
  assert.ok(dateAlignedCorrelation(a, mirrored)! < -0.9);
});

test("pairs by date, not by trailing index", () => {
  const closes = walk(80, 0.7);
  const a = series(closes);
  // Same prices, but b is missing its last 3 bars. Index-zipping would pair
  // a's day 79 with b's day 76 and read a much lower number.
  const b = series(closes.slice(0, 77));
  assert.ok(Math.abs(dateAlignedCorrelation(a, b)! - 1) < 1e-9);
});

test("too few shared days reads as unknown", () => {
  assert.equal(dateAlignedCorrelation(series(walk(30, 1)), series(walk(30, 2))), null);
  assert.equal(dateAlignedCorrelation(series(walk(80, 1)), series(Array(80).fill(50))), null);
});

test("regime: short, missing and implausible benchmarks read as null", () => {
  assert.equal(regimeFromBenchmark(null), null);
  assert.equal(regimeFromBenchmark(series(Array(150).fill(100))), null);
  // Last close 3x its own mean: a broken fetch, not a regime.
  assert.equal(regimeFromBenchmark(series([...Array(249).fill(100), 300])), null);
});

test("regime: reports the last close and its SMA200", () => {
  const r = regimeFromBenchmark(series([...Array(200).fill(100), ...Array(50).fill(110)]));
  assert.deepEqual(r, { spyClose: 110, spySma200: (150 * 100 + 50 * 110) / 200 });
});
