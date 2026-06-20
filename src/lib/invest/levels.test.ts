import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLevels } from "./levels";
import type { Candle } from "@/lib/indicators";

const bar = (i: number, h: number, l: number): Candle => ({ t: i * 604800, o: (h + l) / 2, h, l, c: (h + l) / 2, v: 1000 });

test("computeLevels: picks nearest pivot below/above as support/resistance", () => {
  // A zig-zag: pivot low ~90 (idx 4), pivot high ~120 (idx 8), pivot low ~100 (idx 12).
  const c: Candle[] = [
    bar(0, 110, 105), bar(1, 108, 102), bar(2, 104, 98), bar(3, 100, 94),
    bar(4, 96, 90),  // pivot low 90
    bar(5, 102, 96), bar(6, 110, 104), bar(7, 116, 110),
    bar(8, 122, 118), // pivot high 122
    bar(9, 118, 112), bar(10, 112, 106), bar(11, 108, 102),
    bar(12, 104, 100), // pivot low 100
    bar(13, 108, 103), bar(14, 112, 107), bar(15, 116, 111),
  ];
  const lv = computeLevels(c, 110, 3);
  assert.equal(lv.resistance, 122, "resistance = nearest pivot high above 110");
  assert.equal(lv.support, 100, "support = nearest pivot low below 110");
  assert.ok(lv.stop != null && lv.stop < 100, "stop sits below support");
  assert.equal(lv.target, 122);
  assert.ok(lv.rr != null && lv.rr > 0, "computes a positive reward:risk");
});

test("computeLevels: empty/invalid input returns nulls", () => {
  const lv = computeLevels([], 0);
  assert.equal(lv.support, null);
  assert.equal(lv.resistance, null);
  assert.equal(lv.rr, null);
});
