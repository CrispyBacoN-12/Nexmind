import { test } from "node:test";
import assert from "node:assert/strict";
import { getStrategy, combineStrategies, STRATEGIES } from "./strategies";
import type { Candle } from "@/lib/indicators";

const DAY = 86_400;
const HOUR = 3600;

function bar(t: number, o: number, h: number, l: number, c: number, v = 1000): Candle {
  return { t, o, h, l, c, v };
}

test("registry exposes base strategies + combos by key", () => {
  const keys = STRATEGIES.map((s) => s.key);
  for (const k of ["trend-pullback", "ema-cross", "orb", "fvg", "liquidity-sweep", "swing-trend-continuation", "combo-or", "combo-vote"]) {
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

test("Bull Flag: pole + tight low-vol pullback + volume breakout fires long", () => {
  const b: Candle[] = [];
  // 20 flat warmup bars (low volume) for ATR/volume-SMA.
  for (let i = 0; i < 20; i++) b.push(bar(i * HOUR, 100, 100.5, 99.5, 100, 1000));
  // Pole: 5 strong green bars 100 -> ~118 on high volume.
  let p = 100;
  for (let i = 0; i < 5; i++) { const o = p; p += 3.6; b.push(bar((20 + i) * HOUR, o, p + 0.3, o - 0.3, p, 5000)); }
  // Flag: 3 small red bars pulling back tightly on LOW volume.
  let f = p;
  for (let i = 0; i < 3; i++) { const o = f; f -= 0.8; b.push(bar((25 + i) * HOUR, o, o + 0.2, f - 0.2, f, 1500)); }
  const flagHigh = Math.max(b[25].h, b[26].h, b[27].h);
  // Breakout: green bar closing above the flag high on high volume.
  b.push(bar(28 * HOUR, f, flagHigh + 2, f - 0.2, flagHigh + 1.5, 6000));

  const evalr = getStrategy("bull-flag")!.build(b);
  assert.equal(evalr(b.length - 1)?.side, "long", "expected a bull-flag breakout long");
  // A flat, no-pole series must not fire.
  const flat = Array.from({ length: 30 }, (_, i) => bar(i * HOUR, 100, 100.5, 99.5, 100, 1000));
  const evalFlat = getStrategy("bull-flag")!.build(flat);
  assert.ok(flat.every((_, i) => evalFlat(i) === null), "no flag on a flat series");
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

test("Liquidity Sweep + VWAP Reclaim: a low-sweep that reclaims VWAP with volume/ADX/trend confirmation fires long", () => {
  // 70-bar uptrend (builds SMA50 + real ADX trend strength), then a shallow
  // 15-bar pullback (so the "prior 20-bar low" sits close to current price),
  // then a sweep bar: wicks below the pullback low, closes back up strongly
  // on 3x average volume.
  const up = Array.from({ length: 70 }, (_, i) => 100 + i * 1.5).map((c, i) => bar(i * HOUR, c - 0.3, c + 1, c - 1, c, 1000));
  let p = up[up.length - 1].c;
  const pullback: Candle[] = [];
  for (let i = 0; i < 15; i++) { p -= 0.5; pullback.push(bar((70 + i) * HOUR, p + 0.5, p + 1, p - 1, p, 900)); }
  const lastLow = Math.min(...pullback.map((b) => b.l));
  const sweep = bar(85 * HOUR, p, p + 3.5, lastLow - 1.5, p + 3, 3000);
  const bars = [...up, ...pullback, sweep];
  const evalr = getStrategy("liquidity-sweep")!.build(bars);
  assert.equal(evalr(85)?.side, "long");
});

test("Liquidity Sweep + VWAP Reclaim: a high-sweep that rejects VWAP with volume/ADX/trend confirmation fires short", () => {
  const down = Array.from({ length: 70 }, (_, i) => 300 - i * 1.5).map((c, i) => bar(i * HOUR, c + 0.3, c + 1, c - 1, c, 1000));
  let p = down[down.length - 1].c;
  const bounce: Candle[] = [];
  for (let i = 0; i < 15; i++) { p += 0.5; bounce.push(bar((70 + i) * HOUR, p - 0.5, p + 1, p - 1, p, 900)); }
  const lastHigh = Math.max(...bounce.map((b) => b.h));
  const sweep = bar(85 * HOUR, p, lastHigh + 1.5, p - 3.5, p - 3, 3000);
  const bars = [...down, ...bounce, sweep];
  const evalr = getStrategy("liquidity-sweep")!.build(bars);
  assert.equal(evalr(85)?.side, "short");
});

test("Liquidity Sweep + VWAP Reclaim: a plain hold bar (no sweep) never fires", () => {
  const bars = Array.from({ length: 25 }, (_, i) => bar(i * HOUR, 100, 100.5, 99.5, 100, 1000));
  const evalr = getStrategy("liquidity-sweep")!.build(bars);
  assert.ok(bars.every((_, i) => evalr(i) === null));
});

test("Swing Trend Continuation: declares a calibrated preferredExit ladder", () => {
  const strat = getStrategy("swing-trend-continuation")!;
  assert.equal(strat.preferredExit?.tp1Mult, 1.5);
  assert.equal(strat.preferredExit?.singleTarget, true);
  assert.ok(strat.preferredExit?.costs, "expects a real cost model, not NO_COSTS");
});

test("Swing Trend Continuation: a confirmed uptrend breaking out on volume fires long", () => {
  // 70 daily bars, steady uptrend (ADX>25, price above weekly VWAP & SMA50),
  // then a breakout bar closing above the prior 10-bar high on 3x volume,
  // closing near its own high (positive estimated delta).
  const up = Array.from({ length: 70 }, (_, i) => 100 + i * 1.5).map((c, i) => bar(i * DAY, c - 0.5, c + 1, c - 1, c, 1000));
  const priorHigh = up[up.length - 1].h;
  const breakout = bar(70 * DAY, priorHigh - 0.5, priorHigh + 5, priorHigh - 1, priorHigh + 4, 3000);
  const bars = [...up, breakout];
  const evalr = getStrategy("swing-trend-continuation")!.build(bars);
  assert.equal(evalr(70)?.side, "long");
});

test("Swing Trend Continuation: a confirmed downtrend breaking down on volume fires short", () => {
  const down = Array.from({ length: 70 }, (_, i) => 300 - i * 1.5).map((c, i) => bar(i * DAY, c + 0.5, c + 1, c - 1, c, 1000));
  const priorLow = down[down.length - 1].l;
  const breakdown = bar(70 * DAY, priorLow + 0.5, priorLow + 1, priorLow - 5, priorLow - 4, 3000);
  const bars = [...down, breakdown];
  const evalr = getStrategy("swing-trend-continuation")!.build(bars);
  assert.equal(evalr(70)?.side, "short");
});

test("Swing Trend Continuation: a flat/ranging market (ADX below floor) never fires", () => {
  const bars = Array.from({ length: 80 }, (_, i) => bar(i * DAY, 100, 101, 99, 100 + (i % 2 === 0 ? 0.3 : -0.3), 1000));
  const evalr = getStrategy("swing-trend-continuation")!.build(bars);
  assert.ok(bars.every((_, i) => evalr(i) === null), "must stay flat when there's no confirmed trend");
});

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

const CANDLE_DOWN = downtrendPrefix(15, 200, 3);
const CANDLE_UP = uptrendPrefix(15, 100, 3);

test("Hammer strategy: getStrategy resolves and fires long", () => {
  const bars = [...CANDLE_DOWN, bar(15 * HOUR, 100, 101.2, 95, 101)];
  assert.equal(getStrategy("hammer")!.build(bars)(15)?.side, "long");
});

test("Shooting Star strategy: getStrategy resolves and fires short", () => {
  const bars = [...CANDLE_UP, bar(15 * HOUR, 100, 105, 98.8, 99)];
  assert.equal(getStrategy("shooting-star")!.build(bars)(15)?.side, "short");
});

test("Bullish Engulfing strategy: getStrategy resolves and fires long", () => {
  const bars = [...CANDLE_DOWN, bar(15 * HOUR, 110, 111, 104, 105), bar(16 * HOUR, 104, 113, 103, 112)];
  assert.equal(getStrategy("bullish-engulfing")!.build(bars)(16)?.side, "long");
});

test("Bearish Engulfing strategy: getStrategy resolves and fires short", () => {
  const bars = [...CANDLE_UP, bar(15 * HOUR, 100, 106, 99, 105), bar(16 * HOUR, 106, 107, 91, 92)];
  assert.equal(getStrategy("bearish-engulfing")!.build(bars)(16)?.side, "short");
});

test("Piercing Line strategy: getStrategy resolves and fires long", () => {
  const bars = [...CANDLE_DOWN, bar(15 * HOUR, 120, 121, 109, 110), bar(16 * HOUR, 108, 118, 107, 117)];
  assert.equal(getStrategy("piercing-line")!.build(bars)(16)?.side, "long");
});

test("Dark Cloud Cover strategy: getStrategy resolves and fires short", () => {
  const bars = [...CANDLE_UP, bar(15 * HOUR, 100, 111, 99, 110), bar(16 * HOUR, 112, 113, 102, 103)];
  assert.equal(getStrategy("dark-cloud-cover")!.build(bars)(16)?.side, "short");
});

test("Morning Star strategy: getStrategy resolves and fires long", () => {
  const bars = [...CANDLE_DOWN, bar(15 * HOUR, 130, 131, 119, 120), bar(16 * HOUR, 115, 116, 113, 114), bar(17 * HOUR, 116, 128, 115, 127)];
  assert.equal(getStrategy("morning-star")!.build(bars)(17)?.side, "long");
});

test("Evening Star strategy: getStrategy resolves and fires short", () => {
  const bars = [...CANDLE_UP, bar(15 * HOUR, 100, 111, 99, 110), bar(16 * HOUR, 115, 117, 114, 116), bar(17 * HOUR, 114, 115, 102, 103)];
  assert.equal(getStrategy("evening-star")!.build(bars)(17)?.side, "short");
});

test("Three White Soldiers strategy: getStrategy resolves and fires long", () => {
  const bars = [...CANDLE_DOWN, bar(15 * HOUR, 100, 106, 99, 105), bar(16 * HOUR, 102, 111.5, 101, 110), bar(17 * HOUR, 105, 118, 104, 116)];
  assert.equal(getStrategy("three-white-soldiers")!.build(bars)(17)?.side, "long");
});

test("Three Black Crows strategy: getStrategy resolves and fires short", () => {
  const bars = [...CANDLE_UP, bar(15 * HOUR, 105, 106, 99, 100), bar(16 * HOUR, 103, 104, 93, 95), bar(17 * HOUR, 100, 101, 86, 89)];
  assert.equal(getStrategy("three-black-crows")!.build(bars)(17)?.side, "short");
});

test("candlestick patterns: high-sample patterns declare a calibrated preferredExit", () => {
  const expected: Record<string, { tp1Mult: number; singleTarget: boolean }> = {
    hammer: { tp1Mult: 1.0, singleTarget: true },
    "shooting-star": { tp1Mult: 3.0, singleTarget: false },
    "bullish-engulfing": { tp1Mult: 2.0, singleTarget: true },
    "bearish-engulfing": { tp1Mult: 3.0, singleTarget: false },
    "piercing-line": { tp1Mult: 1.0, singleTarget: true },
    "dark-cloud-cover": { tp1Mult: 3.0, singleTarget: false },
    "morning-star": { tp1Mult: 2.0, singleTarget: true },
    "evening-star": { tp1Mult: 1.0, singleTarget: false },
  };
  for (const [key, exit] of Object.entries(expected)) {
    const strat = getStrategy(key)!;
    assert.equal(strat.preferredExit?.tp1Mult, exit.tp1Mult, `${key} tp1Mult`);
    assert.equal(strat.preferredExit?.singleTarget, exit.singleTarget, `${key} singleTarget`);
    assert.ok(strat.preferredExit?.costs, `${key} expects a real cost model, not NO_COSTS`);
  }
});

test("candlestick patterns: too-sparse-to-calibrate patterns and the combo stay on the engine default", () => {
  for (const key of ["three-white-soldiers", "three-black-crows", "candlestick-any"]) {
    assert.equal(getStrategy(key)!.preferredExit, undefined, `${key} should not have a preferredExit`);
  }
});

test("candlestick-any combo: fires when exactly one member pattern triggers", () => {
  const bars = [...CANDLE_UP, bar(15 * HOUR, 100, 111, 99, 110), bar(16 * HOUR, 112, 113, 102, 103)]; // Dark Cloud Cover fixture
  assert.equal(getStrategy("candlestick-any")!.build(bars)(16)?.side, "short");
});

test("candlestick-any combo: dropped members (e.g. hammer) no longer trigger it", () => {
  const bars = [...CANDLE_DOWN, bar(15 * HOUR, 100, 101.2, 95, 101)]; // Hammer fixture
  assert.equal(getStrategy("hammer")!.build(bars)(15)?.side, "long", "sanity: hammer itself still fires");
  assert.equal(getStrategy("candlestick-any")!.build(bars)(15), null, "but combo dropped hammer during curation");
});

test("registry exposes all 10 candlestick patterns + the combo by key", () => {
  const keys = STRATEGIES.map((s) => s.key);
  for (const k of [
    "hammer", "shooting-star", "bullish-engulfing", "bearish-engulfing",
    "piercing-line", "dark-cloud-cover", "morning-star", "evening-star",
    "three-white-soldiers", "three-black-crows", "candlestick-any",
  ]) {
    assert.ok(keys.includes(k), `missing ${k}`);
  }
});
