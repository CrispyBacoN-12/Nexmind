// Support/resistance zone math on synthetic daily candles (made-up data only).

import { test } from "node:test";
import assert from "node:assert/strict";

import type { Candle } from "@/lib/indicators";

import { buildZones, completedBars, computeLevels, findPivots, hvnNodes, type Pivot } from "./levels";

const T0 = 1_700_000_000;
const bar = (i: number, c: number, v = 1000, spread = 0.5): Candle => ({ t: T0 + i * 86400, o: c, h: c + spread, l: c - spread, c, v });

test("findPivots: strict local extremes, last 5 bars excluded", () => {
  // V shape: closes 110 → 100 (index 10) → 110
  const v = Array.from({ length: 21 }, (_, i) => bar(i, 100 + Math.abs(i - 10)));
  const lows = findPivots(v).filter((p) => p.kind === "low");
  assert.deepEqual(lows.map((p) => p.index), [10]);
  // equal neighbour → not strict
  const flat = v.map((b) => ({ ...b }));
  flat[11] = { ...flat[11], l: flat[10].l };
  assert.equal(findPivots(flat).filter((p) => p.kind === "low").length, 0);
  // a new low in the last 5 bars is not a pivot
  const tail = Array.from({ length: 21 }, (_, i) => bar(i, 120 - i));
  assert.equal(findPivots(tail).filter((p) => p.kind === "low").length, 0);
});

test("hvnNodes: concentrates volume", () => {
  const bars = Array.from({ length: 126 }, (_, i) => bar(i, 90 + (i % 21), i % 21 === 10 ? 50_000 : 100));
  const nodes = hvnNodes(bars);
  assert.ok(nodes.length >= 1);
  const top = nodes.reduce((a, b) => (b.share > a.share ? b : a));
  assert.ok(top.low <= 100 && top.high >= 100, JSON.stringify(top));
  assert.ok(top.share > 0.1);
});

test("hvnNodes: zero volume → []", () => {
  const bars = Array.from({ length: 126 }, (_, i) => bar(i, 100 + (i % 7), 0));
  assert.deepEqual(hvnNodes(bars), []);
});

const piv = (price: number, index: number, kind: Pivot["kind"] = "low"): Pivot => ({ kind, price, t: T0 + index * 86400, index });

test("buildZones: joins within 0.5 ATR, caps span at 1 ATR", () => {
  // running means: 100 → 100.15 (100.6 is 0.45 away: joins) → 100.3 (101.3 is 1.0 away: new zone)
  const z = buildZones([piv(100, 10), piv(100.3, 20), piv(100.6, 30), piv(101.3, 40)], [], 1, 100);
  assert.equal(z.length, 2);
  assert.equal(z[0].touches, 3);
  assert.ok(Math.abs(z[0].low - 100) < 1e-9 && Math.abs(z[0].high - 100.6) < 1e-9);
  // span cap: 100, 100.5, 101.0, 101.2 — 101.2 is within 0.5 of the mean 100.5 but would make the span 1.2
  const capped = buildZones([piv(100, 1), piv(100.5, 2), piv(101.0, 3), piv(101.2, 4)], [], 1, 100);
  assert.ok(capped.every((x) => x.high - x.low <= 1 + 1e-9));
  assert.equal(z[1].touches, 1);
});

test("buildZones: HVN wider than 1 ATR contributes centre ± 0.5 ATR", () => {
  const z = buildZones([], [{ low: 90, high: 94, center: 92, share: 0.2 }], 1, 100);
  assert.equal(z.length, 1);
  assert.ok(Math.abs(z[0].low - 91.5) < 1e-9 && Math.abs(z[0].high - 92.5) < 1e-9);
  assert.equal(z[0].volumeShare, 0.2);
  assert.equal(z[0].touches, 0);
});

