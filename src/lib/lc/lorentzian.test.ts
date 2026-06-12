import { test } from "node:test";
import assert from "node:assert/strict";
import { lorentzianSeries, lorentzianLast } from "./lorentzian";
import type { Candle } from "@/lib/indicators";

const HOUR_S = 3600;
const t0 = 1_700_000_000;

function bar(i: number, c: number, h = c + 0.3, l = c - 0.3): Candle {
  return { t: t0 + i * HOUR_S, o: c, h, l, c, v: 1000 };
}

function series(closes: number[]): Candle[] {
  return closes.map((c, i) => bar(i, c));
}

/** A wavy series with enough variety for features/labels to differentiate. */
function wavy(n: number): Candle[] {
  return series(Array.from({ length: n }, (_, i) => 100 + 10 * Math.sin(i / 9) + 3 * Math.sin(i / 3) + i * 0.02));
}

test("series shapes line up and values are finite", () => {
  const candles = wavy(300);
  const s = lorentzianSeries(candles);
  assert.equal(s.prediction.length, 300);
  assert.equal(s.signal.length, 300);
  assert.equal(s.kernelBullish.length, 300);
  for (const v of s.prediction) assert.ok(Number.isFinite(v));
});

test("prediction stays within ±neighborsCount", () => {
  const s = lorentzianSeries(wavy(400));
  for (const v of s.prediction) assert.ok(Math.abs(v) <= 8, `prediction ${v}`);
});

test("signal only takes values -1/0/1 and persists through filtered bars", () => {
  const s = lorentzianSeries(wavy(400));
  for (let i = 1; i < 400; i++) {
    assert.ok([1, -1, 0].includes(s.signal[i]));
    if (!s.filterAll[i]) assert.equal(s.signal[i], s.signal[i - 1]); // holds previous when filtered
  }
});

test("faithful label quirk: a steady rise yields a SHORT-leaning prediction", () => {
  // Original maps a 4-bar rise to the 'short' label, so a monotonic uptrend's
  // training set is all -1 → any neighbor sum must be ≤ 0.
  const up = series(Array.from({ length: 250 }, (_, i) => 100 + i));
  const s = lorentzianSeries(up);
  const tail = s.prediction.slice(-20);
  for (const v of tail) assert.ok(v <= 0, `expected non-positive, got ${v}`);
});

test("kernel direction tracks the trend", () => {
  const up = series(Array.from({ length: 120 }, (_, i) => 100 + i * 0.8));
  const dn = series(Array.from({ length: 120 }, (_, i) => 200 - i * 0.8));
  const su = lorentzianSeries(up);
  const sd = lorentzianSeries(dn);
  assert.equal(su.kernelBullish[119], true);
  assert.equal(su.kernelBearish[119], false);
  assert.equal(sd.kernelBearish[119], true);
  assert.equal(sd.kernelBullish[119], false);
});

test("deterministic: same input gives identical output", () => {
  const candles = wavy(300);
  const a = lorentzianSeries(candles);
  const b = lorentzianSeries(candles);
  assert.deepEqual(a.prediction, b.prediction);
  assert.deepEqual(a.signal, b.signal);
});

test("lorentzianLast needs ≥80 bars, then mirrors the final bar of the series", () => {
  assert.equal(lorentzianLast(wavy(50)), null);
  const candles = wavy(300);
  const last = lorentzianLast(candles)!;
  const s = lorentzianSeries(candles);
  assert.equal(last.prediction, s.prediction[299]);
  assert.equal(last.signal, s.signal[299]);
  assert.equal(last.kernelBullish, s.kernelBullish[299]);
});
