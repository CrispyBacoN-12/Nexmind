import { test } from "node:test";
import assert from "node:assert/strict";
import { getStrategy, combineStrategies, STRATEGIES } from "./strategies";
import type { Candle } from "@/lib/indicators";

const DAY = 86_400;
const HOUR = 3600;

function bar(t: number, o: number, h: number, l: number, c: number): Candle {
  return { t, o, h, l, c, v: 1000 };
}

test("registry exposes base strategies + combos by key", () => {
  const keys = STRATEGIES.map((s) => s.key);
  for (const k of ["trend-pullback", "ema-cross", "orb", "fvg", "combo-or", "combo-vote"]) {
    assert.ok(keys.includes(k), `missing ${k}`);
  }
  assert.equal(getStrategy("nope"), null);
});

test("Dip Buy: long-only, and the trend filter blocks falling knives below SMA50", () => {
  // Pure downtrend: deeply oversold but price stays below SMA50 → no entries,
  // and it must never short (long-only).
  const downtrend = Array.from({ length: 90 }, (_, i) => 200 - i * 2).map((c, i) => bar(i * HOUR, c, c + 1, c - 1, c));
  const evalr = getStrategy("mean-rev")!.build(downtrend);
  const sides = downtrend.map((_, i) => evalr(i)?.side).filter(Boolean);
  assert.equal(sides.filter((s) => s === "short").length, 0, "must never short");
  assert.equal(sides.filter((s) => s === "long").length, 0, "no falling-knife longs below SMA50");
});

test("Dip Buy: a pullback inside an uptrend (price above SMA50) fires a long", () => {
  // 70 bars rising to build a high SMA50, then a sharp dip to push RSI oversold
  // while price stays above SMA50, then a recovery bar (RSI crosses back up).
  const up = Array.from({ length: 70 }, (_, i) => 100 + i * 2); // → ~238, SMA50 well below
  const dip = [232, 224, 216, 208, 200, 196]; // sharp drop pushes RSI down, still > SMA50
  const rebound = [206, 214]; // RSI crosses back above 35
  const bars = [...up, ...dip, ...rebound].map((c, i) => bar(i * HOUR, c, c + 1.5, c - 1.5, c));
  const evalr = getStrategy("mean-rev")!.build(bars);
  const longs = bars.map((_, i) => evalr(i)?.side).filter((s) => s === "long");
  assert.ok(longs.length >= 1, "expected at least one dip-buy long");
});

test("Rip Sell: short-only, and the trend filter blocks shorts above SMA50", () => {
  // Pure uptrend: price stays above SMA50 → no shorts, and it must never long.
  const uptrend = Array.from({ length: 90 }, (_, i) => 100 + i * 2).map((c, i) => bar(i * HOUR, c, c + 1, c - 1, c));
  const evalr = getStrategy("rip-sell")!.build(uptrend);
  const sides = uptrend.map((_, i) => evalr(i)?.side).filter(Boolean);
  assert.equal(sides.filter((s) => s === "long").length, 0, "must never long");
  assert.equal(sides.filter((s) => s === "short").length, 0, "no shorts above SMA50");
});

test("Rip Sell: a bounce rolling over inside a downtrend fires a short", () => {
  // 70 bars falling to build a high SMA50, a sharp bounce to push RSI up, then a
  // down bar (RSI crosses back below 55) while price stays below SMA50.
  const down = Array.from({ length: 70 }, (_, i) => 400 - i * 3); // → ~193, SMA50 well above
  const bounce = [201, 213, 225, 237, 249, 261]; // rally pushes RSI up, still < SMA50
  const rollover = [251, 239]; // RSI crosses back below 55
  const bars = [...down, ...bounce, ...rollover].map((c, i) => bar(i * HOUR, c, c + 1.5, c - 1.5, c));
  const evalr = getStrategy("rip-sell")!.build(bars);
  const shorts = bars.map((_, i) => evalr(i)?.side).filter((s) => s === "short");
  assert.ok(shorts.length >= 1, "expected at least one rip-sell short");
});

test("combineStrategies 'any': one member firing triggers, conflict skips", () => {
  // FVG fires on a 3-bar gap; combine it with itself-equivalent for a simple check.
  const gapUp: Candle[] = [
    bar(0, 10, 11, 9, 10), bar(HOUR, 12, 14, 12, 13), bar(2 * HOUR, 14, 15, 12, 14), // bullish FVG at i=2
  ];
  const combo = combineStrategies("t-or", "t", ["fvg"], "any").build(gapUp);
  assert.equal(combo(2)?.side, "long");
  assert.equal(combo(1), null);
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
