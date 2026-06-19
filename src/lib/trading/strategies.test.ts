import { test } from "node:test";
import assert from "node:assert/strict";
import { getStrategy, STRATEGIES } from "./strategies";
import type { Candle } from "@/lib/indicators";

const DAY = 86_400;
const HOUR = 3600;

function bar(t: number, o: number, h: number, l: number, c: number): Candle {
  return { t, o, h, l, c, v: 1000 };
}

test("registry exposes the three strategies by key", () => {
  assert.deepEqual(STRATEGIES.map((s) => s.key).sort(), ["ema-cross", "fvg", "orb"]);
  assert.equal(getStrategy("nope"), null);
});

test("EMA Cross: a downtrend flipping to an uptrend fires a long", () => {
  const closes = [...Array(20).fill(0).map((_, i) => 100 - i), ...Array(20).fill(0).map((_, i) => 80 + i * 2)];
  const bars = closes.map((c, i) => bar(i * HOUR, c, c + 0.5, c - 0.5, c));
  const evalr = getStrategy("ema-cross")!.build(bars);
  const sides = bars.map((_, i) => evalr(i)?.side).filter(Boolean);
  assert.ok(sides.includes("long"), "expected a long signal after the upward cross");
});

test("FVG: a 3-bar gap up is long, gap down is short, overlap is null", () => {
  const evalUp = getStrategy("fvg")!.build([
    bar(0, 10, 11, 9, 10),     // i-2: high 11
    bar(HOUR, 12, 14, 12, 13), // i-1: impulse
    bar(2 * HOUR, 14, 15, 12, 14), // i: low 12 > 11 → bullish FVG
  ]);
  assert.equal(evalUp(2)?.side, "long");

  const evalDown = getStrategy("fvg")!.build([
    bar(0, 20, 21, 19, 20),    // i-2: low 19
    bar(HOUR, 18, 18, 15, 16), // i-1: impulse down
    bar(2 * HOUR, 16, 18, 14, 15), // i: high 18 < 19 → bearish FVG
  ]);
  assert.equal(evalDown(2)?.side, "short");

  const evalFlat = getStrategy("fvg")!.build([
    bar(0, 10, 12, 9, 11), bar(HOUR, 11, 13, 10, 12), bar(2 * HOUR, 12, 13, 10, 11),
  ]);
  assert.equal(evalFlat(2), null);
});

test("ORB: breakout above the opening range fires long once per day", () => {
  // One UTC day, 6 hourly bars. Opening range = first 4 bars (high 105, low 95).
  const bars: Candle[] = [
    bar(0 * HOUR, 100, 105, 98, 100),
    bar(1 * HOUR, 100, 104, 95, 101),
    bar(2 * HOUR, 101, 103, 99, 102),
    bar(3 * HOUR, 102, 105, 100, 103),
    bar(4 * HOUR, 103, 110, 103, 108), // closes 108 > OR high 105 → long
    bar(5 * HOUR, 108, 112, 107, 111), // still above, but already fired today
  ];
  const evalr = getStrategy("orb")!.build(bars);
  assert.equal(evalr(0), null);
  assert.equal(evalr(3), null); // inside opening range
  assert.equal(evalr(4)?.side, "long");
  assert.equal(evalr(5), null); // once per day
});

test("ORB: daily bars never fire (one bar per day)", () => {
  const bars = [0, 1, 2, 3, 4, 5].map((d) => bar(d * DAY, 100, 110, 90, 100 + d));
  const evalr = getStrategy("orb")!.build(bars);
  assert.ok(bars.every((_, i) => evalr(i) === null));
});