test("completedBars: drops a bar dated today before 16:00 ET", () => {
  const day = Date.parse("2026-11-24T00:00:00Z") / 1000;
  const bars = [{ t: day - 86400, o: 1, h: 1, l: 1, c: 1, v: 1 }, { t: day + 14.5 * 3600, o: 2, h: 2, l: 2, c: 2, v: 1 }];
  const open = completedBars(bars, Date.parse("2026-11-24T18:00:00Z") / 1000);
  assert.equal(open.bars.length, 1);
  assert.equal(open.forming?.c, 2);
  const closed = completedBars(bars, Date.parse("2026-11-24T22:00:00Z") / 1000);
  assert.equal(closed.bars.length, 2);
  assert.equal(closed.forming, null);
});

/** Oscillates between troughs and peaks so pivots form at the given prices, ends at `last`. */
function wave(levels: number[], last: number, cycles = 4): Candle[] {
  const out: Candle[] = [];
  let i = 0;
  for (let k = 0; k < cycles; k++) {
    for (const lv of levels) {
      for (let s = 0; s < 6; s++) out.push(bar(i++, lv + (s === 0 ? 0 : (s < 3 ? s : 6 - s) * (lv < last ? 1 : -1))));
    }
  }
  for (let s = 0; s < 8; s++) out.push(bar(i++, last));
  return out;
}

test("computeLevels: support below, resistance above, nearest first, ≤ 3", () => {
  const candles = wave([90, 105, 95, 110], 100);
  const r = computeLevels(candles, candles.at(-1)!.t + 86400);
  assert.ok(!("note" in r && r.note === "noData"));
  if ("note" in r && r.note === "noData") return;
  assert.ok(r.support.length >= 1 && r.support.length <= 3);
  assert.ok(r.resistance.length >= 1 && r.resistance.length <= 3);
  assert.ok(r.support.every((z) => z.high < r.price));
  assert.ok(r.resistance.every((z) => z.low > r.price));
  // nearest first
  for (let k = 1; k < r.support.length; k++) assert.ok(r.support[k].mid < r.support[k - 1].mid);
  for (let k = 1; k < r.resistance.length; k++) assert.ok(r.resistance[k].mid > r.resistance[k - 1].mid);
  assert.ok(Math.abs(r.support[0].mid - 95) < 3, JSON.stringify(r.support[0]));
  assert.ok(Math.abs(r.resistance[0].mid - 105) < 3, JSON.stringify(r.resistance[0]));
});

test("computeLevels: no zone above → none message", () => {
  const candles = Array.from({ length: 200 }, (_, i) => bar(i, 50 + i * 0.5));
  const r = computeLevels(candles, candles.at(-1)!.t + 86400);
  if ("note" in r && r.note === "noData") throw new Error("noData");
  assert.deepEqual(r.resistance, []);
  assert.equal(r.price, candles.at(-1)!.c);
});

test("computeLevels: short history", () => {
  const candles = Array.from({ length: 30 }, (_, i) => bar(i, 100 + (i % 5)));
  const r = computeLevels(candles, candles.at(-1)!.t + 86400);
  if ("note" in r && r.note === "noData") throw new Error("noData");
  assert.equal(r.note, "shortHistory");
  assert.deepEqual(r.support, []);
  assert.equal(r.ma50, null);
});

test("computeLevels: stale flag", () => {
  // two pivot lows at 100 (index 10 and 30) so the zone qualifies, then 400 bars rising away
  const head = Array.from({ length: 41 }, (_, i) => bar(i, 100 + Math.abs((i % 20) - 10)));
  const rise = Array.from({ length: 400 }, (_, k) => bar(41 + k, 111 + k * 0.2));
  const candles = [...head, ...rise];
  const r = computeLevels(candles, candles.at(-1)!.t + 86400);
  if ("note" in r && r.note === "noData") throw new Error("noData");
  const z = r.allZones.find((x) => x.low <= 100 && x.high >= 99);
  assert.ok(z, "the old pivot's zone is listed");
  assert.equal(z!.stale, true);
});

test("computeLevels: empty → noData", () => {
  assert.deepEqual(computeLevels([], T0), { note: "noData" });
});
